import { createStore } from './createStore'

/** Avisos curtos na sala (entrada com música tocando, músicas da extensão, playlists...). */

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'ok' | 'error'
}

export const toastStore = createStore<{ toasts: Toast[] }>({ toasts: [] })

let seq = 0

export function showToast(text: string, kind: Toast['kind'] = 'info', durationMs = 6000): number {
  const id = ++seq
  // No máximo 3 visíveis: os mais antigos saem primeiro.
  toastStore.set((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-3) }))
  if (durationMs > 0) setTimeout(() => dismissToast(id), durationMs)
  return id
}

export function dismissToast(id: number): void {
  toastStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}
