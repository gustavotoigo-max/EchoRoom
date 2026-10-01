export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function roomLink(roomId: string): string {
  return `${window.location.origin}/room/${roomId}`
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
