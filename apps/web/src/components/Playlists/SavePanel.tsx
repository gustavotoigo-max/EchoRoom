import { useMemo, useState } from 'react'
import { authStore } from '../../services/discordAuth'
import { addToMyPlaylist, addToRoomPlaylist, createMyPlaylist, MAX_PLAYLIST_NAME, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { openPanel, roomUi } from '../RoomSettings/ui'
import { CheckIcon, PlusIcon } from '../ui/Icons'
import { playlistStore } from './store'

/** Salvar uma música numa playlist (da sala ou pessoal). */
export function SavePanel() {
  const session = useRoomSession()
  const roomKey = session.backend.roomKey
  const track = useStore(roomUi, (s) => s.track)
  const profile = useStore(authStore, (s) => s.profile)
  const allRoom = useStore(playlistStore, (s) => s.room)
  const roomLists = useMemo(() => (allRoom ?? []).filter((p) => p.kind === 'room'), [allRoom])
  const mine = useStore(playlistStore, (s) => s.mine)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  if (!track) return null
  const t = track

  async function save(pl: Playlist, personal: boolean) {
    setBusy(pl.id)
    try {
      if (personal) await addToMyPlaylist(profile!, pl, t)
      else await addToRoomPlaylist(roomKey, pl, t)
      showToast(`Salva em "${pl.name}".`, 'ok', 2500)
      openPanel(null)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível salvar.', 'error')
      setBusy(null)
    }
  }

  const has = (pl: Playlist) => pl.tracks.some((x) => x.videoId === t.videoId)

  return (
    <>
      <section className="drawer-section">
        <div className="save-track">
          <img src={thumbnailUrl(t.videoId)} alt="" width={80} height={45} />
          <span className="pl-text">
            <strong>{t.title}</strong>
            {t.author && <small>{t.author}</small>}
          </span>
        </div>
      </section>
      <section className="drawer-section">
        <h3>Playlists da sala</h3>
        <ul className="save-list">
          {roomLists.map((pl) => (
            <li key={pl.id}>
              <button type="button" disabled={has(pl) || busy !== null} onClick={() => save(pl, false)}>
                <span>{pl.name}</span>
                {has(pl) ? (
                  <small className="sent-tag">
                    <CheckIcon width={12} height={12} /> já está
                  </small>
                ) : (
                  <small>{pl.tracks.length} músicas</small>
                )}
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="save-new" onClick={() => openPanel('newPlaylist', { track: t })}>
              <PlusIcon width={14} height={14} /> <span>Nova playlist da sala</span>
            </button>
          </li>
        </ul>
      </section>
      <section className="drawer-section">
        <h3>Minhas playlists</h3>
        {!profile ? (
          <p className="hint">Entre com Discord para ter playlists suas, que você leva para qualquer sala.</p>
        ) : (
          <ul className="save-list">
            {(mine ?? []).map((pl) => (
              <li key={pl.id}>
                <button type="button" disabled={has(pl) || busy !== null} onClick={() => save(pl, true)}>
                  <span>{pl.name}</span>
                  {has(pl) ? (
                    <small className="sent-tag">
                      <CheckIcon width={12} height={12} /> já está
                    </small>
                  ) : (
                    <small>{pl.tracks.length} músicas</small>
                  )}
                </button>
              </li>
            ))}
            <li>
              <form
                className="inline-field"
                onSubmit={async (e) => {
                  e.preventDefault()
                  try {
                    await createMyPlaylist(newName, t)
                    showToast(`Playlist "${newName.trim()}" criada no seu perfil.`, 'ok', 3000)
                    openPanel(null)
                  } catch (err) {
                    showToast((err as Error).message || 'Não foi possível criar.', 'error')
                  }
                }}
              >
                <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={MAX_PLAYLIST_NAME} placeholder="Nova playlist minha" />
                <button type="submit" className="btn btn-secondary" disabled={!newName.trim()}>
                  Criar
                </button>
              </form>
            </li>
          </ul>
        )}
      </section>
    </>
  )
}
