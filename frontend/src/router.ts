import { useSyncExternalStore } from 'react'

/** Roteador mínimo (duas rotas) sem dependências. */

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') window.addEventListener('popstate', notify)

export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  notify()
}

export function usePathname(): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => window.location.pathname,
  )
}

export function matchRoom(pathname: string): string | null {
  const m = pathname.match(/^\/room\/([A-Za-z0-9]{3,12})\/?$/)
  return m ? m[1].toUpperCase() : null
}
