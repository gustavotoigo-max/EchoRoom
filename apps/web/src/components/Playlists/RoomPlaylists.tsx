import { useEffect, useState } from 'react'
import { authStore } from '../../services/discordAuth'
import { subscribeMyPlaylists, subscribeRoomPlaylists, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { createStore, useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { openPanel } from '../RoomSettings/ui'
import { openPlaylistManager } from '../PlaylistManager/store'
import { Equalizer } from '../ui/Equalizer'
import { ChevronDownIcon, ChevronUpIcon, ListIcon, PauseIcon, PlayIcon, PlusIcon, ShuffleIcon, StopIcon } from '../ui/Icons'
import { sourceLabel } from './SharePanel'
import { playlistStore } from './store'

/** Playlists abertas e o modo (aleatório/sequencial) de cada uma, só neste navegador. */
const listUi = createStore<{ open: Record<string, boolean>; shuffle: Record<string, boolean> }>({ open: {}, shuffle: {} })

/** Coluna direita, abaixo dos participantes: playlists da sala e as que cada pessoa trouxe. */
export function RoomPlaylists() {
  const session = useRoomSession()
  const profile = useStore(authStore, (s) => s.profile)
  const lists = useStore(playlistStore, (s) => s.room)

  useEffect(() => {
    playlistStore.set({ room: null })
    const off = subscribeRoomPlaylists(session.backend.roomKey, (room) => playlistStore.set({ room }), () => playlistStore.set({ room: [] }))
    return () => {
      off()
      playlistStore.set({ room: null })
    }
  }, [session])

  useEffect(() => {
    if (!profile) {
      playlistStore.set({ mine: null })
      return
    }
    const off = subscribeMyPlaylists(profile.uid, (mine) => playlistStore.set({ mine }), () => playlistStore.set({ mine: [] }))
    return () => {
      off()
      playlistStore.set({ mine: null })
    }
  }, [profile])

  return (
    <section className="side-block playlists" aria-label="Playlists">
      <header className="side-head">
        <h3>Playlists</h3>
        <span className="count">{lists ? lists.length : ''}</span>
        <button type="button" className="icon-btn side-add" title="Nova playlist da sala" aria-label="Nova playlist da sala" onClick={() => openPanel('newPlaylist')}>
          <PlusIcon width={16} height={16} />
        </button>
      </header>
      {lists === null ? (
        <ul>
          <li className="pl-row">
            <div className="skeleton skeleton-line" />
          </li>
        </ul>
      ) : lists.length === 0 ? (
        <p className="queue-empty">Crie uma playlist da sala no + ou traga uma das suas. Todo mundo aqui vai ver.</p>
      ) : (
        groupByOwner(lists).map((g) => (
          <div key={g.key} className="pl-group">
            <h4 className="pl-group-head">
              {g.avatar && <img src={g.avatar} alt="" width={16} height={16} />}
              <span>{g.label}</span>
            </h4>
            <ul>
              {g.lists.map((pl) => (
                <PlaylistItem key={pl.id} pl={pl} />
              ))}
            </ul>
          </div>
        ))
      )}
      {profile && (
        <button type="button" className="link-btn pl-share" onClick={() => openPanel('share')}>
          Adicionar playlists minhas
        </button>
      )}
    </section>
  )
}

/** "Da sala" primeiro; depois um grupo por pessoa que trouxe playlists. */
function groupByOwner(lists: Playlist[]) {
  const groups: { key: string; label: string; avatar: string; lists: Playlist[] }[] = []
  const room = lists.filter((p) => p.kind === 'room')
  if (room.length) groups.push({ key: 'room', label: 'Da sala', avatar: '', lists: room })
  for (const pl of lists) {
    if (pl.kind !== 'personal') continue
    const g = groups.find((x) => x.key === pl.createdBy)
    if (g) g.lists.push(pl)
    else groups.push({ key: pl.createdBy, label: `De ${pl.createdByName || 'alguém'}`, avatar: pl.createdByAvatar, lists: [pl] })
  }
  return groups
}

function PlaylistItem({ pl }: { pl: Playlist }) {
  const session = useRoomSession()
  const open = useStore(listUi, (s) => !!s.open[pl.id])
  const shuffle = useStore(listUi, (s) => !!s.shuffle[pl.id])
  const current = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const state = useStore(roomStore, (s) => s.room?.playbackState ?? 'stopped')
  // Parar = pausa no início da música (o player de todos fica pronto no zero).
  const atStart = useStore(roomStore, (s) => s.room?.playbackState === 'paused' && s.room.position === 0)
  const replace = useStore(roomStore, (s) => s.settings.playlistPlay === 'replace')
  const [busy, setBusy] = useState(false)

  const active = current?.fromPlaylist === pl.id
  const playing = active && state === 'playing'
  const count = `${pl.tracks.length} ${pl.tracks.length === 1 ? 'música' : 'músicas'}`
  const where = [pl.source ? sourceLabel(pl.source.kind) : '', count].filter(Boolean).join(' · ')

  const toggleOpen = () => listUi.set({ open: { ...listUi.get().open, [pl.id]: !open } })

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível.', 'error')
    } finally {
      setBusy(false)
    }
  }

  /** Toca a playlist (ou a partir de uma música) no modo escolhido. */
  const start = (startAt?: string) =>
    run(async () => {
      const res = await session.playPlaylist(pl, { startAt, shuffle })
      if (res.mode === 'replace') return
      const extra = [res.repeated ? `${res.repeated} já estavam` : '', res.skipped ? `${res.skipped} não couberam` : ''].filter(Boolean).join('; ')
      showToast(`${res.added} de "${pl.name}" no fim da fila${extra ? ` (${extra})` : ''}.`, 'ok', 3500)
    })

  const playOrResume = () => (active && state === 'paused' ? run(session.play) : start())

  return (
    <li className={`pl-item ${open ? 'is-open' : ''} ${active ? 'is-active' : ''}`}>
      <div className="pl-row">
        <button type="button" className="pl-open" onClick={toggleOpen} aria-expanded={open} title={open ? 'Recolher' : 'Ver as músicas'}>
          <span className={`pl-cover ${pl.kind}`}>{active ? <Equalizer on={playing} /> : <ListIcon width={16} height={16} />}</span>
          <span className="pl-text">
            <strong>{pl.name}</strong>
            <small>{where}</small>
          </span>
          {open ? <ChevronUpIcon width={14} height={14} /> : <ChevronDownIcon width={14} height={14} />}
        </button>
        {!open && (
          <button
            type="button"
            className="icon-btn pl-play"
            title={replace ? 'Tocar no lugar da fila' : 'Pôr no fim da fila'}
            aria-label={`Tocar "${pl.name}"`}
            disabled={busy || !pl.tracks.length}
            onClick={() => (playing ? undefined : playOrResume())}
          >
            {playing ? <Equalizer on /> : <PlayIcon width={14} height={14} />}
          </button>
        )}
      </div>
      {open && (
        <div className="pl-body">
          <div className="pl-cmds" role="toolbar" aria-label={`Controles de "${pl.name}"`}>
            {playing ? (
              <button type="button" className="icon-btn" title="Pausar" aria-label="Pausar" disabled={busy} onClick={() => run(session.pause)}>
                <PauseIcon width={16} height={16} />
              </button>
            ) : (
              <button
                type="button"
                className="icon-btn is-primary"
                title={active && state === 'paused' ? 'Continuar' : replace ? 'Tocar no lugar da fila' : 'Pôr no fim da fila'}
                aria-label="Tocar"
                disabled={busy || !pl.tracks.length}
                onClick={playOrResume}
              >
                <PlayIcon width={16} height={16} />
              </button>
            )}
            <button
              type="button"
              className="icon-btn"
              title="Parar (volta ao início da música)"
              aria-label="Parar"
              disabled={busy || !active || atStart}
              onClick={() => run(session.stopPlayback)}
            >
              <StopIcon width={14} height={14} />
            </button>
            <button
              type="button"
              className={`btn btn-secondary pl-mode ${shuffle ? 'is-on' : ''}`}
              aria-pressed={shuffle}
              title="Aleatório embaralha só esta playlist ao tocar. O aleatório embaixo do vídeo mistura a fila inteira."
              onClick={() => listUi.set({ shuffle: { ...listUi.get().shuffle, [pl.id]: !shuffle } })}
            >
              <ShuffleIcon width={14} height={14} />
              <span>{shuffle ? 'Aleatório' : 'Sequencial'}</span>
            </button>
            <span className="pl-state">{active ? (playing ? 'tocando' : state === 'paused' && !atStart ? 'pausado' : 'parado') : ''}</span>
            <button type="button" className="link-btn pl-manage" onClick={() => openPlaylistManager({ selectedId: pl.id })}>
              Editar
            </button>
          </div>
          {pl.tracks.length === 0 ? (
            <p className="hint pl-empty">Nenhuma música ainda.</p>
          ) : (
            <ol className="pl-songs">
              {pl.tracks.map((t, i) => {
                const now = active && current?.videoId === t.videoId
                return (
                  <li key={t.id} className={now ? 'is-now' : ''}>
                    <span className="pl-num">{now ? <Equalizer on={playing} label="Tocando agora" /> : i + 1}</span>
                    <img src={thumbnailUrl(t.videoId)} alt="" width={40} height={23} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                    <span className="pl-text">
                      <strong title={t.title}>{t.title}</strong>
                      {t.author && <small>{t.author}</small>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn pl-song-play"
                      title={replace ? 'Tocar a partir desta' : 'Pôr no fim da fila a partir desta'}
                      aria-label={`Tocar a partir de ${t.title}`}
                      disabled={busy || now}
                      onClick={() => start(t.id)}
                    >
                      <PlayIcon width={12} height={12} />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </li>
  )
}

