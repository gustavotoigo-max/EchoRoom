import { useEffect, useState } from 'react'
import { authStore } from '../../services/discordAuth'
import { subscribeMyPlaylists, subscribeRoomPlaylists, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { openPanel } from '../RoomSettings/ui'
import { ListIcon, PlayIcon, PlusIcon } from '../ui/Icons'
import { playlistStore } from './store'

/** Coluna direita, abaixo dos participantes: playlists da sala e as que as pessoas sugeriram. */
export function RoomPlaylists() {
  const session = useRoomSession()
  const profile = useStore(authStore, (s) => s.profile)
  const lists = useStore(playlistStore, (s) => s.room)
  const [busy, setBusy] = useState<string | null>(null)

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

  async function queueAll(pl: Playlist) {
    if (!pl.tracks.length) return openPanel('playlist', { playlistId: pl.id })
    setBusy(pl.id)
    try {
      const res = await session.addKnownTracks(pl.tracks)
      const extra = [res.repeated ? `${res.repeated} já estavam na fila` : '', res.skipped ? `${res.skipped} não couberam` : '']
        .filter(Boolean)
        .join('; ')
      showToast(`${res.added} de "${pl.name}" na fila${extra ? ` (${extra})` : ''}.`, 'ok', 4000)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível pôr na fila.', 'error')
    } finally {
      setBusy(null)
    }
  }

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
        <p className="queue-empty">Crie uma playlist da sala no + ou sugira uma das suas. Todo mundo aqui vai ver.</p>
      ) : (
        <ul>
          {lists.map((pl) => (
            <li key={pl.id} className="pl-row">
              <button type="button" className="pl-open" onClick={() => openPanel('playlist', { playlistId: pl.id })} title={`Abrir "${pl.name}"`}>
                <span className={`pl-cover ${pl.kind}`}>
                  <ListIcon width={16} height={16} />
                </span>
                <span className="pl-text">
                  <strong>{pl.name}</strong>
                  <small>
                    {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'} · {pl.kind === 'personal' ? `de ${pl.createdByName}` : 'da sala'}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className="icon-btn pl-play"
                title="Pôr tudo na fila"
                aria-label={`Pôr "${pl.name}" na fila`}
                disabled={busy === pl.id || !pl.tracks.length}
                onClick={() => queueAll(pl)}
              >
                <PlayIcon width={14} height={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {profile && (
        <button type="button" className="link-btn pl-share" onClick={() => openPanel('share')}>
          Sugerir uma playlist minha
        </button>
      )}
    </section>
  )
}
