"""Esquema do banco.

SQL simples e portável. Para migrar para PostgreSQL basta trocar a
implementação do repositório (mesma interface) e ajustar tipos
(TEXT/JSONB, REAL/DOUBLE PRECISION).
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
    room_id       TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at    REAL NOT NULL,
    updated_at    REAL NOT NULL,
    state_json    TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""
