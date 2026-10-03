import { useEffect, useMemo, useState } from 'react'
import { removeEntry, subscribeLibrary, type LibraryEntry } from '../../services/firebase/library'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { getRelated, type RelatedTrack } from '../../services/youtube/related'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { PlusIcon } from '../ui/Icons'
import { Equalizer } from '../ui/Equalizer'

type Kind = 'track' | 'playlist' | 'related'
type Order = 'top' | 'recent'

const PAGE = 30

/** Remove acentos e caixa para a busca. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function timeAgo(ms: number): string {
  if (!ms) return ''
  const min = Math.round((Date.now() - ms) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

/**
 * Sugestões: músicas e playlists que já tocaram nesta sala (o dono pode tirar itens).
 * Um clique coloca de volta na fila.
 */
export function Suggestions() {
  const session = useRoomSession()
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('track')
  const [order, setOrder] = useState<Order>('top')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState<string | null>(null)

  // Vídeos já na sala (tocando ou na fila) aparecem marcados.
  const inRoom = useStore(roomStore, (s) => {
    const r = s.room
    if (!r) return ''
    return [r.currentTrack?.videoId, ...r.queue.map((q) => q.videoId)].filter(Boolean).join(',')
  })
  const inRoomSet = useMemo(() => new Set(inRoom.split(',')), [inRoom])
  const isOwner = useStore(roomStore, selectIsOwner)
  const currentVideo = useStore(roomStore, (s) => s.room?.currentTrack?.videoId ?? null)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')
  const addLocked = useStore(roomStore, (s) => s.settings.adding === 'owner') && !isOwner

  useEffect(() => subscribeLibrary(session.backend.roomKey, setEntries, setError), [session])
  useEffect(() => setLimit(PAGE), [kind, order, search])

  const counts = useMemo(() => {
    const c = { track: 0, playlist: 0 }
    entries?.forEach((e) => c[e.kind]++)
    return c
  }, [entries])

  const list = useMemo(() => {
    if (!entries) return []
    const q = norm(search.trim())
    return entries
      .filter((e) => e.kind === kind)
      .filter((e) => !q || norm(`${e.title} ${e.kind === 'track' ? e.author : ''}`).includes(q))
      .sort((a, b) => (order === 'top' ? b.count - a.count || b.lastAt - a.lastAt : b.lastAt - a.lastAt))
  }, [entries, kind, order, search])

  async function add(e: LibraryEntry) {
    setBusy(e.id)
    try {
      const url =
        e.kind === 'track' ? `https://www.youtube.com/watch?v=${e.id}` : `https://www.youtube.com/playlist?list=${e.id}`
      const res = await session.addTrack(url, { title: e.title })
      showToast(
        e.kind === 'playlist' ? `${res.added} músicas de "${e.title}" adicionadas à fila.` : `"${e.title}" adicionada à fila.`,
        'ok',
        3500,
      )
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function forget(e: LibraryEntry) {
    try {
      await removeEntry(session.backend.roomKey, e)
      showToast(`"${e.title}" saiu das sugestões.`, 'info', 3000)
    } catch {
      showToast('Não foi possível remover a sugestão.', 'error')
    }
  }

  return (
    <section className="suggestions" aria-labelledby="sugg-title">
      <header className="sugg-head">
        <h3 id="sugg-title">Sugestões</h3>
        <div className="seg seg-full" role="tablist" aria-label="Tipo">
          <button role="tab" aria-selected={kind === 'track'} className={kind === 'track' ? 'on' : ''} onClick={() => setKind('track')}>
            Músicas <span>{entries ? counts.track : ''}</span>
          </button>
          <button
            role="tab"
            aria-selected={kind === 'playlist'}
            className={kind === 'playlist' ? 'on' : ''}
            onClick={() => setKind('playlist')}
          >
            Playlists YT <span>{entries ? counts.playlist : ''}</span>
          </button>
          <button role="tab" aria-selected={kind === 'related'} className={kind === 'related' ? 'on' : ''} onClick={() => setKind('related')}>
            Parecidas
          </button>
        </div>
        {kind !== 'related' && (
        <div className="seg seg-quiet" aria-label="Ordem">
          <button className={order === 'top' ? 'on' : ''} aria-pressed={order === 'top'} onClick={() => setOrder('top')}>
            Mais tocadas
          </button>
          <button className={order === 'recent' ? 'on' : ''} aria-pressed={order === 'recent'} onClick={() => setOrder('recent')}>
            Recentes
          </button>
        </div>
        )}
        {kind !== 'related' && (
        <input
          className="sugg-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={kind === 'track' ? 'Buscar música ou artista' : 'Buscar playlist'}
          aria-label="Buscar nas sugestões"
        />
        )}
      </header>

      {kind === 'related' ? (
        <RelatedList inRoom={inRoomSet} locked={addLocked} />
      ) : error ? (
        <p className="sugg-empty">{error}</p>
      ) : entries === null ? (
        <ul className="sugg-list">
          {[0, 1, 2].map((i) => (
            <li key={i} className="sugg-item">
              <div className="skeleton skeleton-thumb" />
              <div className="skeleton skeleton-line" />
            </li>
          ))}
        </ul>
      ) : list.length === 0 ? (
        <p className="sugg-empty">
          {search
            ? 'Nada encontrado com essa busca.'
            : kind === 'track'
              ? 'As músicas que tocarem nesta sala aparecem aqui para tocar de novo com um clique.'
              : 'As playlists adicionadas nesta sala aparecem aqui.'}
        </p>
      ) : (
        <>
          <ul className="sugg-list">
            {list.slice(0, limit).map((e) => {
              const queued = e.kind === 'track' && inRoomSet.has(e.id)
              const isCurrent = e.kind === 'track' && e.id === currentVideo
              const thumb = e.kind === 'track' ? thumbnailUrl(e.id) : e.firstVideoId ? thumbnailUrl(e.firstVideoId) : ''
              return (
                <li key={`${e.kind}-${e.id}`} className={`sugg-item ${isCurrent ? 'is-current' : ''}`} aria-current={isCurrent || undefined}>
                  <span className={`sugg-thumb ${e.kind === 'playlist' ? 'is-playlist' : ''}`}>
                    {thumb && (
                      <img src={thumb} alt="" loading="lazy" width={64} height={36} onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} />
                    )}
                    {e.kind === 'playlist' && <b>{e.size || '…'}</b>}
                    {isCurrent && (
                      <span className="sugg-playing">
                        <Equalizer on={playing} />
                      </span>
                    )}
                  </span>
                  <span className="sugg-text">
                    <span className="sugg-title" title={e.title}>
                      {e.title}
                    </span>
                    <span className="sugg-sub">
                      {e.kind === 'track' && e.author ? `${e.author} · ` : ''}
                      {e.count > 1 ? `${e.count}× · ` : ''}
                      {e.lastBy ? `${e.lastBy}, ` : ''}
                      {timeAgo(e.lastAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary sugg-add"
                    disabled={queued || addLocked || busy === e.id}
                    onClick={() => add(e)}
                    aria-label={`Adicionar ${e.title} à fila`}
                  >
                    {isCurrent ? (
                      'Tocando'
                    ) : queued ? (
                      'Na fila'
                    ) : busy === e.id ? (
                      'Adicionando…'
                    ) : (
                      <>
                        <PlusIcon width={14} height={14} />
                        <span>Fila</span>
                      </>
                    )}
                  </button>
                  {isOwner && (
                  <button
                    type="button"
                    className="sugg-remove"
                    onClick={() => forget(e)}
                    title="Tirar das sugestões"
                    aria-label={`Tirar ${e.title} das sugestões`}
                  >
                    ×
                  </button>
                  )}
                </li>
              )
            })}
          </ul>
          {list.length > limit && (
            <button type="button" className="btn btn-secondary sugg-more" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar mais ({list.length - limit})
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** Parecidas com a música que está tocando (Mix automático do YouTube). */
function RelatedList({ inRoom, locked }: { inRoom: Set<string>; locked: boolean }) {
  const session = useRoomSession()
  const current = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const [items, setItems] = useState<RelatedTrack[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    if (!current) return
    let alive = true
    void getRelated(current.videoId).then((r) => alive && setItems(r))
    return () => {
      alive = false
    }
  }, [current?.videoId])

  if (!current) return <p className="sugg-empty">Quando uma música estiver tocando, aparecem aqui outras parecidas com ela.</p>
  if (items === null) {
    return (
      <ul className="sugg-list">
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className="sugg-item">
            <div className="skeleton skeleton-thumb" />
            <div className="skeleton skeleton-line" />
          </li>
        ))}
      </ul>
    )
  }
  if (!items.length) return <p className="sugg-empty">O YouTube não trouxe parecidas para esta música.</p>

  async function add(r: RelatedTrack) {
    setBusy(r.videoId)
    try {
      await session.addTrack(`https://www.youtube.com/watch?v=${r.videoId}`, { title: r.title })
      showToast(`"${r.title}" adicionada à fila.`, 'ok', 3000)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="sugg-list">
      {items.map((r) => {
        const queued = inRoom.has(r.videoId)
        return (
          <li key={r.videoId} className="sugg-item sugg-related">
            <span className="sugg-thumb">
              <img src={thumbnailUrl(r.videoId)} alt="" loading="lazy" width={64} height={36} onError={(ev) => (ev.currentTarget.style.visibility = 'hidden')} />
            </span>
            <span className="sugg-text">
              <span className="sugg-title" title={r.title}>
                {r.title}
              </span>
              <span className="sugg-sub">{r.author || 'Parecida com a atual'}</span>
            </span>
            <button
              type="button"
              className="btn btn-secondary sugg-add"
              disabled={queued || locked || busy === r.videoId}
              onClick={() => add(r)}
              aria-label={`Adicionar ${r.title} à fila`}
            >
              {queued ? 'Na fila' : busy === r.videoId ? 'Adicionando…' : (
                <>
                  <PlusIcon width={14} height={14} />
                  <span>Fila</span>
                </>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
