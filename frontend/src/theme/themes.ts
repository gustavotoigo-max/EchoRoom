import { createStore } from '../stores/createStore'

/**
 * Temas visuais. Cada tema é um conjunto de variáveis CSS em
 * styles/themes.css, ativado por <html data-theme="…">. A escolha fica
 * salva só neste navegador.
 */

export type ThemeId = 'echoroom' | 'spotify' | 'light'

export interface ThemeInfo {
  id: ThemeId
  name: string
  /** Cores para a amostra no seletor: fundo, superfície, destaque. */
  swatch: [string, string, string]
  /** Cor da barra do navegador no celular. */
  browserColor: string
}

export const THEMES: ThemeInfo[] = [
  { id: 'echoroom', name: 'EchoRoom', swatch: ['#0e1a22', '#1a2f3a', '#3fb58e'], browserColor: '#0e1a22' },
  { id: 'spotify', name: 'Estilo Spotify', swatch: ['#121212', '#282828', '#1ed760'], browserColor: '#121212' },
  { id: 'light', name: 'Claro', swatch: ['#f4f7f6', '#ffffff', '#1f9e74'], browserColor: '#f4f7f6' },
]

const KEY = 'echoroom.theme'

function readSaved(): ThemeId {
  try {
    const v = localStorage.getItem(KEY) as ThemeId | null
    return THEMES.some((t) => t.id === v) ? (v as ThemeId) : 'echoroom'
  } catch {
    return 'echoroom'
  }
}

export const themeStore = createStore<{ theme: ThemeId }>({ theme: typeof window !== 'undefined' ? readSaved() : 'echoroom' })

export function applyTheme(id: ThemeId): void {
  const info = THEMES.find((t) => t.id === id) ?? THEMES[0]
  document.documentElement.dataset.theme = info.id
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', info.browserColor)
  themeStore.set({ theme: info.id })
}

export function setTheme(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
  applyTheme(id)
}

export function initTheme(): void {
  applyTheme(readSaved())
}
