import { useSyncExternalStore } from 'react'

/** Roteador mínimo sem dependências: / (apresentação), /comecar (criar ou entrar) e /room/CODIGO. */

const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') window.addEventListener('popstate', notify)

/** Navega para um caminho da aplicação ("/" ou "/room/ABX72"). */
export function navigate(appRelative: string, replace = false): void {
  const path = appPath(appRelative)
  if (path === window.location.pathname) return
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.scrollTo(0, 0)
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

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')

/** Caminho relativo à base do site (GitHub Pages publica em /NomeDoRepo/). */
export function appPath(path: string): string {
  return BASE + path.replace(/^\//, '')
}

export function matchRoom(pathname: string): string | null {
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length - 1) : pathname
  const m = rel.match(/^\/room\/([A-Za-z0-9]{3,12})\/?$/)
  return m ? m[1].toUpperCase() : null
}

/** Página de criar ou entrar em uma sala. */
export const START_PATH = '/comecar'

export function isStartPath(pathname: string): boolean {
  const rel = pathname.startsWith(BASE) ? pathname.slice(BASE.length - 1) : pathname
  return /^\/comecar\/?$/.test(rel)
}
