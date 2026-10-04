import * as Clipboard from 'expo-clipboard'
import { SITE_URL } from './env'

/** Versão do celular de utils/format do site (sem import.meta e sem DOM). */

export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export const BASE_PATH = '/EchoRoom/'

export function roomPath(roomId: string): string {
  return `${BASE_PATH}room/${roomId}`
}

/** Link da sala no site (para compartilhar). */
export function roomLink(roomId: string): string {
  return `${SITE_URL}/room/${roomId}`
}

/** Aceita "ABX72", "abx72" ou um link completo .../room/ABX72 */
export function parseRoomInput(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  const fromLink = text.match(/\/room\/([A-Za-z0-9]{4,12})/)
  if (fromLink) return fromLink[1].toUpperCase()
  if (/^[A-Za-z0-9]{4,12}$/.test(text)) return text.toUpperCase()
  return null
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text)
    return true
  } catch {
    return false
  }
}
