import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { roomStore } from '../../stores/roomStore'
import type { SyncUiState } from '../../sync/SyncEngine'
import type { ConnectionStatus } from '../../types/room'
import { roomLink } from '../../utils/format'
import { Brand } from '../ui/Brand'
import { CopyButton } from '../ui/CopyButton'
import { ThemePicker } from '../ui/ThemePicker'

type Tone = 'ok' | 'work' | 'warn' | 'bad' | 'idle'

function describe(conn: ConnectionStatus, sync: SyncUiState): { label: string; tone: Tone } {
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
  const { label, tone } = describe(conn, sync)
  return (
    <div className={`status status-${tone}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function RoomHeader({ roomId }: { roomId: string }) {
  return (
    <header className="topbar room-topbar">
      <Brand />
      <div className="topbar-room">
        <StatusIndicator />
        <div className="room-id">
          <span className="room-id-label">Sala</span>
          <span className="mono-code">{roomId}</span>
        </div>
        <CopyButton text={roomLink(roomId)} variant="primary" />
        <ThemePicker />
      </div>
    </header>
  )
}
