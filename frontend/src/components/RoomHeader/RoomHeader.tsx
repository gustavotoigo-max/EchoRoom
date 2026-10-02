import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import type { SyncUiState } from '../../sync/SyncEngine'
import type { ConnectionStatus } from '../../types/room'
import { Brand } from '../ui/Brand'
import { UserChip } from '../Invites/UserChip'
import { openPanel } from '../RoomSettings/ui'
import { GearIcon, LinkIcon, WaveIcon } from '../ui/Icons'

type Tone = 'ok' | 'work' | 'warn' | 'bad' | 'idle'

export function describeStatus(conn: ConnectionStatus, sync: SyncUiState): { label: string; tone: Tone } {
  switch (conn) {
    case 'idle':
    case 'connecting':
      return { label: 'Conectando…', tone: 'work' }
    case 'reconnecting':
      return { label: 'Reconectando…', tone: 'warn' }
    case 'not_found':
      return { label: 'Sala não encontrada', tone: 'bad' }
    case 'closed':
      return { label: 'Desconectado', tone: 'bad' }
  }
  switch (sync) {
    case 'synced':
      return { label: 'Sincronizado', tone: 'ok' }
    case 'adjusting':
      return { label: 'Ajustando sincronização…', tone: 'work' }
    case 'syncing':
      return { label: 'Sincronizando…', tone: 'work' }
    case 'buffering':
      return { label: 'Carregando vídeo…', tone: 'work' }
    case 'unstable':
      return { label: 'Conexão instável', tone: 'warn' }
    default:
      return { label: 'Conectado', tone: 'idle' }
  }
}

export function StatusIndicator() {
  const conn = useStore(roomStore, (s) => s.connection)
  const sync = useStore(playerStore, (s) => s.sync)
  const { label, tone } = describeStatus(conn, sync)
  return (
    <div className={`status status-${tone}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function RoomHeader({ roomId }: { roomId: string }) {
  const name = useStore(roomStore, (s) => s.meta?.name ?? null)
  const isOwner = useStore(roomStore, selectIsOwner)
  return (
    <header className="topbar room-topbar">
      <div className="topbar-brand">
        <Brand />
      </div>
      <div className="channel">
        <div className="channel-name">
          <WaveIcon width={20} height={20} />
          <span className="channel-title" title={name ?? undefined}>
            {name ?? 'Sala'}
          </span>
          <span className="mono-code channel-code">{roomId}</span>
        </div>
        <div className="topbar-room">
          <StatusIndicator />
          <button
            type="button"
            className="icon-btn header-btn"
            title={isOwner ? 'Configurações da sala' : 'Regras da sala'}
            aria-label={isOwner ? 'Configurações da sala' : 'Regras da sala'}
            onClick={() => openPanel('settings')}
          >
            <GearIcon width={18} height={18} />
          </button>
          <UserChip compact />
          <button type="button" className="btn btn-primary invite-btn" onClick={() => openPanel('invite')}>
            <LinkIcon width={16} height={16} />
            <span>Convidar</span>
          </button>
        </div>
      </div>
    </header>
  )
}
