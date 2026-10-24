import { useState } from 'react'
import { goToProfile } from '../../services/profileOverlay'
import { authStore } from '../../services/discordAuth'
import { shareToRoom, unshareFromRoom, type Playlist } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { openPanel } from '../RoomSettings/ui'
import { CheckIcon, CloseIcon } from '../ui/Icons'
import { ImportPlaylistForm } from './ImportPlaylistForm'
import { playlistStore } from './store'

/**
 * Adicionar playlists da biblioteca à sala: marca uma ou várias e confirma.
 * Nada vai sozinho; a sala vê só o que a pessoa escolher aqui.
 */
export function SharePanel() {
  const session = useRoomSession()
  const profile = useStore(authStore, (s) => s.profile)
  const mine = useStore(playlistStore, (s) => s.mine)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  if (!profile) return <p className="hint">Entre na sua conta para levar playlists suas para a sala.</p>

  const inRoom = (pl: Playlist) => !!pl.sharedIn[session.roomId]
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function addPicked() {
    const lists = (mine ?? []).filter((pl) => picked.has(pl.id) && !inRoom(pl))
    if (!lists.length) return
    setBusy('add')
    const failed: string[] = []
    for (const pl of lists) {
      try {
        await shareToRoom(profile!, pl, session.roomId, session.backend.roomKey)
      } catch {
        failed.push(pl.name)
      }
    }
    setBusy(null)
    setPicked(new Set())
    const ok = lists.length - failed.length
    if (ok) showToast(ok === 1 ? `"${lists.find((p) => !failed.includes(p.name))!.name}" está na sala.` : `${ok} playlists estão na sala.`, 'ok', 3000)
    if (failed.length) showToast(`Não foi possível adicionar: ${failed.join(', ')}.`, 'error')
  }

  async function remove(pl: Playlist) {
    setBusy(pl.id)
    try {
      await unshareFromRoom(profile!, pl, session.roomId)
    } catch {
      showToast('Não foi possível tirar. Tente de novo.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const count = (mine ?? []).filter((pl) => picked.has(pl.id) && !inRoom(pl)).length

  return (
    <>
      <section className="drawer-section">
        <h3>Minhas playlists</h3>
        <p className="hint">Marque as que você quer levar. Se você editar a playlist depois, a sala vê a versão nova.</p>
        {mine === null ? (
          <p className="hint">Carregando…</p>
        ) : mine.length === 0 ? (
          <p className="hint">Você ainda não tem playlists. Importe uma do YouTube aqui embaixo.</p>
        ) : (
          <ul className="save-list share-list">
            {mine.map((pl) => {
              const shared = inRoom(pl)
              const on = shared || picked.has(pl.id)
              return (
                <li key={pl.id}>
                  <button
                    type="button"
                    className={on ? 'is-on' : ''}
                    role="checkbox"
                    aria-checked={on}
                    disabled={!!busy}
                    onClick={() => (shared ? remove(pl) : toggle(pl.id))}
                    title={shared ? 'Já está na sala: clique para tirar' : undefined}
                  >
                    <span className="share-check" aria-hidden="true">
                      {on && <CheckIcon width={12} height={12} />}
                    </span>
                    <span>{pl.name}</span>
                    <small>
                      {pl.source ? `${sourceLabel(pl.source.kind)} · ` : ''}
                      {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'}
                      {shared ? ' · já na sala' : ''}
                    </small>
                    {shared && <CloseIcon width={14} height={14} />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="btn btn-primary" disabled={!count || !!busy} onClick={addPicked}>
          {busy === 'add' ? 'Adicionando…' : count ? `Adicionar à sala (${count})` : 'Adicionar à sala'}
        </button>
      </section>
      <section className="drawer-section">
        <h3>Importar do YouTube</h3>
        <ImportPlaylistForm onImported={(id) => setPicked((cur) => new Set(cur).add(id))} />
        <p className="hint">A playlist vai para a sua biblioteca e já fica marcada aqui em cima.</p>
      </section>
      <section className="drawer-section">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            openPanel(null)
            goToProfile()
          }}
        >
          Criar ou editar no perfil
        </button>
      </section>
    </>
  )
}

export const sourceLabel = (kind: 'youtube' | 'youtubeMusic') => (kind === 'youtubeMusic' ? 'YouTube Music' : 'YouTube')
