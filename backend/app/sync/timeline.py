"""Timeline lógica da sala.

A posição nunca é transmitida continuamente. Ela é derivada de:

    expected = base_position + (server_now - started_at)   (tocando)
    expected = base_position                               (pausado)

Estas funções são puras: recebem a timeline e devolvem uma nova.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal, Optional

PlaybackState = Literal["playing", "paused", "stopped"]


@dataclass(frozen=True)
class Timeline:
    state: PlaybackState = "stopped"
    base_position: float = 0.0
    started_at: Optional[float] = None
    # Instante (relógio do servidor) em que o último comando passa a valer.
    execute_at: Optional[float] = None


def expected_position(tl: Timeline, now: float, duration: Optional[float] = None) -> float:
    if tl.state == "playing" and tl.started_at is not None:
        pos = tl.base_position + max(0.0, now - tl.started_at)
    else:
        pos = tl.base_position
    if duration is not None and duration > 0:
        pos = min(pos, duration)
    return max(0.0, pos)


def play(tl: Timeline, execute_at: float) -> Timeline:
    if tl.state == "playing":
        return tl
    return replace(tl, state="playing", started_at=execute_at, execute_at=execute_at)


def pause(tl: Timeline, execute_at: float, duration: Optional[float] = None) -> Timeline:
    if tl.state != "playing":
        return tl
    # Congela a posição exatamente no instante em que os clientes pausarão.
    frozen = expected_position(tl, execute_at, duration)
    return Timeline(state="paused", base_position=frozen, started_at=None, execute_at=execute_at)


def seek(tl: Timeline, position: float, execute_at: float) -> Timeline:
    position = max(0.0, position)
    if tl.state == "playing":
        return Timeline(state="playing", base_position=position, started_at=execute_at, execute_at=execute_at)
    return Timeline(state="paused", base_position=position, started_at=None, execute_at=execute_at)


def start_track(execute_at: float) -> Timeline:
    return Timeline(state="playing", base_position=0.0, started_at=execute_at, execute_at=execute_at)


def stopped() -> Timeline:
    return Timeline()
