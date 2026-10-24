import { useRef, useState, type FormEvent } from 'react'
import { USERNAME_RE } from '@echoroom/shared'
import { cancelEmail, confirmEmail, emailStore, submitNewAccount } from '../../services/emailAuth'
import { useStore } from '../../stores/createStore'
import { CloseIcon } from '../ui/Icons'

/**
 * Passos do login por e-mail que aparecem por cima de qualquer página:
 * confirmar o e-mail (link aberto em outro navegador) e criar a conta.
 */
export function EmailDialog() {
  const { step, error, email } = useStore(emailStore, (s) => s)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [confirm, setConfirm] = useState('')
  // Enquanto envia ("working"), continua aberto o passo que estava na tela.
  const last = useRef<'askEmail' | 'profile' | null>(null)
  if (step === 'askEmail' || step === 'profile') last.current = step
  else if (step !== 'working') last.current = null
  const shown = last.current
  if (!shown) return null
  const working = step === 'working'

  function create(e: FormEvent) {
    e.preventDefault()
    void submitNewAccount(name, username)
  }

  function sendConfirm(e: FormEvent) {
    e.preventDefault()
    void confirmEmail(confirm)
  }

  const userOk = USERNAME_RE.test(username.trim().toLowerCase().replace(/^@/, ''))

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && !working && cancelEmail()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={shown === 'profile' ? 'Criar conta' : 'Confirmar e-mail'}>
        <header className="drawer-head">
          <h2>{shown === 'profile' ? 'Criar sua conta' : 'Confirmar e-mail'}</h2>
          <button type="button" className="icon-btn drawer-close" aria-label="Fechar" disabled={working} onClick={cancelEmail}>
            <CloseIcon width={18} height={18} />
          </button>
        </header>
        <div className="drawer-body">
          {shown === 'askEmail' ? (
            <form className="drawer-section" onSubmit={sendConfirm}>
              <p className="hint">O link foi aberto em outro navegador. Digite o e-mail que recebeu o link para continuar.</p>
              <label className="field">
                <span>E-mail</span>
                <input type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="email" autoFocus disabled={working} />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={working || !confirm.trim()}>
                {working ? 'Entrando…' : 'Continuar'}
              </button>
            </form>
          ) : (
            <form className="drawer-section" onSubmit={create}>
              <p className="hint">
                Primeira vez{email ? ` com ${email}` : ''}. Escolha como os outros vão te ver. Depois dá para vincular o Discord no perfil.
              </p>
              <label className="field">
                <span>Nome</span>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoComplete="nickname" autoFocus disabled={working} />
              </label>
              <label className="field">
                <span>Nome de usuário</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  maxLength={33}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="ex.: gustavo.t"
                  disabled={working}
                />
                <small className="hint">Usado para te convidarem. Letras minúsculas, números, ponto ou _.</small>
              </label>
              {error && <p className="form-error">{error}</p>}
              <button type="submit" className="btn btn-primary" disabled={working || !name.trim() || !userOk}>
                {working ? 'Criando…' : 'Criar conta'}
              </button>
            </form>
          )}
        </div>
      </aside>
    </div>
  )
}
