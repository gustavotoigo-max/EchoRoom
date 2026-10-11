import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import type { QueueItem } from '../../types/room'
import { copyText, formatTime } from '../../utils/format'
import { youtubeWatchUrl } from '../../utils/youtubeUrlParser'
import { GripIcon, MoreIcon } from '../ui/Icons'
import { Equalizer } from '../ui/Equalizer'
import { SaveToPlaylistMenuItems } from '../Playlists/SaveToPlaylist'
import { showToast } from '../../stores/toastStore'

interface Drag {
  id: string
  from: number
  over: number
  startY: number
  dy: number
  rowH: number
  tops: number[]
}

export function Queue() {
  const session = useRoomSession()
  const queueRaw = useStore(roomStore, (s) => s.room?.queue ?? null)
  const current = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')
  const shuffle = useStore(roomStore, (s) => s.room?.shuffle ?? false)
  const repeat = useStore(roomStore, (s) => s.room?.repeat ?? 'off')
  const canMove = useStore(roomStore, (s) => s.settings.controls === 'all' || selectIsOwner(s))
  const [drag, setDrag] = useState<Drag | null>(null)
  // Ordem otimista depois de soltar, até a sala confirmar.
  const [pending, setPending] = useState<{ id: string; to: number } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => setPending(null), [queueRaw])

  const queue = useMemo(() => {
    if (!queueRaw || !pending) return queueRaw
    const from = queueRaw.findIndex((q) => q.id === pending.id)
    if (from < 0) return queueRaw
    const next = [...queueRaw]
    const [it] = next.splice(from, 1)
    next.splice(pending.to, 0, it)
    return next
  }, [queueRaw, pending])

  function move(id: string, to: number) {
    setPending({ id, to })
    session.moveTrack(id, to).catch((err: Error) => {
      setPending(null)
      showToast(err.message || 'Não foi possível mudar a ordem.', 'error')
    })
  }

  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, id: string, index: number) {
    if (!canMove || e.button !== 0 || !listRef.current) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rows = [...listRef.current.children] as HTMLElement[]
    const tops = rows.map((r) => r.getBoundingClientRect().top)
    setDrag({ id, from: index, over: index, startY: e.clientY, dy: 0, rowH: rows[index].getBoundingClientRect().height, tops })
  }
  function onDragMove(e: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag) return
    const dy = e.clientY - drag.startY
    const center = drag.tops[drag.from] + drag.rowH / 2 + dy
    let over = 0
    drag.tops.forEach((t, i) => {
      if (center > t + drag.rowH / 2) over = i
    })
    if (center < drag.tops[0] + drag.rowH / 2) over = 0
    setDrag({ ...drag, dy, over })
  }
  function endDrag() {
    if (!drag) return
    if (drag.over !== drag.from) move(drag.id, drag.over)
    setDrag(null)
  }

  /** Deslocamento visual de cada linha durante o arraste. */
  function shift(i: number): number {
    if (!drag) return 0
    if (i === drag.from) return drag.dy
    if (drag.from < drag.over && i > drag.from && i <= drag.over) return -drag.rowH
    if (drag.from > drag.over && i < drag.from && i >= drag.over) return drag.rowH
    return 0
  }

  return (
    <section className="side-block queue" aria-label="Fila">
      <header className="side-head">
        <h3>A seguir</h3>
        <span className="count">{queue ? queue.length : ''}</span>
        {(shuffle || repeat !== 'off') && (
          <span className="mode-tags">
            {shuffle && <span>aleatório</span>}
            {repeat === 'all' && <span>ciclando</span>}
            {repeat === 'one' && <span>repetindo</span>}
          </span>
        )}
      </header>
      {current && (
        <div className="q-now" title={current.title}>
          <span className="q-now-art">
            <img src={current.thumbnail} alt="" width={56} height={32} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
            <Equalizer on={playing} />
          </span>
          <span className="q-text">
            <span className="q-title">{current.title}</span>
            <span className="q-sub">Tocando agora · {current.addedBy}</span>
          </span>
        </div>
      )}
      {queue === null ? (
        <ol>
          {[0, 1, 2].map((i) => (
            <li key={i} className="q-item">
              <div className="skeleton skeleton-thumb" />
              <div className="skeleton skeleton-line" />
            </li>
          ))}
        </ol>
      ) : queue.length === 0 ? null : (
        <ol ref={listRef} className={drag ? 'is-dragging' : ''}>
          {queue.map((item, i) => (
            <QueueRow
              key={item.id}
              item={item}
              index={i}
              total={queue.length}
              canMove={canMove}
              dragging={drag?.id === item.id}
              offset={shift(i)}
              onGrip={{
                onPointerDown: (e) => startDrag(e, item.id, i),
                onPointerMove: onDragMove,
                onPointerUp: endDrag,
                onPointerCancel: () => setDrag(null),
              }}
              onMove={(to) => move(item.id, to)}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

interface RowProps {
  item: QueueItem
  index: number
  total: number
  canMove: boolean
  dragging: boolean
  offset: number
  onGrip: {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => void
    onPointerUp: () => void
    onPointerCancel: () => void
  }
  onMove: (to: number) => void
}

function QueueRow({ item, index, total, canMove, dragging, offset, onGrip, onMove }: RowProps) {
  const session = useRoomSession()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const ref = useRef<HTMLLIElement>(null)
  const isOwner = useStore(roomStore, selectIsOwner)
  const me = useStore(roomStore, (s) => s.participantId)
  const canRemove = isOwner || (!!item.addedByUid && item.addedByUid === me)

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
    <li
      className={`q-item ${dragging ? 'is-dragged' : ''} ${canMove ? 'can-move' : ''}`}
      ref={ref}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      {canMove ? (
        <button
          type="button"
          className="q-grip"
          aria-label={`Arrastar "${item.title}" (posição ${index + 1}). Setas para cima e para baixo também movem.`}
          title="Arraste para mudar a ordem"
          {...onGrip}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && index > 0) {
              e.preventDefault()
              onMove(index - 1)
            } else if (e.key === 'ArrowDown' && index < total - 1) {
              e.preventDefault()
              onMove(index + 1)
            }
          }}
        >
          <span className="q-pos">{index + 1}</span>
          <GripIcon width={14} height={14} />
        </button>
      ) : (
        <span className="q-pos">{index + 1}</span>
      )}
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
          {index > 0 && canMove && (
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
          <SaveToPlaylistMenuItems track={item} onDone={() => setOpen(false)} />
          {canRemove && (
            <button role="menuitem" type="button" className="danger" onClick={() => act(() => session.removeTrack(item.id))}>
              Remover da fila
            </button>
          )}
        </div>
      )}
    </li>
  )
}
