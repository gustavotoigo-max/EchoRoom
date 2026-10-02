import { navigate, START_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import { describeStatus } from '../RoomHeader/RoomHeader'
import { LeaveIcon } from '../ui/Icons'

/** Canto inferior esquerdo, como o painel do usuário no Discord. */
export function UserPanel() {
  const name = useStore(roomStore, (s) => s.room?.participants.find((p) => p.id === s.participantId)?.name ?? '')
  const avatar = useStore(authStore, (s) => s.profile?.avatarUrl ?? null)
  const conn = useStore(roomStore, (s) => s.connection)
  const sync = useStore(playerStore, (s) => s.sync)
  const { label, tone } = describeStatus(conn, sync)

  return (
    <div className="user-panel">
      <span className="p-avatar" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" width={32} height={32} /> : <b>{name.trim().charAt(0).toUpperCase() || '?'}</b>}
        <i className={`presence tone-${tone}`} />
      </span>
      <div className="user-text">
        <strong>{name || '…'}</strong>
        <span className={`tone-${tone}`}>{label}</span>
      </div>
      <button type="button" className="icon-btn user-leave" title="Sair da sala" aria-label="Sair da sala" onClick={() => navigate(START_PATH)}>
        <LeaveIcon width={18} height={18} />
      </button>
    </div>
  )
}
