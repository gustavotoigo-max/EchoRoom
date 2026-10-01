"""Testes da lógica central do backend (timeline, estado, segurança, despacho).

Rodar:  python -m pytest   (ou  python -m unittest discover tests)
"""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

from app.config import settings
from app.database.repository import SQLiteRoomRepository
from app.rooms import security
from app.rooms import state as st
from app.rooms.manager import RoomManager
from app.rooms.models import Room
from app.sync import timeline as tl
from app.youtube import metadata
from app.websocket.events import Ev, EventDispatcher
from app.websocket.manager import Connection, ConnectionManager

LEAD = settings.command_lead_time


class TimelineTests(unittest.TestCase):
    def test_expected_position_playing(self):
        t = tl.Timeline(state="playing", base_position=125.0, started_at=1000.0)
        self.assertAlmostEqual(tl.expected_position(t, 1030.0), 155.0)

    def test_expected_position_before_start_is_base(self):
        t = tl.Timeline(state="playing", base_position=10.0, started_at=1000.0)
        self.assertAlmostEqual(tl.expected_position(t, 999.6), 10.0)

    def test_paused_is_fixed(self):
        t = tl.Timeline(state="paused", base_position=42.0)
        self.assertEqual(tl.expected_position(t, 99999), 42.0)

    def test_pause_freezes_at_execute_at(self):
        t = tl.Timeline(state="playing", base_position=125.0, started_at=1000.0)
        p = tl.pause(t, 1010.5)
        self.assertEqual(p.state, "paused")
        self.assertIsNone(p.started_at)
        self.assertAlmostEqual(p.base_position, 135.5)

    def test_seek_keeps_playing(self):
        t = tl.Timeline(state="playing", base_position=0, started_at=1000.0)
        s = tl.seek(t, 153.44, 1100.0)
        self.assertEqual((s.state, s.base_position, s.started_at), ("playing", 153.44, 1100.0))

    def test_seek_while_paused(self):
        s = tl.seek(tl.Timeline(state="paused", base_position=3), 60, 1100.0)
        self.assertEqual((s.state, s.base_position, s.started_at), ("paused", 60, None))

    def test_clamped_to_duration(self):
        t = tl.Timeline(state="playing", base_position=0, started_at=0)
        self.assertEqual(tl.expected_position(t, 500, duration=200), 200)


def _add(room: Room, now: float, vid: str = "dQw4w9WgXcQ") -> st.CommandResult:
    return st.add_track(room, now, video_id=vid, title="t", author="a", thumbnail="", added_by="Gus", title_resolved=True)


class RoomStateTests(unittest.TestCase):
    def test_first_track_starts_playing(self):
        room = Room("ABCDE")
        r = _add(room, 100.0)
        self.assertTrue(r.extra["startedTrack"])
        self.assertEqual(room.timeline.state, "playing")
        self.assertAlmostEqual(room.timeline.started_at, 100.0 + settings.track_change_lead_time)
        self.assertEqual(room.state_version, 1)

    def test_versions_increment_and_noop_does_not(self):
        room = Room("ABCDE")
        _add(room, 0)
        v = room.state_version
        self.assertIsNone(st.play(room, 10).event)  # já tocando
        self.assertEqual(room.state_version, v)
        self.assertEqual(st.pause(room, 10).event, "PLAYER_PAUSE")
        self.assertEqual(room.state_version, v + 1)

    def test_pause_then_play_schedules(self):
        room = Room("ABCDE")
        _add(room, 0)
        start = room.timeline.started_at
        r = st.pause(room, 50.0)
        self.assertAlmostEqual(r.extra["executeAt"], 50.0 + LEAD)
        self.assertAlmostEqual(room.timeline.base_position, 50.0 + LEAD - start)
        r = st.play(room, 80.0)
        self.assertAlmostEqual(room.timeline.started_at, 80.0 + LEAD)
        self.assertAlmostEqual(r.extra["executeAt"], 80.0 + LEAD)

    def test_skip_is_idempotent_per_item(self):
        room = Room("ABCDE")
        _add(room, 0, "aaaaaaaaaaa")
        _add(room, 0, "bbbbbbbbbbb")
        _add(room, 0, "ccccccccccc")
        first = room.current.id
        self.assertEqual(st.skip(room, 10, first).event, "TRACK_SKIP")
        # segundo clique simultâneo referindo-se à mesma música: ignorado
        self.assertIsNone(st.skip(room, 10, first).event)
        self.assertEqual(room.current.video_id, "bbbbbbbbbbb")

    def test_track_ended_dedup_and_validation(self):
        room = Room("ABCDE")
        _add(room, 0, "aaaaaaaaaaa")
        _add(room, 0, "bbbbbbbbbbb")
        cur = room.current
        cur.duration = 200.0
        start = room.timeline.started_at
        # fim reportado cedo demais: rejeitado
        self.assertIsNone(st.track_ended(room, start + 100, cur.id).event)
        self.assertEqual(st.track_ended(room, start + 199, cur.id).event, "TRACK_ENDED")
        # relato duplicado de outro cliente: ignorado
        self.assertIsNone(st.track_ended(room, start + 200, cur.id).event)
        self.assertEqual(room.current.video_id, "bbbbbbbbbbb")

    def test_queue_end_stops(self):
        room = Room("ABCDE")
        _add(room, 0)
        st.skip(room, 5, None)
        self.assertIsNone(room.current)
        self.assertEqual(room.timeline.state, "stopped")
        with self.assertRaises(st.CommandError):
            st.play(room, 6)

    def test_move_and_remove(self):
        room = Room("ABCDE")
        for v in ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"]:
            _add(room, 0, v)
        last = room.queue[-1].id
        st.move_track(room, last, 0)
        self.assertEqual(room.queue[0].video_id, "ddddddddddd")
        st.remove_track(room, last)
        self.assertEqual([q.video_id for q in room.queue], ["bbbbbbbbbbb", "ccccccccccc"])

    def test_record_roundtrip(self):
        room = Room("ABCDE")
        _add(room, 0)
        _add(room, 0, "bbbbbbbbbbb")
        st.pause(room, 30)
        clone = Room.from_record("ABCDE", json.loads(json.dumps(room.to_record())))
        self.assertEqual(clone.to_public(1)["queue"], room.to_public(1)["queue"])
        self.assertEqual(clone.timeline, room.timeline)


class UrlParserTests(unittest.TestCase):
    def test_variants(self):
        vid = "dQw4w9WgXcQ"
        for url in [
            f"https://www.youtube.com/watch?v={vid}",
            f"youtube.com/watch?v={vid}&t=42s",
            f"https://youtu.be/{vid}?si=abc",
            f"https://youtube.com/shorts/{vid}",
            f"https://m.youtube.com/watch?list=x&v={vid}",
            f"https://music.youtube.com/watch?v={vid}",
            vid,
        ]:
            self.assertEqual(metadata.extract_video_id(url), vid, url)

    def test_invalid(self):
        for url in ["", "https://vimeo.com/123", "https://youtube.com/watch?v=short", "lorem ipsum"]:
            self.assertIsNone(metadata.extract_video_id(url), url)


class SecurityAndRepoTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = SQLiteRoomRepository(Path(self.tmp.name) / "t.db")
        self.rooms = RoomManager(self.repo)

    def tearDown(self):
        self.tmp.cleanup()

    def test_password_and_token(self):
        room_id, token = self.rooms.create_room("segredo1")
        self.assertEqual(len(room_id), 5)
        self.assertTrue(self.rooms.check_token(room_id, token))
        self.assertTrue(self.rooms.check_token(room_id.lower(), token))
        self.assertFalse(self.rooms.check_token(room_id, "x" + token[1:]))
        self.assertIsNone(self.rooms.authenticate(room_id, "errada"))
        self.assertEqual(self.rooms.authenticate(room_id, "segredo1"), token)

    def test_hash_not_plaintext(self):
        h, salt = security.hash_password("abc12345")
        self.assertNotIn("abc12345", h)
        self.assertTrue(security.verify_password("abc12345", h, salt))

    def test_state_persists(self):
        room_id, _ = self.rooms.create_room("segredo1")

        async def go():
            async with self.rooms.locked(room_id) as room:
                _add(room, 0)

        asyncio.run(go())
        fresh = RoomManager(self.repo).get_room(room_id)
        self.assertIsNotNone(fresh.current)
        self.assertEqual(fresh.state_version, 1)


class FakeWS:
    def __init__(self):
        self.sent: list[dict] = []
        self.closed = False

    async def send_text(self, text: str):
        self.sent.append(json.loads(text))

    async def close(self, *a, **k):
        self.closed = True

    def types(self):
        return [m["type"] for m in self.sent]


class DispatcherTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.rooms = RoomManager(SQLiteRoomRepository(Path(self.tmp.name) / "t.db"))
        self.conns = ConnectionManager()
        self.disp = EventDispatcher(self.rooms, self.conns)
        self.room_id, _ = self.rooms.create_room("segredo1")

        async def fake_meta(video_id, timeout=3.0):
            return metadata.VideoMetadata("Seven Nation Army", "The White Stripes", "", True)

        import app.websocket.events as events_mod

        self._orig = events_mod.fetch_metadata
        events_mod.fetch_metadata = fake_meta

    def tearDown(self):
        import app.websocket.events as events_mod

        events_mod.fetch_metadata = self._orig
        self.tmp.cleanup()

    def test_full_flow(self):
        async def go():
            a, b = FakeWS(), FakeWS()
            ca, cb = Connection(ws=a, room_id=self.room_id), Connection(ws=b, room_id=self.room_id)
            await self.disp.join(ca, "pa", "Gus")
            await self.disp.join(cb, "pb", "João")
            self.assertEqual(a.sent[0]["type"], Ev.STATE_SYNC)
            self.assertIn(Ev.USER_JOINED, a.types())

            # clock ping
            await self.disp.handle(ca, {"type": Ev.CLOCK_PING, "payload": {"t1": 123}}, 5.0)
            pong = a.sent[-1]
            self.assertEqual(pong["type"], Ev.CLOCK_PONG)
            self.assertEqual(pong["payload"]["t1"], 123)
            self.assertGreaterEqual(pong["payload"]["t3"], 5.0)

            await self.disp.handle(
                ca, {"type": Ev.TRACK_ADD, "request_id": "r1", "payload": {"url": "https://youtu.be/dQw4w9WgXcQ"}}, 0
            )
            added = [m for m in b.sent if m["type"] == Ev.TRACK_ADD][-1]
            self.assertEqual(added["payload"]["room"]["currentTrack"]["title"], "Seven Nation Army")
            self.assertEqual(added["payload"]["room"]["playbackState"], "playing")
            self.assertEqual(a.sent[-1]["type"], Ev.ACK)

            await self.disp.handle(cb, {"type": Ev.PLAYER_PAUSE_REQUEST, "payload": {}}, 0)
            pause = [m for m in a.sent if m["type"] == Ev.PLAYER_PAUSE][-1]
            self.assertIn("executeAt", pause["payload"])
            self.assertGreater(pause["payload"]["executeAt"], pause["server_timestamp"])

            # versões estritamente crescentes no que A recebeu
            versions = [m["state_version"] for m in a.sent if "state_version" in m and m["state_version"]]
            self.assertEqual(versions, sorted(versions))

            # erro amigável
            await self.disp.handle(ca, {"type": Ev.TRACK_ADD, "request_id": "r2", "payload": {"url": "nope"}}, 0)
            self.assertEqual(a.sent[-1]["type"], Ev.ERROR)
            self.assertEqual(a.sent[-1]["payload"]["request_id"], "r2")

            await self.disp.leave(cb)
            left = [m for m in a.sent if m["type"] == Ev.USER_LEFT][-1]
            people = {p["id"]: p["connected"] for p in left["payload"]["room"]["participants"]}
            self.assertEqual(people, {"pa": True, "pb": False})
            for t in list(self.disp._prune_tasks.values()):
                t.cancel()

        asyncio.run(go())

    def test_concurrent_commands_serialized(self):
        async def go():
            a = FakeWS()
            ca = Connection(ws=a, room_id=self.room_id)
            await self.disp.join(ca, "pa", "Gus")
            await self.disp.handle(ca, {"type": Ev.TRACK_ADD, "payload": {"url": "dQw4w9WgXcQ"}}, 0)
            v0 = self.rooms.get_room(self.room_id).state_version
            await asyncio.gather(
                self.disp.handle(ca, {"type": Ev.PLAYER_PAUSE_REQUEST, "payload": {}}, 0),
                self.disp.handle(ca, {"type": Ev.PLAYER_PAUSE_REQUEST, "payload": {}}, 0),
                self.disp.handle(ca, {"type": Ev.PLAYER_SEEK_REQUEST, "payload": {"position": 30}}, 0),
            )
            # duas pausas simultâneas viram uma só; seek aplica: +2 versões
            self.assertEqual(self.rooms.get_room(self.room_id).state_version, v0 + 2)

        asyncio.run(go())


if __name__ == "__main__":
    unittest.main()
