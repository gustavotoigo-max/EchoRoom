"""Aplicação FastAPI do EchoRoom.

Desenvolvimento:
    uvicorn app.main:app --reload --port 8000

Produção (front compilado em ../frontend/dist):
    uvicorn app.main:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.rooms import router as rooms_router
from app.config import settings
from app.database.repository import SQLiteRoomRepository
from app.rooms.manager import RoomManager, RoomNotFound
from app.sync.clock import server_now
from app.websocket.events import EventDispatcher, Ev
from app.websocket.manager import Connection, ConnectionManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# Códigos de fechamento WebSocket usados pelo front-end
WS_UNAUTHORIZED = 4401
WS_ROOM_NOT_FOUND = 4404
WS_BAD_JOIN = 4400


@asynccontextmanager
async def lifespan(app: FastAPI):
    repo = SQLiteRoomRepository(settings.database_path)
    app.state.rooms = RoomManager(repo)
    app.state.conns = ConnectionManager()
    app.state.dispatcher = EventDispatcher(app.state.rooms, app.state.conns)
    yield


app = FastAPI(title="EchoRoom", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip().rstrip("/") for o in settings.cors_origins if o.strip()],
    allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(rooms_router)


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "server_time": server_now()}


@app.websocket("/ws/{room_id}")
async def room_socket(ws: WebSocket, room_id: str) -> None:
    rooms: RoomManager = ws.app.state.rooms
    dispatcher: EventDispatcher = ws.app.state.dispatcher
    room_id = rooms.normalize_id(room_id)
    token = ws.query_params.get("token", "")

    await ws.accept()
    try:
        if not rooms.check_token(room_id, token):
            await ws.close(code=WS_UNAUTHORIZED, reason="Senha necessária")
            return
    except RoomNotFound:
        await ws.close(code=WS_ROOM_NOT_FOUND, reason="Sala não encontrada")
        return

    conn = Connection(ws=ws, room_id=room_id)
    try:
        first = json.loads(await ws.receive_text())
        if first.get("type") != Ev.ROOM_JOIN:
            await ws.close(code=WS_BAD_JOIN, reason="ROOM_JOIN esperado")
            return
        p = first.get("payload") or {}
        await dispatcher.join(conn, str(p.get("participantId", "")), str(p.get("name", "")))

        while True:
            text = await ws.receive_text()
            received_at = server_now()  # T2 do clock sync: o mais cedo possível
            try:
                msg = json.loads(text)
            except json.JSONDecodeError:
                continue
            await dispatcher.handle(conn, msg, received_at)
    except WebSocketDisconnect:
        pass
    finally:
        await dispatcher.leave(conn)


# ---- front-end compilado (opcional) -------------------------------------

if settings.frontend_dist.is_dir():
    assets = settings.frontend_dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = settings.frontend_dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(settings.frontend_dist / "index.html")
