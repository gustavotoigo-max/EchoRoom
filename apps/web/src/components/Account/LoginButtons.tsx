import { useState, type FormEvent } from 'react'
import { authStore, discordEnabled, emailEnabled, startDiscordLogin } from '../../services/discordAuth'
import { emailStore, sendEmailLink } from '../../services/emailAuth'
import { useStore } from '../../stores/createStore'
import { DiscordIcon } from '../ui/Icons'

/** Entrar na conta: Discord ou link por e-mail. Nada aparece se nenhum estiver configurado. */
export function LoginButtons({ compact }: { compact?: boolean }) {
  const { busy, error } = useStore(authStore, (s) => s)
  const email = useStore(emailStore, (s) => s)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    void sendEmailLink(value)
  }

  return (
    <div className={`login-buttons ${compact ? 'is-compact' : ''}`}>
      {discordEnabled && (
        <button type="button" className="btn btn-discord" onClick={() => startDiscordLogin()} disabled={busy}>
          <DiscordIcon width={20} height={20} />
          <span>{busy ? 'Conectando ao Discord…' : 'Entrar com Discord'}</span>
        </button>
      )}
      {emailEnabled &&
        (email.step === 'sent' ? (
          <div className="email-sent" role="status">
            <strong>Enviamos um link para {email.email}.</strong>
            <span>Abra o e-mail neste mesmo navegador para entrar. Confira o spam se não chegar.</span>
            <button type="button" className="link-btn" onClick={() => emailStore.set({ step: 'idle' })}>
              Usar outro e-mail
            </button>
          </div>
        ) : open ? (
          <form className="inline-field email-form" onSubmit={submit}>
            <input
              type="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="seu@email.com"
              aria-label="Seu e-mail"
              autoComplete="email"
              autoFocus
              disabled={email.step === 'working'}
            />
            <button type="submit" className="btn btn-primary" disabled={email.step === 'working' || !value.trim()}>
              {email.step === 'working' ? 'Enviando…' : 'Receber link'}
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
            Entrar com e-mail
          </button>
        ))}
      {(error || email.error) && <p className="form-error">{email.error || error}</p>}
      {!discordEnabled && !emailEnabled && <p className="form-error">O login ainda não foi configurado neste site.</p>}
    </div>
  )
}
