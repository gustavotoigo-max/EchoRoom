import { useEffect, useState } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { getRelated, type RelatedTrack } from '../../services/youtube/related'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { CloseIcon, PlusIcon } from '../ui/Icons'

/** Segundos finais em que aparecem as parecidas (como a tela final do YouTube). */
const SHOW_LAST_SEC = 20
const PREFETCH_LAST_SEC = 45

/**
 * Tela final: nos últimos segundos da música, mostra 4 músicas parecidas
 * (Mix do YouTube). Um clique coloca na fila da sala.
 */
export function EndCard() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const canAdd = useStore(roomStore, (s) => s.settings.adding === 'all' || selectIsOwner(s))
  const inRoom = useStore(roomStore, (s) =>
    [s.room?.currentTrack?.videoId, ...(s.room?.queue ?? []).map((q) => q.videoId)].join(','),
  )
  const [remaining, setRemaining] = useState<number | null>(null)
  const [items, setItems] = useState<RelatedTrack[] | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    if (!track?.duration) {
      setRemaining(null)
      return
    }
    const tick = () => setRemaining(track.duration! - session.getDisplayPosition())
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [session, track?.id, track?.duration])

  // Busca as parecidas um pouco antes de mostrar.
  const near = remaining !== null && remaining <= PREFETCH_LAST_SEC
  useEffect(() => {
    if (!near || !track || !canAdd) return
    let alive = true
    void getRelated(track.videoId).then((r) => alive && setItems(r))
    return () => {
      alive = false
    }
  }, [near, track?.videoId, canAdd])

  if (!track || !canAdd || closedFor === track.id) return null
  if (remaining === null || remaining > SHOW_LAST_SEC || remaining <= 0.5) return null
  const queued = new Set(inRoom.split(','))
  const list = (items ?? []).filter((i) => !queued.has(i.videoId)).slice(0, 4)
  if (!list.length) return null

  async function add(r: RelatedTrack) {
    setAdding(r.videoId)
    try {
      await session.addTrack(`https://www.youtube.com/watch?v=${r.videoId}`, { title: r.title })
      showToast(`"${r.title}" adicionada à fila.`, 'ok', 3000)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="end-card" role="region" aria-label="Músicas parecidas">
      <header>
        <span>Parecidas — clique para pôr na fila</span>
        <button type="button" aria-label="Fechar sugestões" onClick={() => setClosedFor(track.id)}>
          <CloseIcon width={14} height={14} />
        </button>
      </header>
      <ul>
        {list.map((r) => (
          <li key={r.videoId}>
            <button type="button" disabled={adding !== null} onClick={() => add(r)} title={`Adicionar "${r.title}" à fila`}>
              <span className="end-thumb">
                <img src={thumbnailUrl(r.videoId)} alt="" loading="lazy" />
                <i>
                  <PlusIcon width={18} height={18} />
                </i>
              </span>
              <span className="end-title">{adding === r.videoId ? 'Adicionando…' : r.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
