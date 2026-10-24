import { useEffect, useRef, useState } from 'react'
import { renderGoogleButton } from '../../services/googleAuth'

/** Botão oficial do Google ("Fazer login com o Google"), na largura do espaço disponível. */
export function GoogleButton({ mode = 'login' }: { mode?: 'login' | 'link' }) {
  const ref = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    renderGoogleButton(el, mode, mode === 'link' ? 200 : el.clientWidth || 320).catch(() => setFailed(true))
  }, [mode])

  if (failed) return <p className="form-error">Não foi possível carregar o login do Google.</p>
  return <div ref={ref} className={`google-btn ${mode === 'link' ? 'is-link' : ''}`} />
}
