/**
 * Versão do celular de services/externalAdd. No site, é a ponte com a
 * extensão do Chrome; no app só guarda qual sala está aberta.
 */

export interface PendingAdd {
  url: string
  title?: string
}

interface ActiveSessionLike {
  roomId: string
  addFromExternal(url: string, title?: string): Promise<void>
}

let active: ActiveSessionLike | null = null

export function setActiveSession(s: ActiveSessionLike | null): void {
  active = s
}

export function hasActiveSession(): boolean {
  return active !== null
}

export function getActiveSession(): ActiveSessionLike | null {
  return active
}

export function consumePendingAdd(): PendingAdd | null {
  return null
}

export function clearPendingAdd(): void {}

export function takeAutoJoin(_roomId: string): boolean {
  return false
}
