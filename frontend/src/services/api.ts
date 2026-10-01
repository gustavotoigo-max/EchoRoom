/** Chamadas HTTP (somente criação/entrada de sala; o resto é WebSocket). */

/**
 * Endereço do backend.
 * - Vazio (desenvolvimento / mesmo domínio): usa caminhos relativos, e o
 *   Vite encaminha /api e /ws para o FastAPI.
 * - Em produção com front e backend separados (ex.: Vercel + Render),
 *   defina VITE_BACKEND_URL=https://seu-backend.onrender.com
 */
export const BACKEND_URL = ((import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

export interface RoomAccess {
  room_id: string
  token: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(
      'Não foi possível falar com o servidor. Se ele estava parado, pode levar até um minuto para acordar — tente de novo.',
      0,
    )
  }
  if (!res.ok) {
    let message = `Erro ${res.status}`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (Array.isArray(body.detail)) message = 'A senha precisa ter pelo menos 4 caracteres.'
    } catch {
      /* corpo vazio */
    }
    throw new ApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

export const api = {
  createRoom: (password: string) =>
    call<RoomAccess>('/api/rooms', { method: 'POST', body: JSON.stringify({ password }) }),

  getRoom: (roomId: string) => call<{ room_id: string }>(`/api/rooms/${encodeURIComponent(roomId)}`),

  joinRoom: (roomId: string, password: string) =>
    call<RoomAccess>(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
}

export function wsUrl(roomId: string, token: string): string {
  const path = `/ws/${encodeURIComponent(roomId)}?token=${encodeURIComponent(token)}`
  if (BACKEND_URL) return BACKEND_URL.replace(/^http/, 'ws') + path
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${path}`
}
