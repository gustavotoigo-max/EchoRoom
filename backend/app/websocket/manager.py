"""ConnectionManager: conexões WebSocket abertas, por sala."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import WebSocket

log = logging.getLogger("echoroom.ws")


@dataclass(eq=False)
class Connection:
    ws: "WebSocket | Any"
    room_id: str
    participant_id: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    _send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send_text(self, text: str) -> bool:
        try:
            async with self._send_lock:
                await asyncio.wait_for(self.ws.send_text(text), timeout=5)
            return True
        except Exception:
            return False


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[str, Connection]] = {}

    def add(self, conn: Connection) -> None:
        self._rooms.setdefault(conn.room_id, {})[conn.id] = conn

    def remove(self, conn: Connection) -> None:
        conns = self._rooms.get(conn.room_id)
        if conns is not None:
            conns.pop(conn.id, None)
            if not conns:
                self._rooms.pop(conn.room_id, None)

    async def send(self, conn: Connection, message: dict) -> None:
        await conn.send_text(json.dumps(message, separators=(",", ":")))

    async def broadcast(self, room_id: str, message: dict) -> None:
        conns = list(self._rooms.get(room_id, {}).values())
        if not conns:
            return
        text = json.dumps(message, separators=(",", ":"))
        results = await asyncio.gather(*(c.send_text(text) for c in conns))
        for conn, ok in zip(conns, results):
            if not ok:
                log.info("descartando conexão %s (falha ao enviar)", conn.id)
                try:
                    await conn.ws.close()
                except Exception:
                    pass
