import { appPath, navigate, START_PATH } from '../router'
import { createStore } from '../stores/createStore'
import { storage } from '../utils/storage'
import { authStore } from './discordAuth'

/**
 * Músicas que chegam de fora da página:
 * - da extensão do Chrome, por mensagem (aba do EchoRoom já aberta), ou
 * - pela URL ?add=<link>&title=<nome> (extensão abrindo uma aba nova).
 *
 * Se há uma sala aberta, a música entra na hora. Senão, fica pendente e o
 * site vai para a última sala usada (entrando sozinho se nome e senha já
 * estiverem salvos neste navegador).
 */

export interface PendingAdd {
  url: string
  title?: string
}

const PENDING_KEY = 'echoroom.pendingAdd'
const AUTOJOIN_KEY = 'echoroom.autojoin'

interface ActiveSessionLike {
  roomId: string
  addFromExternal(url: string, title?: string): Promise<void>
}

let active: ActiveSessionLike | null = null

/** Pendência visível na página inicial. */
export const pendingStore = createStore<{ pending: PendingAdd | null }>({ pending: readPending() })

export function setActiveSession(s: ActiveSessionLike | null): void {
  active = s
}

/** Há uma sala aberta nesta aba (a música está tocando aqui). */
export function hasActiveSession(): boolean {
  return active !== null
}

function readPending(): PendingAdd | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    return raw ? (JSON.parse(raw) as PendingAdd) : null
  } catch {
    return null
  }
}

function writePending(p: PendingAdd | null): void {
  try {
    if (p) sessionStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else sessionStorage.removeItem(PENDING_KEY)
  } catch {
    /* sem sessionStorage: segue só em memória */
  }
  pendingStore.set({ pending: p })
}

export function consumePendingAdd(): PendingAdd | null {
  const p = pendingStore.get().pending
  if (p) writePending(null)
  return p
}

export function clearPendingAdd(): void {
  writePending(null)
}

/** Entrada automática na sala (sem a tela de nome/senha) quando veio da extensão. */
export function takeAutoJoin(roomId: string): boolean {
  try {
    if (sessionStorage.getItem(AUTOJOIN_KEY) !== roomId.toUpperCase()) return false
    sessionStorage.removeItem(AUTOJOIN_KEY)
  } catch {
    return false
  }
  return !!storage.getRoomKey(roomId) && !!(authStore.get().profile || storage.getName().trim())
}

export function handleExternalAdd(add: PendingAdd, replace = false): void {
  if (!add.url) return
  if (active) {
    void active.addFromExternal(add.url, add.title)
    return
  }
  writePending(add)
  const last = storage.getLastRoom()
  if (last && storage.getRoomKey(last) && (authStore.get().profile || storage.getName().trim())) {
    try {
      sessionStorage.setItem(AUTOJOIN_KEY, last)
    } catch {
      /* ignora */
    }
    navigate(`/room/${last}`, replace)
  } else {
    navigate(START_PATH, replace)
  }
}

/** Chamado uma vez ao abrir o site. */
export function initExternalAdd(): void {
  // 1) ?add= na URL (extensão abriu uma aba nova)
  const params = new URLSearchParams(window.location.search)
  const url = params.get('add')
  if (url) {
    const title = params.get('title') ?? undefined
    params.delete('add')
    params.delete('title')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
    handleExternalAdd({ url, title }, true)
  }

  // 2) mensagens da extensão (aba do EchoRoom já aberta)
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return
    const data = ev.data as { source?: string; type?: string; url?: string; title?: string }
    if (data?.source !== 'echoroom-extension' || data.type !== 'ADD' || typeof data.url !== 'string') return
    handleExternalAdd({ url: data.url, title: data.title })
  })

  // Sinaliza para a extensão que esta aba é o EchoRoom.
  document.documentElement.dataset.echoroom = appPath('/')
}
