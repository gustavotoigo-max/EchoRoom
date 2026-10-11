import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoomPlaylist, createRoomPlaylistWith, MAX_PLAYLIST_NAME, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { normalizeText as norm } from '../../utils/format'
import { useMe } from '../Playlists/useMe'
import { playlistStore } from '../Playlists/store'
import { MiniPlayer } from '../ProfileOverlay/ProfileOverlay'
import { Queue } from '../Queue/Queue'
import { CloseIcon, CrownIcon, ListIcon, PlusIcon } from '../ui/Icons'
import { PlaylistEditor } from './PlaylistEditor'
import { closePlaylistManager, playlistManagerStore } from './store'

/**
 * Gerenciar playlists: janela por cima da sala, no mesmo modelo do perfil
 * (o vídeo continua tocando atrás, desfocado). O dono da sala cria, renomeia,
 * reordena e apaga qualquer playlist; os outros, só as que criaram.
 */
export function PlaylistManager() {
  const open = useStore(playlistManagerStore, (s) => s.open)
  const tab = useStore(playlistManagerStore, (s) => s.tab)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      // Esc fecha primeiro o painel lateral ou o campo em edição, depois a janela.
      if (e.key !== 'Escape' || document.querySelector('.drawer-wrap')) return
      if ((e.target as HTMLElement | null)?.closest?.('input')) return
      closePlaylistManager()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Ao sair da sala, a janela fecha junto.
  useEffect(() => () => closePlaylistManager(), [])

  if (!open) return null
  return (
    <div className="profile-overlay pm-overlay" role="dialog" aria-modal="true" aria-label="Gerenciar playlists">
      <div className="po-bar">
        <MiniPlayer />
        <button type="button" className="btn btn-secondary po-back" onClick={closePlaylistManager}>
          <CloseIcon width={16} height={16} />
          <span>Voltar à sala</span>
        </button>
      </div>
      <div className="po-scroll" ref={panel} tabIndex={-1}>
        <main className="profile-main po-main pm-main">
          <ManagerHead />
          {tab === 'playlists' ? <PlaylistsTab /> : <QueueTab />}
        </main>
      </div>
    </div>
  )
}

function ManagerHead() {
  const tab = useStore(playlistManagerStore, (s) => s.tab)
  const lists = useStore(playlistStore, (s) => s.room)
  const queueCount = useStore(roomStore, (s) => s.room?.queue.length ?? 0)
  const roomName = useStore(roomStore, (s) => s.meta?.name ?? 'Sala')
  const isOwner = useStore(roomStore, selectIsOwner)
  const totalTracks = lists?.reduce((n, p) => n + p.tracks.length, 0) ?? 0

  return (
    <header className="profile-head pm-head">
      <span className="pm-head-icon" aria-hidden="true">
        <ListIcon width={34} height={34} />
      </span>
      <div className="pm-head-text">
        <h1>Gerenciar playlists</h1>
        <p>
          {roomName} · {lists ? lists.length : '…'} {lists?.length === 1 ? 'playlist' : 'playlists'} · {totalTracks}{' '}
          {totalTracks === 1 ? 'música' : 'músicas'}
        </p>
        {isOwner ? (
          <span className="role-badge owner">
            <CrownIcon width={11} height={11} /> Dono da sala: você edita e apaga qualquer playlist
          </span>
        ) : (
          <span className="role-badge">Você edita as playlists que criou</span>
        )}
      </div>
      <div className="seg pm-tabs" role="tablist" aria-label="Seção">
        <button
          role="tab"
          aria-selected={tab === 'playlists'}
          className={tab === 'playlists' ? 'on' : ''}
          onClick={() => playlistManagerStore.set({ tab: 'playlists' })}
        >
          Playlists <span>{lists ? lists.length : ''}</span>
        </button>
        <button role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'on' : ''} onClick={() => playlistManagerStore.set({ tab: 'queue' })}>
          Fila <span>{queueCount}</span>
        </button>
      </div>
    </header>
  )
}

function PlaylistsTab() {
  const session = useRoomSession()
  const me = useMe()
  const myUid = useStore(roomStore, (s) => s.participantId)
  const lists = useStore(playlistStore, (s) => s.room)
  const selectedId = useStore(playlistManagerStore, (s) => s.selectedId)
  const queueKey = useStore(roomStore, (s) => {
    const r = s.room
    return r ? [r.currentTrack?.id, ...r.queue.map((q) => q.id)].filter(Boolean).join(',') : ''
  })
  const [name, setName] = useState('')
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState<'all' | 'room' | 'personal' | 'mine'>('all')
  const [busy, setBusy] = useState(false)

  const shown = useMemo(() => {
    const q = norm(search.trim())
    return (lists ?? [])
      .filter((p) => only === 'all' || (only === 'mine' ? p.createdBy === myUid : p.kind === only))
      .filter((p) => !q || norm(`${p.name} ${p.createdByName}`).includes(q))
  }, [lists, search, only, myUid])

  // Sem nada escolhido (ou a escolhida sumiu): abre a primeira.
  const selected = lists?.find((p) => p.id === selectedId) ?? null
  useEffect(() => {
    if (lists && lists.length && !selected) playlistManagerStore.set({ selectedId: lists[0].id })
  }, [lists, selected])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await createRoomPlaylist(session.backend.roomKey, name, me)
      showToast(`Playlist "${name.trim()}" criada.`, 'ok', 2500)
      setName('')
      playlistManagerStore.set({ selectedId: id })
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível criar.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveQueue() {
    const room = roomStore.get().room
    if (!room) return
    const tracks = [room.currentTrack, ...room.queue]
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({ videoId: t.videoId, title: t.title, author: t.author }))
    if (!tracks.length) return
    const day = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
    try {
      const id = await createRoomPlaylistWith(session.backend.roomKey, `Fila de ${day}`, me, tracks)
      showToast(`A fila virou a playlist "Fila de ${day}". Dá para renomear.`, 'ok', 4000)
      playlistManagerStore.set({ selectedId: id })
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível salvar a fila.', 'error')
    }
  }

  return (
    <div className="pm-grid">
      <section className="profile-block pm-list" aria-label="Playlists da sala">
        <form className="inline-field" onSubmit={create}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_PLAYLIST_NAME} placeholder="Nome da nova playlist" />
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            <PlusIcon width={14} height={14} /> Criar
          </button>
        </form>
        <button type="button" className="link-btn pm-save-queue" disabled={!queueKey} onClick={saveQueue}>
          Salvar a fila atual como playlist
        </button>

        {lists && lists.length > 3 && (
          <input className="pm-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar playlist" />
        )}
        <div className="seg seg-quiet pm-filter" aria-label="Mostrar">
          {(
            [
              ['all', 'Todas'],
              ['room', 'Da sala'],
              ['personal', 'Sugeridas'],
              ['mine', 'Minhas'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={only === k ? 'on' : ''} aria-pressed={only === k} onClick={() => setOnly(k)}>
              {label}
            </button>
          ))}
        </div>

        {lists === null ? (
          <div className="skeleton skeleton-line" />
        ) : shown.length === 0 ? (
          <p className="sugg-empty">{lists.length ? 'Nenhuma playlist com esse filtro.' : 'Nenhuma playlist ainda. Dê um nome acima e crie a primeira.'}</p>
        ) : (
          <ul className="pm-items">
            {shown.map((pl) => (
              <ListItem key={pl.id} pl={pl} on={pl.id === selected?.id} mine={pl.createdBy === myUid} />
            ))}
          </ul>
        )}
      </section>

      <section className="profile-block pm-detail" aria-label="Playlist escolhida">
        {selected ? (
          <PlaylistEditor key={selected.id} pl={selected} />
        ) : (
          <div className="pm-empty">
            <ListIcon width={40} height={40} />
            <p>Escolha uma playlist à esquerda ou crie uma nova.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function ListItem({ pl, on, mine }: { pl: Playlist; on: boolean; mine: boolean }) {
  const thumbs = pl.tracks.slice(0, 4)
  return (
    <li>
      <button
        type="button"
        className={`pm-item ${on ? 'is-on' : ''}`}
        aria-current={on}
        onClick={() => {
          playlistManagerStore.set({ selectedId: pl.id })
          // Uma coluna (celular): leva até a playlist, que fica abaixo da lista.
          if (window.matchMedia('(max-width: 900px)').matches) {
            requestAnimationFrame(() => document.querySelector('.pm-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
          }
        }}
      >
        <span className={`pm-mosaic ${pl.kind}`} aria-hidden="true">
          {thumbs.length ? thumbs.map((t) => <img key={t.id} src={thumbnailUrl(t.videoId)} alt="" loading="lazy" />) : <ListIcon width={18} height={18} />}
        </span>
        <span className="pl-text">
          <strong>{pl.name}</strong>
          <small>
            {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'} ·{' '}
            {mine ? 'sua' : pl.kind === 'personal' ? `sugerida por ${pl.createdByName}` : `de ${pl.createdByName || 'alguém'}`}
          </small>
        </span>
      </button>
    </li>
  )
}

function QueueTab() {
  const empty = useStore(roomStore, (s) => !s.room?.currentTrack && !s.room?.queue.length)
  return (
    <section className="profile-block pm-queue">
      <Queue />
      {empty && <p className="sugg-empty">A fila está vazia. Cole um link na sala ou ponha uma playlist inteira na fila pela aba Playlists.</p>}
    </section>
  )
}
