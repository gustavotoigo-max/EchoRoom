import { useMemo, useState, type FormEvent } from 'react'
import { navigate, PROFILE_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import {
  addToMyPlaylist,
  addToRoomPlaylist,
  createMyPlaylist,
  createRoomPlaylist,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_TRACKS,
  removeFromRoomPlaylist,
  removeRoomPlaylist,
  renameRoomPlaylist,
  shareToRoom,
  unshareFromRoom,
  type Playlist,
  type TrackInput,
} from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { openPanel, roomUi } from '../RoomSettings/ui'
import { CheckIcon, CloseIcon, PlayIcon, PlusIcon } from '../ui/Icons'
import { tracksFromLink } from './linkTracks'
import { playlistStore } from './store'

/** Nome e avatar de quem está na sala (Discord ou convidado). */
function useMe() {
  const profile = useStore(authStore, (s) => s.profile)
  const myName = useStore(roomStore, (s) => s.room?.participants.find((p) => p.id === s.participantId)?.name ?? '')
  return { name: profile?.name || myName || 'Alguém', avatar: profile?.avatarUrl ?? null }
}

/** Uma música numa lista de playlist: miniatura, título, "Fila" e (se puder) remover. */
function TrackRow({
  t,
  onQueue,
  onRemove,
  inQueue,
}: {
  t: { videoId: string; title: string; author: string }
  onQueue: () => void
  onRemove?: () => void
  inQueue: boolean
}) {
  return (
    <li className="pl-track">
      <img src={thumbnailUrl(t.videoId)} alt="" width={56} height={32} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      <span className="pl-text">
        <strong title={t.title}>{t.title}</strong>
        {t.author && <small>{t.author}</small>}
      </span>
      <button type="button" className="btn btn-secondary sugg-add" disabled={inQueue} onClick={onQueue}>
        {inQueue ? 'Na fila' : (
          <>
            <PlusIcon width={14} height={14} />
            <span>Fila</span>
          </>
        )}
      </button>
      {onRemove && (
        <button type="button" className="sugg-remove" title="Tirar da playlist" aria-label={`Tirar ${t.title} da playlist`} onClick={onRemove}>
          ×
        </button>
      )}
    </li>
  )
}

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
