"""Transições de estado da sala.

Funções síncronas e determinísticas: recebem a sala, o instante atual
do servidor e os parâmetros do comando. Retornam um CommandResult.
Não fazem I/O — isso fica no RoomManager e na camada WebSocket.
Toda alteração efetiva incrementa state_version.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from app.config import settings
from app.rooms.models import QueueItem, Room
from app.sync import timeline as tl


class CommandError(Exception):
    """Erro de comando com mensagem pronta para o usuário."""


@dataclass
class CommandResult:
    event: Optional[str]  # evento a transmitir; None = nada mudou
    extra: dict = field(default_factory=dict)


def _bump(room: Room) -> None:
    room.state_version += 1


def _duration(room: Room) -> Optional[float]:
    return room.current.duration if room.current else None


# ---- player -----------------------------------------------------------


def play(room: Room, now: float) -> CommandResult:
    if room.current is None:
        raise CommandError("A fila está vazia. Adicione uma música para tocar.")
    if room.timeline.state == "playing":
        return CommandResult(None)
    execute_at = now + settings.command_lead_time
    dur = _duration(room)
    if dur and room.timeline.base_position >= dur - 0.5:
        # música já no fim: recomeça
        room.timeline = tl.Timeline(state="paused", base_position=0.0)
    room.timeline = tl.play(room.timeline, execute_at)
    _bump(room)
    return CommandResult("PLAYER_PLAY", {"executeAt": execute_at, "position": room.timeline.base_position})


def pause(room: Room, now: float) -> CommandResult:
    if room.timeline.state != "playing":
        return CommandResult(None)
    execute_at = now + settings.command_lead_time
    room.timeline = tl.pause(room.timeline, execute_at, _duration(room))
    _bump(room)
    return CommandResult("PLAYER_PAUSE", {"executeAt": execute_at, "position": room.timeline.base_position})


def seek(room: Room, now: float, position: float) -> CommandResult:
    if room.current is None:
        raise CommandError("Nenhuma música tocando.")
    try:
        position = float(position)
    except (TypeError, ValueError):
        raise CommandError("Posição inválida.")
    dur = _duration(room)
    if dur:
        position = min(position, max(0.0, dur - 0.25))
    execute_at = now + settings.command_lead_time
    room.timeline = tl.seek(room.timeline, position, execute_at)
    _bump(room)
    return CommandResult("PLAYER_SEEK", {"executeAt": execute_at, "position": room.timeline.base_position})


# ---- fila ---------------------------------------------------------------


def _advance(room: Room, now: float) -> None:
    if room.queue:
        room.current = room.queue.pop(0)
        room.timeline = tl.start_track(now + settings.track_change_lead_time)
    else:
        room.current = None
        room.timeline = tl.stopped()


def add_track(
    room: Room,
    now: float,
    *,
    video_id: str,
    title: str,
    author: str,
    thumbnail: str,
    added_by: str,
    title_resolved: bool,
) -> CommandResult:
    if len(room.queue) >= settings.max_queue_size:
        raise CommandError("A fila atingiu o limite de músicas.")
    item = QueueItem(
        id=uuid.uuid4().hex[:12],
        video_id=video_id,
        title=title,
        author=author,
        thumbnail=thumbnail,
        added_by=added_by,
        title_resolved=title_resolved,
    )
    if room.current is None:
        # Sala vazia: a música começa a tocar para todos.
        room.current = item
        room.timeline = tl.start_track(now + settings.track_change_lead_time)
        _bump(room)
        return CommandResult("TRACK_ADD", {"itemId": item.id, "startedTrack": True})
    room.queue.append(item)
    _bump(room)
    return CommandResult("TRACK_ADD", {"itemId": item.id, "startedTrack": False})


def remove_track(room: Room, item_id: str) -> CommandResult:
    for i, item in enumerate(room.queue):
        if item.id == item_id:
            room.queue.pop(i)
            _bump(room)
            return CommandResult("TRACK_REMOVE", {"itemId": item_id})
    return CommandResult(None)


def move_track(room: Room, item_id: str, to_index: int) -> CommandResult:
    idx = next((i for i, q in enumerate(room.queue) if q.id == item_id), None)
    if idx is None:
        return CommandResult(None)
    to_index = max(0, min(int(to_index), len(room.queue) - 1))
    if to_index == idx:
        return CommandResult(None)
    item = room.queue.pop(idx)
    room.queue.insert(to_index, item)
    _bump(room)
    return CommandResult("QUEUE_UPDATE", {"itemId": item_id})


def skip(room: Room, now: float, current_item_id: Optional[str]) -> CommandResult:
    """Pula a música atual. O cliente informa qual música queria pular;
    dois cliques simultâneos não pulam duas músicas."""
    if room.current is None:
        return CommandResult(None)
    if current_item_id and current_item_id != room.current.id:
        return CommandResult(None)
    _advance(room, now)
    _bump(room)
    return CommandResult("TRACK_SKIP", {})


def track_ended(room: Room, now: float, item_id: Optional[str]) -> CommandResult:
    """Só avança se o fim reportado corresponde à música e à timeline atuais.
    Relatos duplicados (vários clientes) são ignorados porque, após o
    primeiro, a música atual já mudou."""
    cur = room.current
    if cur is None or item_id != cur.id:
        return CommandResult(None)
    if room.timeline.state != "playing":
        return CommandResult(None)
    pos = tl.expected_position(room.timeline, now)
    if cur.duration:
        if pos < cur.duration - settings.track_end_tolerance:
            return CommandResult(None)
    elif pos < 1.0:
        return CommandResult(None)
    _advance(room, now)
    _bump(room)
    return CommandResult("TRACK_ENDED", {})


def update_meta(room: Room, item_id: str, title: Optional[str], duration: Optional[float]) -> CommandResult:
    items = ([room.current] if room.current else []) + room.queue
    for item in items:
        if item.id != item_id:
            continue
        changed = False
        if duration and not item.duration:
            try:
                d = float(duration)
            except (TypeError, ValueError):
                d = 0
            if 0 < d < 60 * 60 * 24:
                item.duration = d
                changed = True
        if title and not item.title_resolved:
            item.title = str(title)[:200]
            item.title_resolved = True
            changed = True
        if changed:
            _bump(room)
            return CommandResult("QUEUE_UPDATE", {"itemId": item_id})
        return CommandResult(None)
    return CommandResult(None)
