"""Extração de videoId e metadados básicos do YouTube.

Os metadados vêm do endpoint público oEmbed (sem chave de API).
Se falhar, a música entra na fila com um título provisório e o
primeiro cliente que carregar o vídeo envia o título real (TRACK_META).
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def extract_video_id(raw: str) -> Optional[str]:
    """Aceita watch?v=, youtu.be/, shorts/, embed/, live/, music.youtube e o próprio ID."""
    if not raw:
        return None
    text = raw.strip()
    if _ID_RE.match(text):
        return text
    if "://" not in text:
        text = "https://" + text
    try:
        url = urllib.parse.urlparse(text)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]

    candidate: Optional[str] = None
    if host == "youtu.be":
        candidate = url.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "music.youtube.com", "youtube-nocookie.com"):
        parts = [p for p in url.path.split("/") if p]
        if parts and parts[0] == "watch":
            candidate = urllib.parse.parse_qs(url.query).get("v", [None])[0]
        elif len(parts) >= 2 and parts[0] in ("shorts", "embed", "live", "v"):
            candidate = parts[1]
    if candidate and _ID_RE.match(candidate):
        return candidate
    return None


@dataclass
class VideoMetadata:
    title: str
    author: str
    thumbnail: str
    resolved: bool


def thumbnail_url(video_id: str) -> str:
    return f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg"


def _fetch_oembed_sync(video_id: str, timeout: float) -> Optional[dict]:
    target = urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
    req = urllib.request.Request(
        f"https://www.youtube.com/oembed?url={target}&format=json",
        headers={"User-Agent": "EchoRoom/0.1"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (URL fixa)
        return json.loads(resp.read().decode("utf-8"))


async def fetch_metadata(video_id: str, timeout: float = 3.0) -> VideoMetadata:
    try:
        data = await asyncio.to_thread(_fetch_oembed_sync, video_id, timeout)
    except Exception:  # rede, 401 (embed bloqueado), 404...
        data = None
    if data and data.get("title"):
        return VideoMetadata(
            title=str(data["title"])[:200],
            author=str(data.get("author_name", ""))[:120],
            thumbnail=thumbnail_url(video_id),
            resolved=True,
        )
    return VideoMetadata(title=f"youtu.be/{video_id}", author="", thumbnail=thumbnail_url(video_id), resolved=False)
