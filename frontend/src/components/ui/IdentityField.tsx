import { authStore, discordEnabled, logoutDiscord, startDiscordLogin } from '../../services/discordAuth'
import { useStore } from '../../stores/createStore'
import { DiscordIcon } from './Icons'

interface Props {
  /** Nome digitado para entrar como convidado. */
  guestName: string
  onGuestName: (name: string) => void
  autoFocus?: boolean
  /** Sem opção de convidado (ex.: criar sala exige Discord). */
  discordOnly?: boolean
}

/**
 * "Quem é você": entrar com Discord (nome e avatar) ou como convidado.
 * Sem o Client ID do Discord configurado, mostra só o campo de nome.
 */
export function IdentityField({ guestName, onGuestName, autoFocus, discordOnly }: Props) {
  const { profile, busy, error } = useStore(authStore, (s) => s)

  if (profile) {
    return (
      <div className="identity identity-on">
        <img className="avatar avatar-lg" src={profile.avatarUrl} alt="" width={40} height={40} />
        <div className="identity-text">
          <strong>{profile.name}</strong>
          <span>conectado com Discord</span>
        </div>
        <button type="button" className="link-btn" onClick={() => void logoutDiscord()}>
          Sair
        </button>
      </div>
    )
  }

  if (discordOnly) {
    return (
      <div className="identity">
        <p className="hint">Para criar uma sala, entre com Discord: o dono precisa de uma conta para administrar a sala.</p>
        {discordEnabled ? (
          <button type="button" className="btn btn-discord" onClick={startDiscordLogin} disabled={busy}>
            <DiscordIcon width={20} height={20} />
            <span>{busy ? 'Conectando ao Discord…' : 'Entrar com Discord'}</span>
          </button>
        ) : (
          <p className="form-error">O login com Discord ainda não foi configurado neste site.</p>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="identity">
      {discordEnabled && (
        <>
          <button type="button" className="btn btn-discord" onClick={startDiscordLogin} disabled={busy}>
            <DiscordIcon width={20} height={20} />
            <span>{busy ? 'Conectando ao Discord…' : 'Entrar com Discord'}</span>
          </button>
          {error && <p className="form-error">{error}</p>}
          <div className="identity-or" aria-hidden="true">
            <span>ou entre como convidado</span>
          </div>
        </>
      )}
      <label className="field">
        <span>{discordEnabled ? 'Nome de convidado' : 'Seu nome'}</span>
        <input
          value={guestName}
          onChange={(e) => onGuestName(e.target.value)}
          maxLength={32}
          autoComplete="nickname"
          autoFocus={autoFocus}
          placeholder="Como os outros vão te ver"
        />
      </label>
    </div>
  )
}

/** Nome e avatar que valem agora (Discord tem prioridade sobre convidado). */
export function currentIdentity(guestName: string): { name: string; avatar: string | null } {
  const p = authStore.get().profile
  return p ? { name: p.name, avatar: p.avatarUrl } : { name: guestName.trim(), avatar: null }
}
