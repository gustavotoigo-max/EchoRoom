import { useEffect, useRef, useState } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import type { QueueItem } from '../../types/room'
import { copyText, formatTime } from '../../utils/format'
import { youtubeWatchUrl } from '../../utils/youtubeUrlParser'
import { MoreIcon } from '../ui/Icons'

export function Queue() {
  const queue = useStore(roomStore, (s) => s.room?.queue ?? null)

  return (
    <section className="side-block queue" aria-label="Fila">
      <header className="side-head">
        <h3>Fila</h3>
        <span className="count">{queue ? queue.length : ''}</span>
      </header>
      {queue === null ? (
        <ol>
          {[0, 1, 2].map((i) => (
            <li key={i} className="q-item">
              <div className="skeleton skeleton-thumb" />
              <div className="skeleton skeleton-line" />
            </li>
          ))}
        </ol>
      ) : queue.length === 0 ? (
        <p className="queue-empty">Nada na fila. Músicas adicionadas aparecem aqui, na ordem em que vão tocar.</p>
      ) : (
        <ol>
          {queue.map((item, i) => (
            <QueueRow key={item.id} item={item} index={i} />
          ))}
        </ol>
      )}
    </section>
  )
}

function QueueRow({ item, index }: { item: QueueItem; index: number }) {
  const session = useRoomSession()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  function flash(text: string) {
    setNote(text)
    setTimeout(() => setNote(null), 1600)
  }

  async function act(fn: () => Promise<unknown>) {
    setOpen(false)
    try {
      await fn()
    } catch (err) {
      flash((err as Error).message)
    }
  }

  return (
    <li className="q-item" ref={ref}>
      <span className="q-pos">{index + 1}</span>
      <img
        className="q-thumb"
        src={item.thumbnail}
        alt=""
        loading="lazy"
        width={64}
        height={36}
        onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
      />
      <div className="q-text">
        <span className="q-title" title={item.title}>
          {item.title}
        </span>
        <span className="q-sub">
          {note ?? (
            <>
              {item.addedBy}
              {item.duration ? ` · ${formatTime(item.duration)}` : ''}
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        className="icon-btn q-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Opções para ${item.title}`}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon width={18} height={18} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {index > 0 && (
            <button role="menuitem" type="button" onClick={() => act(() => session.moveToTop(item.id))}>
              Mover para o topo
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            onClick={async () => {
              setOpen(false)
              flash((await copyText(youtubeWatchUrl(item.videoId))) ? 'Link da música copiado' : 'Não foi possível copiar')
            }}
          >
            Copiar link da música
          </button>
          <button role="menuitem" type="button" className="danger" onClick={() => act(() => session.removeTrack(item.id))}>
            Remover da fila
          </button>
        </div>
      )}
    </li>
  )
}
