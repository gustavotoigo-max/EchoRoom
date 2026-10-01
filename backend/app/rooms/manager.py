"""RoomManager: autoridade sobre as salas.

- Mantém as salas ativas em memória (fonte oficial de verdade).
- Serializa alterações com um asyncio.Lock por sala.
- Persiste o estado da sala no repositório após cada alteração.
"""

from __future__ import annotations

import asyncio
import secrets
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from app.config import settings
from app.database.repository import RoomRepository
from app.rooms import security
from app.rooms.models import Participant, Room

_ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sem 0/O, 1/I


class RoomNotFound(Exception):
    pass


class RoomManager:
    def __init__(self, repo: RoomRepository) -> None:
        self._repo = repo
        self._rooms: dict[str, Room] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        secret = repo.get_meta("token_secret")
        if not secret:
            secret = secrets.token_hex(32)
            repo.set_meta("token_secret", secret)
        self._secret = bytes.fromhex(secret)

    # ---- criação e acesso ----------------------------------------------

    @staticmethod
    def normalize_id(room_id: str) -> str:
        return (room_id or "").strip().upper()

    def _new_id(self) -> str:
        return "".join(secrets.choice(_ROOM_ALPHABET) for _ in range(settings.room_id_length))

    def create_room(self, password: str) -> tuple[str, str]:
        pw_hash, salt = security.hash_password(password)
        for _ in range(20):
            room_id = self._new_id()
            if self._repo.create_room(room_id, pw_hash, salt):
                return room_id, security.make_token(self._secret, room_id, salt)
        raise RuntimeError("Não foi possível gerar um código de sala único.")

    def room_exists(self, room_id: str) -> bool:
        return self._repo.get_room(self.normalize_id(room_id)) is not None

    def authenticate(self, room_id: str, password: str) -> Optional[str]:
        """Retorna token se a senha confere. Lança RoomNotFound."""
        record = self._repo.get_room(self.normalize_id(room_id))
        if record is None:
            raise RoomNotFound(room_id)
        if not security.verify_password(password, record.password_hash, record.password_salt):
            return None
        return security.make_token(self._secret, record.room_id, record.password_salt)

    def check_token(self, room_id: str, token: str) -> bool:
        record = self._repo.get_room(self.normalize_id(room_id))
        if record is None:
            raise RoomNotFound(room_id)
        return security.verify_token(self._secret, record.room_id, record.password_salt, token)

    # ---- estado em memória ------------------------------------------------

    def get_room(self, room_id: str) -> Room:
        room_id = self.normalize_id(room_id)
        room = self._rooms.get(room_id)
        if room is not None:
            return room
        record = self._repo.get_room(room_id)
        if record is None:
            raise RoomNotFound(room_id)
        room = Room.from_record(room_id, record.state)
        self._rooms[room_id] = room
        return room

    @asynccontextmanager
    async def locked(self, room_id: str) -> AsyncIterator[Room]:
        """Acesso exclusivo à sala; persiste ao sair se a versão mudou."""
        room_id = self.normalize_id(room_id)
        lock = self._locks.setdefault(room_id, asyncio.Lock())
        async with lock:
            room = self.get_room(room_id)
            before = room.state_version
            yield room
            if room.state_version != before:
                self._repo.save_state(room_id, room.to_record())

    # ---- participantes -----------------------------------------------------

    @staticmethod
    def attach_participant(room: Room, participant_id: str, name: str, now: float) -> tuple[Participant, bool]:
        """Retorna (participante, entrou_agora)."""
        p = room.participants.get(participant_id)
        newly = p is None or not p.connected
        if p is None:
            p = Participant(id=participant_id, name=name)
            room.participants[participant_id] = p
        p.name = name or p.name
        p.connections += 1
        p.last_seen = now
        return p, newly

    @staticmethod
    def detach_participant(room: Room, participant_id: str, now: float) -> bool:
        """Retorna True se o participante ficou sem conexões."""
        p = room.participants.get(participant_id)
        if p is None:
            return False
        p.connections = max(0, p.connections - 1)
        p.last_seen = now
        return p.connections == 0

    @staticmethod
    def prune_participant(room: Room, participant_id: str) -> bool:
        p = room.participants.get(participant_id)
        if p is not None and not p.connected:
            del room.participants[participant_id]
            return True
        return False
