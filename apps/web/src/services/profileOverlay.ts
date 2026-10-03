import { navigate, PROFILE_PATH } from '../router'
import { createStore } from '../stores/createStore'
import { hasActiveSession } from './externalAdd'

/**
 * Perfil por cima da sala: dentro de uma sala, abrir o perfil não sai da
 * página (a música continua). O endereço ganha "#perfil", então o botão
 * Voltar do navegador fecha o perfil e volta para a sala.
 */
const HASH = '#perfil'

export const profileOverlayStore = createStore<{ open: boolean }>({ open: false })

let pushed = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const open = window.location.hash === HASH
    if (!open) pushed = false
    profileOverlayStore.set({ open: open && hasActiveSession() })
  })
}

/** Abre o perfil: por cima da sala se houver uma aberta, senão a página /perfil. */
export function goToProfile(): void {
  if (!hasActiveSession()) return navigate(PROFILE_PATH)
  if (window.location.hash !== HASH) {
    window.history.pushState(null, '', window.location.pathname + window.location.search + HASH)
    pushed = true
  }
  profileOverlayStore.set({ open: true })
}

export function closeProfileOverlay(): void {
  if (!profileOverlayStore.get().open) return
  profileOverlayStore.set({ open: false })
  if (window.location.hash !== HASH) return
  if (pushed) {
    pushed = false
    window.history.back()
  } else {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
}

/** A sala abriu com "#perfil" no endereço (recarregou a página com o perfil aberto). */
export function syncProfileOverlayWithUrl(): void {
  profileOverlayStore.set({ open: window.location.hash === HASH && hasActiveSession() })
}

/** A sala fechou (saiu para outra página): o perfil por cima some junto. */
export function resetProfileOverlay(): void {
  pushed = false
  profileOverlayStore.set({ open: false })
}
