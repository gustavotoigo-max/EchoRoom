"""Repositório de persistência.

`RoomRepository` define a interface usada pelo resto do backend.
`SQLiteRoomRepository` é a implementação inicial. Uma implementação
PostgreSQL pode ser adicionada sem alterar RoomManager nem a API.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol

from app.database.models import SCHEMA


@dataclass
class RoomRecord:
    room_id: str
    password_hash: str
    password_salt: str
    created_at: float
    state: Optional[dict]


class RoomRepository(Protocol):
    def create_room(self, room_id: str, password_hash: str, password_salt: str) -> bool: ...
    def get_room(self, room_id: str) -> Optional[RoomRecord]: ...
    def save_state(self, room_id: str, state: dict) -> None: ...
    def get_meta(self, key: str) -> Optional[str]: ...
    def set_meta(self, key: str, value: str) -> None: ...


class SQLiteRoomRepository:
    def __init__(self, path: Path | str) -> None:
        self._path = str(path)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False, isolation_level=None)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(SCHEMA)

    def create_room(self, room_id: str, password_hash: str, password_salt: str) -> bool:
        now = time.time()
        with self._lock:
            try:
                self._conn.execute(
                    "INSERT INTO rooms (room_id, password_hash, password_salt, created_at, updated_at, state_json)"
                    " VALUES (?, ?, ?, ?, ?, NULL)",
                    (room_id, password_hash, password_salt, now, now),
                )
                return True
            except sqlite3.IntegrityError:
                return False

    def get_room(self, room_id: str) -> Optional[RoomRecord]:
        with self._lock:
            row = self._conn.execute(
                "SELECT room_id, password_hash, password_salt, created_at, state_json FROM rooms WHERE room_id = ?",
                (room_id,),
            ).fetchone()
        if not row:
            return None
        return RoomRecord(
            room_id=row[0],
            password_hash=row[1],
            password_salt=row[2],
            created_at=row[3],
            state=json.loads(row[4]) if row[4] else None,
        )

    def save_state(self, room_id: str, state: dict) -> None:
        payload = json.dumps(state, separators=(",", ":"))
        with self._lock:
            self._conn.execute(
                "UPDATE rooms SET state_json = ?, updated_at = ? WHERE room_id = ?",
                (payload, time.time(), room_id),
            )

    def get_meta(self, key: str) -> Optional[str]:
        with self._lock:
            row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def set_meta(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
