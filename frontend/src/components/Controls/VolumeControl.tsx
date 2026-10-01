import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { playerStore } from '../../stores/playerStore'
import { MutedIcon, VolumeIcon } from '../ui/Icons'

/**
 * Volume individual: muda só o player deste navegador, não afeta a sala
 * e fica guardado para a próxima visita.
 */
export function VolumeControl() {
  const session = useRoomSession()
  const volume = useStore(playerStore, (s) => s.volume)
  const muted = useStore(playerStore, (s) => s.muted)
  const shown = muted ? 0 : volume
  const level = shown === 0 ? 0 : shown < 50 ? 1 : 2

  return (
    <div className="volume" title="Volume só para você">
      <button
        type="button"
        className="icon-btn volume-btn"
        aria-label={muted ? 'Ativar som' : 'Silenciar'}
        aria-pressed={muted}
        onClick={session.toggleMute}
      >
        {muted || shown === 0 ? <MutedIcon width={18} height={18} /> : <VolumeIcon level={level as 1 | 2} width={18} height={18} />}
      </button>
      <input
        type="range"
        className="volume-range"
        min={0}
        max={100}
        step={1}
        value={shown}
        aria-label="Volume (só para você)"
        aria-valuetext={`${shown}%`}
        style={{ ['--pct' as string]: `${shown}%` }}
        onChange={(e) => session.setVolume(Number(e.target.value))}
      />
    </div>
  )
}
