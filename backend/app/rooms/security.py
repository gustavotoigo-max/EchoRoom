"""Senha da sala e token de acesso.

- A senha é guardada como hash scrypt com salt (biblioteca padrão).
- Ao criar a sala ou acertar a senha, o cliente recebe um token HMAC
  ligado à sala. O token é guardado no navegador e enviado ao abrir o
  WebSocket, de modo que reconexões não pedem a senha de novo.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, password_hash)


def make_token(secret: bytes, room_id: str, password_salt: str) -> str:
    # O salt entra na assinatura: trocar a senha invalida tokens antigos.
    mac = hmac.new(secret, f"{room_id}:{password_salt}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def verify_token(secret: bytes, room_id: str, password_salt: str, token: str) -> bool:
    if not token:
        return False
    return hmac.compare_digest(make_token(secret, room_id, password_salt), token)
