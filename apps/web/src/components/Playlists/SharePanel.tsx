import { useState } from 'react'
import { navigate, PROFILE_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { shareToRoom, unshareFromRoom, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { openPanel } from '../RoomSettings/ui'
import { CloseIcon, PlusIcon } from '../ui/Icons'
import { playlistStore } from './store'

/** Sugerir (ou tirar) playlists pessoais nesta sala. */
export function SharePanel() {
  const session = useRoomSession()
  const profile = useStore(authStore, (s) => s.profile)
  const mine = useStore(playlistStore, (s) => s.mine)
  const [busy, setBusy] = useState<string | null>(null)

  if (!profile) return <p className="hint">Entre com Discord para sugerir playlists suas.</p>

  async function toggle(pl: Playlist) {
    setBusy(pl.id)
    try {
      if (pl.sharedIn[session.roomId]) await unshareFromRoom(profile!, pl, session.roomId)
      else await shareToRoom(profile!, pl, session.roomId, session.backend.roomKey)
    } catch {
      showToast('Não foi possível. Tente de novo.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="drawer-section">
      <h3>Suas playlists</h3>
      <p className="hint">A sala só vê as playlists que você sugerir aqui. Se você editar a playlist no perfil, a sala vê a versão nova.</p>
      {mine === null ? (
        <p className="hint">Carregando…</p>
      ) : mine.length === 0 ? (
        <p className="hint">Você ainda não tem playlists.</p>
      ) : (
        <ul className="save-list">
          {mine.map((pl) => {
            const shared = !!pl.sharedIn[session.roomId]
            return (
              <li key={pl.id}>
                <button type="button" className={shared ? 'is-on' : ''} disabled={busy === pl.id} onClick={() => toggle(pl)}>
                  <span>{pl.name}</span>
                  <small>{shared ? 'sugerida aqui · tirar' : `${pl.tracks.length} músicas · sugerir`}</small>
                  {shared ? <CloseIcon width={14} height={14} /> : <PlusIcon width={14} height={14} />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => {
          openPanel(null)
          navigate(PROFILE_PATH)
        }}
      >
        Criar ou editar no perfil
      </button>
    </section>
  )
}
