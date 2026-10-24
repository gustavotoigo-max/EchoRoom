import { authStore, discordEnabled, emailEnabled, logoutDiscord } from '../../services/discordAuth'
import { LoginButtons } from '../Account/LoginButtons'
import { useStore } from '../../stores/createStore'

interface Props {
  /** Nome digitado para entrar como convidado. */
  guestName: string
  onGuestName: (name: string) => void
  autoFocus?: boolean
  /** Sem opção de convidado (ex.: criar sala exige conta). */
  discordOnly?: boolean
}

/**
 * "Quem é você": entrar na conta (Discord ou e-mail) ou como convidado.
 * Sem o serviço de login configurado, mostra só o campo de nome.
 */
export function IdentityField({ guestName, onGuestName, autoFocus, discordOnly }: Props) {
  const profile = useStore(authStore, (s) => s.profile)
  const accounts = discordEnabled || emailEnabled

  if (profile) {
    return (
      <div className="identity identity-on">
        <img className="avatar avatar-lg" src={profile.avatarUrl} alt="" width={40} height={40} />
        <div className="identity-text">
          <strong>{profile.name}</strong>
          <span>@{profile.username}</span>
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
        <p className="hint">Para criar uma sala, entre na sua conta: o dono precisa de uma conta para administrar a sala.</p>
        <LoginButtons />
      </div>
    )
  }

  return (
    <div className="identity">
      {accounts && (
        <>
          <LoginButtons />
          <div className="identity-or" aria-hidden="true">
            <span>ou entre como convidado</span>
          </div>
        </>
      )}
      <label className="field">
        <span>{accounts ? 'Nome de convidado' : 'Seu nome'}</span>
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

/** Nome e avatar que valem agora (a conta tem prioridade sobre convidado). */
export function currentIdentity(guestName: string): { name: string; avatar: string | null } {
  const p = authStore.get().profile
  return p ? { name: p.name, avatar: p.avatarUrl } : { name: guestName.trim(), avatar: null }
}
