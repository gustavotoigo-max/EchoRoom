export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Base do site (ex.: "/EchoRoom/" no GitHub Pages, "/" localmente). */
export const BASE_PATH = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

export function roomPath(roomId: string): string {
  return `${BASE_PATH}room/${roomId}`
}

export function roomLink(roomId: string): string {
  return `${window.location.origin}${roomPath(roomId)}`
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
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Fallback para contextos sem Clipboard API (http em rede local)
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    el.remove()
    return ok
  }
}

/** "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias". */
export function timeAgo(ms: number): string {
  if (!ms) return ''
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

/** Remove acentos e caixa (para buscas). */
export const normalizeText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
