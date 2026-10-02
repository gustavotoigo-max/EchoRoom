import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../stores/createStore'
import { THEMES, setTheme, themeStore } from '../../theme/themes'
import { CheckIcon, PaletteIcon } from './Icons'

/** Botão "Tema" com a lista de temas. */
export function ThemePicker() {
  const current = useStore(themeStore, (s) => s.theme)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const name = THEMES.find((t) => t.id === current)?.name ?? 'Tema'

  return (
    <div className="theme-picker" ref={ref}>
      <button
        type="button"
        className="theme-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Tema: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <PaletteIcon width={16} height={16} />
        <span className="theme-btn-label">Tema</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Escolher tema">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === current}
              className={t.id === current ? 'on' : ''}
              onClick={() => {
                setTheme(t.id)
                setOpen(false)
              }}
            >
              <span className="theme-swatch" aria-hidden="true">
                {t.swatch.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <span className="theme-name">{t.name}</span>
              {t.id === current && <CheckIcon width={16} height={16} />}
            </button>
          ))}
          <p className="theme-note">Vale só para você, neste navegador.</p>
        </div>
      )}
    </div>
  )
}
