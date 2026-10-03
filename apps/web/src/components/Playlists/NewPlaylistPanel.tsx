import { useState, type FormEvent } from 'react'
import { createRoomPlaylist, MAX_PLAYLIST_NAME } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { openPanel, roomUi } from '../RoomSettings/ui'
import { useMe } from './useMe'

/** Criar playlist da sala (vazia ou já com a música escolhida). */
export function NewPlaylistPanel() {
  const session = useRoomSession()
  const track = useStore(roomUi, (s) => s.track)
  const me = useMe()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const id = await createRoomPlaylist(session.backend.roomKey, name, me, track ?? undefined)
      showToast(`Playlist "${name.trim()}" criada.`, 'ok', 2500)
      openPanel('playlist', { playlistId: id })
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível criar.', 'error')
      setBusy(false)
    }
  }

  return (
    <section className="drawer-section">
      <h3>Nova playlist da sala</h3>
      <form className="field" onSubmit={create}>
        <span>Nome</span>
        <div className="inline-field">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_PLAYLIST_NAME} placeholder="Ex.: Clássicos do rock" autoFocus />
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
            Criar
          </button>
        </div>
      </form>
      <p className="hint">
        Todo mundo na sala vê e pode pôr músicas nela.{track ? ` "${track.title}" já entra como primeira música.` : ''} Para uma playlist só sua, que
        você leva para outras salas, crie no seu perfil.
      </p>
    </section>
  )
}
