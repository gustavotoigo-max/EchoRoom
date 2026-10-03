import { navigate, START_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { goToProfile } from '../../services/profileOverlay'
import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import { describeStatus } from '../RoomHeader/RoomHeader'
import { LeaveIcon } from '../ui/Icons'

/** Canto inferior esquerdo, como o painel do usuário no Discord. */
export function UserPanel() {
  const listed = useStore(roomStore, (s) => s.room?.participants.find((p) => p.id === s.participantId)?.name ?? '')
  const profile = useStore(authStore, (s) => s.profile)
  const name = listed || profile?.name || ''
  const avatar = profile?.avatarUrl ?? null
  const conn = useStore(roomStore, (s) => s.connection)
  const sync = useStore(playerStore, (s) => s.sync)
  const { label, tone } = describeStatus(conn, sync)

  const who = (
    <>
      <span className="p-avatar" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" width={32} height={32} /> : <b>{name.trim().charAt(0).toUpperCase() || '?'}</b>}
        <i className={`presence tone-${tone}`} />
      </span>
      <div className="user-text">
        <strong>{name || '…'}</strong>
        <span className={`tone-${tone}`}>{label}</span>
      </div>
    </>
  )

  return (
    <div className="user-panel">
      {/* Com Discord, abre o perfil por cima da sala (a música continua). */}
      {profile ? (
        <button type="button" className="user-who" title="Seu perfil" onClick={goToProfile}>
          {who}
        </button>
      ) : (
        <div className="user-who">{who}</div>
      )}
      <button type="button" className="icon-btn user-leave" title="Sair da sala" aria-label="Sair da sala" onClick={() => navigate(START_PATH)}>
        <LeaveIcon width={18} height={18} />
      </button>
    </div>
  )
}
