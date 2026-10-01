import { useEffect, useState } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { formatTime } from '../../utils/format'

interface Props {
  duration: number | null
  trackId: string | null
  disabled: boolean
}

const TICK_MS = 250

/**
 * Barra de progresso. Mostra a posição da timeline oficial da sala
 * (mesma para todos). Atualiza só este componente, 4× por segundo.
 */
export function ProgressBar({ duration, trackId, disabled }: Props) {
  const session = useRoomSession()
  const [pos, setPos] = useState(0)
  const [drag, setDrag] = useState<number | null>(null)
  const [pendingSeek, setPendingSeek] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setPos(session.getDisplayPosition())
    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [session, trackId])

  // Libera a posição otimista assim que a timeline oficial chega perto.
  useEffect(() => {
    if (pendingSeek != null && Math.abs(pos - pendingSeek) < 1.5) setPendingSeek(null)
  }, [pos, pendingSeek])
  useEffect(() => setPendingSeek(null), [trackId])

  const max = duration && duration > 0 ? duration : 0
  const shown = drag ?? pendingSeek ?? pos
  const pct = max ? Math.min(100, (shown / max) * 100) : 0

  async function commit(value: number) {
    setDrag(null)
    setPendingSeek(value)
    try {
      await session.seek(value)
    } catch {
      setPendingSeek(null)
    }
  }

  return (
    <div className="progress">
      <span className="time">{formatTime(shown)}</span>
      <input
        type="range"
        className="progress-range"
        min={0}
        max={max || 1}
        step={0.1}
        value={max ? Math.min(shown, max) : 0}
        disabled={disabled || !max}
        aria-label="Posição da música"
        aria-valuetext={`${formatTime(shown)} de ${formatTime(max)}`}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            commit(Number((e.target as HTMLInputElement).value))
          }
        }}
      />
      <span className="time time-total">{max ? formatTime(max) : '–:––'}</span>
    </div>
  )
}
