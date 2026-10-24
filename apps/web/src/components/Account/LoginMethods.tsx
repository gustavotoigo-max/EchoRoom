import { useEffect, useState, type FormEvent } from 'react'
import type { AccountMethods } from '@echoroom/shared'
import { fetchMethods, unlinkMethod } from '../../services/accountApi'
import { accountVersion, discordEnabled, emailEnabled, startDiscordLink } from '../../services/discordAuth'
import { emailStore, sendEmailLink } from '../../services/emailAuth'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { DiscordIcon } from '../ui/Icons'

/** Perfil: Discord e e-mail ligados à conta, com vincular e desvincular. */
export function LoginMethods() {
  const version = useStore(accountVersion, (s) => s.n)
  const email = useStore(emailStore, (s) => s)
  const [methods, setMethods] = useState<AccountMethods | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [address, setAddress] = useState('')

  useEffect(() => {
    let live = true
    fetchMethods()
      .then((m) => live && (setMethods(m), setFailed(false)))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [version])

  async function unlink(provider: 'discord' | 'email') {
    setBusy(true)
    try {
      setMethods(await unlinkMethod(provider))
      showToast(provider === 'discord' ? 'Discord desvinculado.' : 'E-mail desvinculado.', 'ok', 3000)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  function addEmail(e: FormEvent) {
    e.preventDefault()
    void sendEmailLink(address, 'link')
  }

  if (failed) return <p className="hint">Não foi possível carregar as formas de entrar agora.</p>
  if (!methods) return <div className="skeleton skeleton-line" />
  const both = !!methods.discord && methods.email

  return (
    <ul className="login-methods">
      <li>
        <DiscordIcon width={18} height={18} />
        <span className="lm-text">
          <strong>Discord</strong>
          <small>{methods.discord ? `@${methods.discord.username}` : 'não vinculado'}</small>
        </span>
        {methods.discord ? (
          <button type="button" className="btn btn-secondary" disabled={busy || !both} title={both ? undefined : 'É a única forma de entrar'} onClick={() => unlink('discord')}>
            Desvincular
          </button>
        ) : (
          discordEnabled && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={startDiscordLink}>
              Vincular
            </button>
          )
        )}
      </li>
      <li>
        <span className="lm-icon" aria-hidden="true">@</span>
        <span className="lm-text">
          <strong>E-mail</strong>
          <small>{methods.email ? 'vinculado (entra com link de acesso)' : 'não vinculado'}</small>
        </span>
        {methods.email ? (
          <button type="button" className="btn btn-secondary" disabled={busy || !both} title={both ? undefined : 'É a única forma de entrar'} onClick={() => unlink('email')}>
            Desvincular
          </button>
        ) : (
          emailEnabled &&
          !adding && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAdding(true)}>
              Vincular
            </button>
          )
        )}
      </li>
      {!methods.email && adding && (
        <li className="lm-form">
          {email.step === 'sent' ? (
            <p className="hint">Enviamos um link para {email.email}. Abra neste navegador para vincular.</p>
          ) : (
            <form className="inline-field" onSubmit={addEmail}>
              <input type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="seu@email.com" aria-label="E-mail para vincular" autoFocus />
              <button type="submit" className="btn btn-primary" disabled={email.step === 'working' || !address.trim()}>
                {email.step === 'working' ? 'Enviando…' : 'Receber link'}
              </button>
            </form>
          )}
          {email.error && <p className="form-error">{email.error}</p>}
        </li>
      )}
    </ul>
  )
}
