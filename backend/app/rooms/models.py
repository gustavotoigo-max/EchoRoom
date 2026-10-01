"""Modelos em memória de uma sala."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

from app.sync.timeline import Timeline


@dataclass
class QueueItem:
    id: str
    video_id: str
    title: str
    author: str
    thumbnail: str
    added_by: str
    duration: Optional[float] = None
    title_resolved: bool = True

    def to_public(self) -> dict:
        return {
            "id": self.id,
            "videoId": self.video_id,
            "title": self.title,
            "author": self.author,
            "thumbnail": self.thumbnail,
            "duration": self.duration,
            "addedBy": self.added_by,
        }

    def to_record(self) -> dict:
        return asdict(self)

    @classmethod
    def from_record(cls, data: dict) -> "QueueItem":
        return cls(**data)


@dataclass
class Participant:
    id: str
    name: str
    connections: int = 0
    last_seen: float = 0.0

    @property
    def connected(self) -> bool:
        return self.connections > 0

    def to_public(self) -> dict:
        return {"id": self.id, "name": self.name, "connected": self.connected}


@dataclass
class Room:
    room_id: str
    current: Optional[QueueItem] = None
    queue: list[QueueItem] = field(default_factory=list)
    timeline: Timeline = field(default_factory=Timeline)
    state_version: int = 0
    participants: dict[str, Participant] = field(default_factory=dict)

    # ---- serialização -------------------------------------------------

    def to_public(self, now: float) -> dict:
        tl = self.timeline
        return {
            "roomId": self.room_id,
            "currentTrack": self.current.to_public() if self.current else None,
            "currentVideoId": self.current.video_id if self.current else None,
            "playbackState": tl.state,
            "position": tl.base_position,
            "startedAt": tl.started_at,
            "executeAt": tl.execute_at,
            "serverTimestamp": now,
            "stateVersion": self.state_version,
            "queue": [q.to_public() for q in self.queue],
            "participants": [p.to_public() for p in self.participants.values()],
        }

    def to_record(self) -> dict:
        """Estado persistido (participantes não são persistidos)."""
        tl = self.timeline
        return {
            "current": self.current.to_record() if self.current else None,
            "queue": [q.to_record() for q in self.queue],
            "timeline": {
                "state": tl.state,
                "base_position": tl.base_position,
                "started_at": tl.started_at,
                "execute_at": tl.execute_at,
            },
            "state_version": self.state_version,
        }

    @classmethod
    def from_record(cls, room_id: str, data: Optional[dict]) -> "Room":
        room = cls(room_id=room_id)
        if not data:
            return room
        if data.get("current"):
            room.current = QueueItem.from_record(data["current"])
        room.queue = [QueueItem.from_record(q) for q in data.get("queue", [])]
        t = data.get("timeline") or {}
        room.timeline = Timeline(
            state=t.get("state", "stopped"),
            base_position=float(t.get("base_position", 0.0)),
            started_at=t.get("started_at"),
            execute_at=t.get("execute_at"),
        )
        room.state_version = int(data.get("state_version", 0))
        return room
