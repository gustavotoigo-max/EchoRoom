"""Eventos WebSocket e despacho de comandos.

Formato de toda mensagem enviada pelo servidor:

    {
        "type": "PLAYER_PAUSE",
        "room_id": "ABX72",
        "user_id": "123",
        "state_version": 42,
        "server_timestamp": 1790879912.250,
        "payload": {...}
    }

Eventos que alteram a sala carregam `payload.room` com o estado público
completo. O cliente aplica apenas versões maiores que a última aplicada.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

from app.config import settings
from app.rooms import state as room_state
from app.rooms.manager import RoomManager
from app.rooms.models import Room
from app.sync.clock import server_now
from app.websocket.manager import Connection, ConnectionManager
from app.youtube.metadata import extract_video_id, fetch_metadata

log = logging.getLogger("echoroom.events")


class Ev:
    ROOM_JOIN = "ROOM_JOIN"
    ROOM_LEAVE = "ROOM_LEAVE"
    PLAYER_PLAY_REQUEST = "PLAYER_PLAY_REQUEST"
    PLAYER_PLAY = "PLAYER_PLAY"
    PLAYER_PAUSE_REQUEST = "PLAYER_PAUSE_REQUEST"
    PLAYER_PAUSE = "PLAYER_PAUSE"
    PLAYER_SEEK_REQUEST = "PLAYER_SEEK_REQUEST"
    PLAYER_SEEK = "PLAYER_SEEK"
    TRACK_ADD = "TRACK_ADD"
    TRACK_REMOVE = "TRACK_REMOVE"
    TRACK_MOVE = "TRACK_MOVE"
    TRACK_SKIP = "TRACK_SKIP"
    TRACK_ENDED = "TRACK_ENDED"
    TRACK_META = "TRACK_META"
    QUEUE_UPDATE = "QUEUE_UPDATE"
    STATE_SYNC = "STATE_SYNC"
    SYNC_REQUEST = "SYNC_REQUEST"
    CLOCK_PING = "CLOCK_PING"
    CLOCK_PONG = "CLOCK_PONG"
    USER_JOINED = "USER_JOINED"
    USER_LEFT = "USER_LEFT"
    ACK = "ACK"
    ERROR = "ERROR"


def build_message(
    type_: str, room: Room | None, *, room_id: str = "", user_id: str = "", payload: Optional[dict] = None
) -> dict:
    now = server_now()
    body = dict(payload or {})
    if room is not None:
        body.setdefault("room", room.to_public(now))
    return {
        "type": type_,
        "room_id": room.room_id if room else room_id,
        "user_id": user_id,
        "state_version": room.state_version if room else 0,
        "server_timestamp": now,
        "payload": body,
    }


class EventDispatcher:
    def __init__(self, rooms: RoomManager, conns: ConnectionManager) -> None:
        self.rooms = rooms
        self.conns = conns
        self._prune_tasks: dict[tuple[str, str], asyncio.Task] = {}

    # ---- ciclo de vida da conexão ----------------------------------------

    async def join(self, conn: Connection, participant_id: str, name: str) -> None:
        name = (name or "").strip()[: settings.name_max_length] or "Convidado"
        participant_id = (participant_id or conn.id)[:64]
        conn.participant_id = participant_id
        task = self._prune_tasks.pop((conn.room_id, participant_id), None)
        if task:
            task.cancel()
        async with self.rooms.locked(conn.room_id) as room:
            _, newly = self.rooms.attach_participant(room, participant_id, name, server_now())
            room.state_version += 1
            joined = build_message(
                Ev.USER_JOINED, room, user_id=participant_id, payload={"name": name, "newly": newly}
            )
            sync = build_message(Ev.STATE_SYNC, room, user_id=participant_id)
        self.conns.add(conn)
        await self.conns.send(conn, sync)
        await self.conns.broadcast(conn.room_id, joined)

    async def leave(self, conn: Connection) -> None:
        self.conns.remove(conn)
        if not conn.participant_id:
            return
        async with self.rooms.locked(conn.room_id) as room:
            gone = self.rooms.detach_participant(room, conn.participant_id, server_now())
            room.state_version += 1
            msg = build_message(Ev.USER_LEFT, room, user_id=conn.participant_id, payload={"removed": False})
        await self.conns.broadcast(conn.room_id, msg)
        if gone:
            key = (conn.room_id, conn.participant_id)
            self._prune_tasks[key] = asyncio.create_task(self._prune_later(*key))

    async def _prune_later(self, room_id: str, participant_id: str) -> None:
        try:
            await asyncio.sleep(settings.participant_grace_seconds)
        except asyncio.CancelledError:
            return
        self._prune_tasks.pop((room_id, participant_id), None)
        async with self.rooms.locked(room_id) as room:
            if not self.rooms.prune_participant(room, participant_id):
                return
            room.state_version += 1
            msg = build_message(Ev.USER_LEFT, room, user_id=participant_id, payload={"removed": True})
        await self.conns.broadcast(room_id, msg)

    # ---- mensagens ---------------------------------------------------------

    async def handle(self, conn: Connection, msg: dict, received_at: float) -> None:
        type_ = msg.get("type")
        payload: dict[str, Any] = msg.get("payload") or {}
        request_id = msg.get("request_id")

        if type_ == Ev.CLOCK_PING:
            await self.conns.send(
                conn,
                {
                    "type": Ev.CLOCK_PONG,
                    "room_id": conn.room_id,
                    "payload": {"t1": payload.get("t1"), "t2": received_at, "t3": server_now()},
                },
            )
            return

        if type_ == Ev.SYNC_REQUEST:
            room = self.rooms.get_room(conn.room_id)
            await self.conns.send(conn, build_message(Ev.STATE_SYNC, room, user_id=conn.participant_id))
            return

        try:
            await self._command(conn, type_, payload, request_id)
        except room_state.CommandError as exc:
            await self._error(conn, request_id, str(exc))
        except Exception:  # noqa: BLE001
            log.exception("falha ao processar %s", type_)
            await self._error(conn, request_id, "O servidor não conseguiu processar o comando.")

    async def _error(self, conn: Connection, request_id: Any, message: str) -> None:
        await self.conns.send(
            conn,
            {"type": Ev.ERROR, "room_id": conn.room_id, "payload": {"request_id": request_id, "message": message}},
        )

    async def _command(self, conn: Connection, type_: str, payload: dict, request_id: Any) -> None:
        # Metadados são buscados fora do lock para não travar a sala.
        meta = None
        video_id = None
        if type_ == Ev.TRACK_ADD:
            video_id = extract_video_id(str(payload.get("url") or payload.get("videoId") or ""))
            if not video_id:
                raise room_state.CommandError("Link do YouTube inválido. Use youtube.com/watch?v=…, youtu.be/… ou /shorts/….")
            meta = await fetch_metadata(video_id)

        message = None
        async with self.rooms.locked(conn.room_id) as room:
            now = server_now()
            user = room.participants.get(conn.participant_id)
            user_name = user.name if user else "Convidado"

            if type_ == Ev.PLAYER_PLAY_REQUEST:
                result = room_state.play(room, now)
            elif type_ == Ev.PLAYER_PAUSE_REQUEST:
                result = room_state.pause(room, now)
            elif type_ == Ev.PLAYER_SEEK_REQUEST:
                result = room_state.seek(room, now, payload.get("position"))
            elif type_ == Ev.TRACK_ADD:
                assert meta is not None and video_id is not None
                result = room_state.add_track(
                    room,
                    now,
                    video_id=video_id,
                    title=meta.title,
                    author=meta.author,
                    thumbnail=meta.thumbnail,
                    added_by=user_name,
                    title_resolved=meta.resolved,
                )
            elif type_ == Ev.TRACK_REMOVE:
                result = room_state.remove_track(room, str(payload.get("itemId", "")))
            elif type_ == Ev.TRACK_MOVE:
                result = room_state.move_track(room, str(payload.get("itemId", "")), int(payload.get("toIndex", 0)))
            elif type_ == Ev.TRACK_SKIP:
                result = room_state.skip(room, now, payload.get("currentItemId"))
            elif type_ == Ev.TRACK_ENDED:
                result = room_state.track_ended(room, now, payload.get("itemId"))
            elif type_ == Ev.TRACK_META:
                result = room_state.update_meta(
                    room, str(payload.get("itemId", "")), payload.get("title"), payload.get("duration")
                )
            elif type_ == Ev.ROOM_LEAVE:
                await conn.ws.close()
                return
            else:
                raise room_state.CommandError(f"Comando desconhecido: {type_}")

            if result.event:
                message = build_message(result.event, room, user_id=conn.participant_id, payload=result.extra)

        if message is not None:
            await self.conns.broadcast(conn.room_id, message)
        if request_id is not None:
            await self.conns.send(
                conn,
                {"type": Ev.ACK, "room_id": conn.room_id, "payload": {"request_id": request_id, "changed": message is not None}},
            )
