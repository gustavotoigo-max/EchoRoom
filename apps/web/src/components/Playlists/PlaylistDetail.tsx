import { useState, type FormEvent } from 'react'
import { addToRoomPlaylist, MAX_PLAYLIST_NAME, MAX_PLAYLIST_TRACKS, removeFromRoomPlaylist, removeRoomPlaylist, renameRoomPlaylist, type TrackInput } from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { openPanel, roomUi } from '../RoomSettings/ui'
import { PlayIcon } from '../ui/Icons'
import { tracksFromLink } from './linkTracks'
import { playlistStore } from './store'
import { TrackRow } from './TrackRow'

/** Detalhe de uma playlist vista na sala. */
export function PlaylistDetail() {
  const session = useRoomSession()
  const roomKey = session.backend.roomKey
  const id = useStore(roomUi, (s) => s.playlistId)
  const pl = useStore(playlistStore, (s) => s.room?.find((p) => p.id === id) ?? null)
  const me = useStore(roomStore, (s) => s.participantId)
  const isOwner = useStore(roomStore, selectIsOwner)
  const inRoom = useStore(roomStore, (s) => [s.room?.currentTrack?.videoId, ...(s.room?.queue ?? []).map((q) => q.videoId)].join(','))
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!pl) return <p className="hint">Esta playlist não está mais na sala.</p>
  const mine = pl.createdBy === me
  const canManage = mine || isOwner
  const canAdd = pl.kind === 'room' // as pessoais se editam no perfil de quem criou
  const queued = new Set(inRoom.split(','))

  async function queue(tracks: TrackInput[]) {
    try {
      const res = await session.addKnownTracks(tracks)
      showToast(tracks.length === 1 ? `"${tracks[0].title}" na fila.` : `${res.added} músicas na fila${res.repeated ? ` (${res.repeated} já estavam)` : ''}.`, 'ok', 3500)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível pôr na fila.', 'error')
    }
  }

  async function addLink(e: FormEvent) {
    e.preventDefault()
    if (!pl || !link.trim()) return
    setBusy(true)
    try {
      const tracks = await tracksFromLink(link.trim(), MAX_PLAYLIST_TRACKS - pl.tracks.length)
      let added = 0
      const current = { ...pl, tracks: [...pl.tracks] }
      for (const t of tracks) {
        try {
          await addToRoomPlaylist(roomKey, current, t)
          current.tracks.push({ id: t.videoId, ...t, author: t.author ?? '', at: 0 })
          added++
        } catch {
          /* repetida: segue */
        }
      }
      setLink('')
      showToast(added ? `${added} ${added === 1 ? 'música adicionada' : 'músicas adicionadas'} à playlist.` : 'Essas músicas já estavam na playlist.', added ? 'ok' : 'info', 3000)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="drawer-section">
        <div className="pl-head">
          {name !== null ? (
            <form
              className="inline-field"
              onSubmit={(e) => {
                e.preventDefault()
                renameRoomPlaylist(roomKey, pl, name)
                  .then(() => setName(null))
                  .catch((err: Error) => showToast(err.message || 'Não foi possível renomear.', 'error'))
              }}
            >
              <input value={name} maxLength={MAX_PLAYLIST_NAME} onChange={(e) => setName(e.target.value)} autoFocus />
              <button type="submit" className="btn btn-secondary">
                Salvar
              </button>
            </form>
          ) : (
            <h3 className="pl-title">{pl.name}</h3>
          )}
          <p className="hint">
            {pl.kind === 'personal' ? `Playlist de ${pl.createdByName}, sugerida na sala` : `Playlist da sala, criada por ${pl.createdByName}`} ·{' '}
            {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'}
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={!pl.tracks.length} onClick={() => queue(pl.tracks)}>
              <PlayIcon width={14} height={14} /> Pôr tudo na fila
            </button>
            {canManage && pl.kind === 'room' && name === null && (
              <button type="button" className="btn btn-secondary" onClick={() => setName(pl.name)}>
                Renomear
              </button>
            )}
          </div>
        </div>
      </section>

      {canAdd && (
        <section className="drawer-section">
          <h3>Adicionar</h3>
          <form className="inline-field" onSubmit={addLink}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link de vídeo ou playlist do YouTube" disabled={busy} />
            <button type="submit" className="btn btn-secondary" disabled={busy || !link.trim()}>
              {busy ? 'Lendo…' : 'Adicionar'}
            </button>
          </form>
          <p className="hint">Qualquer pessoa na sala pode pôr músicas nesta playlist. Também dá para salvar a música que está tocando pelo botão de marcador.</p>
        </section>
      )}

      <section className="drawer-section">
        <h3>Músicas</h3>
        {pl.tracks.length === 0 ? (
          <p className="hint">Nenhuma música ainda.</p>
        ) : (
          <ul className="pl-tracks">
            {pl.tracks.map((t) => (
              <TrackRow
                key={t.id}
                t={t}
                inQueue={queued.has(t.videoId)}
                onQueue={() => queue([t])}
                onRemove={canManage && pl.kind === 'room' ? () => removeFromRoomPlaylist(roomKey, pl, t.id).catch(() => {}) : undefined}
              />
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <section className="drawer-section is-danger">
          <h3>{pl.kind === 'personal' ? 'Sugestão' : 'Apagar'}</h3>
          {pl.kind === 'personal' && mine && <p className="hint">Para mudar as músicas desta playlist, edite no seu perfil.</p>}
          {confirmDelete ? (
            <div className="row">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  removeRoomPlaylist(roomKey, session.roomId, pl)
                    .then(() => openPanel(null))
                    .catch(() => showToast('Não foi possível.', 'error'))
                }
              >
                {pl.kind === 'personal' ? 'Tirar da sala' : 'Apagar playlist'}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(true)}>
              {pl.kind === 'personal' ? 'Tirar a sugestão desta sala' : 'Apagar esta playlist'}
            </button>
          )}
        </section>
      )}
    </>
  )
}
