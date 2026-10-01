"""Relógio do servidor.

Usa um relógio monotônico ancorado ao relógio de parede no início do
processo. Assim o tempo da sala não salta se o relógio do sistema for
ajustado (NTP) enquanto o servidor roda, mas continua expresso em
segundos Unix — o que permite persistir timelines entre reinícios.
"""

from __future__ import annotations

import time

_ANCHOR_WALL = time.time()
_ANCHOR_MONO = time.perf_counter()


def server_now() -> float:
    """Tempo atual do servidor em segundos (float, alta resolução)."""
    return _ANCHOR_WALL + (time.perf_counter() - _ANCHOR_MONO)
