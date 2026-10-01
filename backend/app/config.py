"""Configuração central do backend.

Todos os limites e tempos ficam aqui para poderem ser calibrados
sem alterar vários módulos.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    # Persistência
    database_path: Path = Path(os.getenv("ECHOROOM_DB", BASE_DIR / "echoroom.db"))

    # Sincronização (segundos, relógio do servidor)
    command_lead_time: float = float(os.getenv("ECHOROOM_COMMAND_LEAD", "0.4"))
    track_change_lead_time: float = float(os.getenv("ECHOROOM_TRACK_LEAD", "1.2"))
    # Tolerância para aceitar TRACK_ENDED antes do fim teórico
    track_end_tolerance: float = 3.0

    # Salas
    room_id_length: int = 5
    password_min_length: int = 4
    password_max_length: int = 128
    name_max_length: int = 32
    max_queue_size: int = 200
    participant_grace_seconds: float = 30.0
    wrong_password_delay: float = 0.4

    # Front-end compilado (servido pelo FastAPI em produção)
    frontend_dist: Path = Path(
        os.getenv("ECHOROOM_FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist")
    )

    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv(
            "ECHOROOM_CORS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
    )
    # Regex opcional para liberar vários domínios (ex.: previews da Vercel):
    # ECHOROOM_CORS_REGEX=https://echoroom.*\.vercel\.app
    cors_origin_regex: str | None = os.getenv("ECHOROOM_CORS_REGEX") or None


settings = Settings()
