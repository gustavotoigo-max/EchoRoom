import { useEffect, useState, type FormEvent } from 'react'
import { tracksFromLink } from '../../components/Playlists/linkTracks'
import { CloseIcon, ListIcon } from '../../components/ui/Icons'
import type { DiscordProfile } from '../../services/discordAuth'
import {
  addToMyPlaylist,
  createMyPlaylist,
  deleteMyPlaylist,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_TRACKS,
  removeFromMyPlaylist,
  renameMyPlaylist,
  subscribeMyPlaylists,
  unshareFromRoom,
  type Playlist,
} from '../../services/firebase/playlists'
import type { MyRoom } from '../../services/firebase/social'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { showToast } from '../../stores/toastStore'

/** Playlists pessoais: criar, editar e ver em quais salas estão sugeridas. */
export function MyPlaylists({ profile, rooms }: { profile: DiscordProfile; rooms: MyRoom[] | null }) {
  const [lists, setLists] = useState<Playlist[] | null>(null)
  const [name, setName] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => subscribeMyPlaylists(profile.uid, setLists, () => setLists([])), [profile])
  const open = lists?.find((p) => p.id === openId) ?? null

  async function create(e: FormEvent) {
    e.preventDefault()
    try {
      const id = await createMyPlaylist(name)
      setName('')
      setOpenId(id)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível criar.', 'error')
    }
  }

  return (
    <section className="profile-block">
      <header className="side-head">
        <h3>Minhas playlists</h3>
        <span className="count">{lists ? lists.length : ''}</span>
      </header>
      <form className="inline-field my-pl-new" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_PLAYLIST_NAME} placeholder="Nome da nova playlist" />
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Criar playlist
        </button>
      </form>
      {lists && lists.length === 0 && (
        <p className="sugg-empty">
          Playlists suas ficam aqui e você pode sugerir em qualquer sala. Dentro de uma sala, o botão de marcador salva a
          música que está tocando.
        </p>
      )}
      {lists && lists.length > 0 && (
        <div className="room-cards">
          {lists.map((pl) => {
            const shared = Object.keys(pl.sharedIn).length
            return (
              <button key={pl.id} type="button" className="room-card pl-card" onClick={() => setOpenId(pl.id)}>
                <div className="room-card-top">
                  <h4 title={pl.name}>{pl.name}</h4>
                  <ListIcon width={16} height={16} />
                </div>
                <p>
                  {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'}
                  {shared ? ` · sugerida em ${shared} ${shared === 1 ? 'sala' : 'salas'}` : ''}
                </p>
                <div className="pl-thumbs" aria-hidden="true">
                  {pl.tracks.slice(0, 4).map((t) => (
                    <img key={t.id} src={thumbnailUrl(t.videoId)} alt="" loading="lazy" />
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      )}
      {open && <PlaylistEditor pl={open} profile={profile} rooms={rooms} onClose={() => setOpenId(null)} />}
    </section>
  )
}

function PlaylistEditor({
  pl,
  profile,
  rooms,
  onClose,
}: {
  pl: Playlist
  profile: DiscordProfile
  rooms: MyRoom[] | null
  onClose: () => void
}) {
  const [name, setName] = useState(pl.name)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => setName(pl.name), [pl.name])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function addLink(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const tracks = await tracksFromLink(link.trim(), MAX_PLAYLIST_TRACKS - pl.tracks.length)
      let added = 0
      const current = { ...pl, tracks: [...pl.tracks] }
      for (const t of tracks) {
        try {
          await addToMyPlaylist(profile, current, t)
          current.tracks.push({ id: t.videoId, ...t, author: t.author ?? '', at: 0 })
          added++
        } catch {
          /* repetida */
        }
      }
      setLink('')
      showToast(added ? `${added} ${added === 1 ? 'música adicionada' : 'músicas adicionadas'}.` : 'Essas músicas já estavam na playlist.', added ? 'ok' : 'info', 2500)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const roomName = (roomId: string) => rooms?.find((r) => r.roomId === roomId)?.name ?? `Sala ${roomId}`

  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Playlist ${pl.name}`}>
        <header className="drawer-head">
          <h2>Minha playlist</h2>
          <button type="button" className="icon-btn drawer-close" aria-label="Fechar" onClick={onClose}>
            <CloseIcon width={18} height={18} />
          </button>
        </header>
        <div className="drawer-body">
          <section className="drawer-section">
            <label className="field">
              <span>Nome</span>
              <div className="inline-field">
                <input value={name} maxLength={MAX_PLAYLIST_NAME} onChange={(e) => setName(e.target.value)} />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!name.trim() || name.trim() === pl.name}
                  onClick={() => renameMyPlaylist(profile, pl, name).catch((err: Error) => showToast(err.message, 'error'))}
                >
                  Salvar
                </button>
              </div>
            </label>
          </section>
          <section className="drawer-section">
            <h3>Adicionar músicas</h3>
            <form className="inline-field" onSubmit={addLink}>
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link de vídeo ou playlist do YouTube" disabled={busy} />
              <button type="submit" className="btn btn-primary" disabled={busy || !link.trim()}>
                {busy ? 'Lendo…' : 'Adicionar'}
              </button>
            </form>
          </section>
          <section className="drawer-section">
            <h3>
              Músicas · {pl.tracks.length}/{MAX_PLAYLIST_TRACKS}
            </h3>
            {pl.tracks.length === 0 ? (
              <p className="hint">Nenhuma música ainda.</p>
            ) : (
              <ul className="pl-tracks">
                {pl.tracks.map((t) => (
                  <li key={t.id} className="pl-track">
                    <img src={thumbnailUrl(t.videoId)} alt="" width={56} height={32} loading="lazy" />
                    <span className="pl-text">
                      <strong title={t.title}>{t.title}</strong>
                      {t.author && <small>{t.author}</small>}
                    </span>
                    <button
                      type="button"
                      className="sugg-remove"
                      aria-label={`Tirar ${t.title}`}
                      title="Tirar da playlist"
                      onClick={() => removeFromMyPlaylist(profile, pl, t.id).catch(() => {})}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="drawer-section">
            <h3>Sugerida nas salas</h3>
            {Object.keys(pl.sharedIn).length === 0 ? (
              <p className="hint">Em nenhuma. Dentro de uma sala, use “Sugerir uma playlist minha” na coluna de playlists.</p>
            ) : (
              <ul className="banned-list">
                {Object.keys(pl.sharedIn).map((roomId) => (
                  <li key={roomId}>
                    <span>{roomName(roomId)}</span>
                    <button type="button" className="link-btn" onClick={() => unshareFromRoom(profile, pl, roomId).catch(() => {})}>
                      Tirar da sala
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="drawer-section is-danger">
            <h3>Apagar</h3>
            {confirmDelete ? (
              <div className="row">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    deleteMyPlaylist(profile, pl)
                      .then(onClose)
                      .catch(() => showToast('Não foi possível apagar.', 'error'))
                  }
                >
                  Apagar de vez
                </button>
                <button type="button" className="link-btn" onClick={() => setConfirmDelete(false)}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(true)}>
                Apagar esta playlist (some também das salas)
              </button>
            )}
          </section>
        </div>
      </aside>
    </div>
  )
}
