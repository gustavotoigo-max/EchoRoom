"""Endpoints HTTP de salas.

POST /api/rooms                 cria sala com senha → {room_id, token}
GET  /api/rooms/{room_id}       verifica se a sala existe
POST /api/rooms/{room_id}/join  valida a senha → {room_id, token}
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings
from app.rooms.manager import RoomManager, RoomNotFound

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


class CreateRoomBody(BaseModel):
    password: str = Field(min_length=settings.password_min_length, max_length=settings.password_max_length)


class JoinRoomBody(BaseModel):
    password: str = Field(min_length=1, max_length=settings.password_max_length)


class RoomAccess(BaseModel):
    room_id: str
    token: str


def _rooms(request: Request) -> RoomManager:
    return request.app.state.rooms


@router.post("", response_model=RoomAccess, status_code=201)
async def create_room(body: CreateRoomBody, request: Request) -> RoomAccess:
    room_id, token = await asyncio.to_thread(_rooms(request).create_room, body.password)
    return RoomAccess(room_id=room_id, token=token)


@router.get("/{room_id}")
async def get_room(room_id: str, request: Request) -> dict:
    rooms = _rooms(request)
    if not rooms.room_exists(room_id):
        raise HTTPException(404, "A sala não existe mais.")
    return {"room_id": rooms.normalize_id(room_id), "password_required": True}


@router.post("/{room_id}/join", response_model=RoomAccess)
async def join_room(room_id: str, body: JoinRoomBody, request: Request) -> RoomAccess:
    rooms = _rooms(request)
    try:
        token = await asyncio.to_thread(rooms.authenticate, room_id, body.password)
    except RoomNotFound:
        raise HTTPException(404, "A sala não existe mais.")
    if token is None:
        await asyncio.sleep(settings.wrong_password_delay)
        raise HTTPException(401, "Senha incorreta.")
    return RoomAccess(room_id=rooms.normalize_id(room_id), token=token)
