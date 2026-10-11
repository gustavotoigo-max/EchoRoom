import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addToRoomPlaylist,
  createRoomPlaylistWith,
  MAX_PLAYLIST_NAME,
  MAX_PLAYLIST_TRACKS,
  removeRoomPlaylist,
  removeTracksFromRoomPlaylist,
  renameRoomPlaylist,
  reorderRoomPlaylist,
  type Playlist,
  type TrackInput,
} from '../../services/firebase/playlists'
import { useRoomSession } from '../../services/RoomSessionContext'
import { thumbnailUrl } from '../../services/youtube/metadata'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { normalizeText as norm } from '../../utils/format'
import { tracksFromLink } from '../Playlists/linkTracks'
import { useMe } from '../Playlists/useMe'
import { ChevronDownIcon, ChevronUpIcon, DuplicateIcon, PencilIcon, PlayIcon, PlusIcon, ShuffleIcon, TrashIcon } from '../ui/Icons'
import { playlistManagerStore } from './store'

const shuffled = <T,>(list: T[]): T[] => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** A playlist escolhida: renomear, pôr na fila, adicionar, reordenar, tirar músicas e apagar. */
export function PlaylistEditor({ pl }: { pl: Playlist }) {
  const session = useRoomSession()
  const roomKey = session.backend.roomKey
  const me = useMe()
  const myUid = useStore(roomStore, (s) => s.participantId)
  const isOwner = useStore(roomStore, selectIsOwner)
  const addLocked = useStore(roomStore, (s) => s.settings.adding === 'owner' && !selectIsOwner(s))
  const inRoom = useStore(roomStore, (s) => [s.room?.currentTrack?.videoId, ...(s.room?.queue ?? []).map((q) => q.videoId)].join(','))
  const [name, setName] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<'delete' | 'removePicked' | null>(null)

  const mine = pl.createdBy === myUid
  const canManage = mine || isOwner
  /** Músicas das sugeridas se editam no perfil de quem criou. */
  const canEdit = canManage && pl.kind === 'room'
  const queued = useMemo(() => new Set(inRoom.split(',')), [inRoom])
  const q = norm(search.trim())
  const shown = q ? pl.tracks.filter((t) => norm(`${t.title} ${t.author}`).includes(q)) : pl.tracks

  // Seleção só com músicas que ainda existem.
  useEffect(() => {
    setPicked((p) => {
      const ids = new Set(pl.tracks.map((t) => t.id))
      const next = new Set([...p].filter((id) => ids.has(id)))
      return next.size === p.size ? p : next
    })
  }, [pl.tracks])

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível. Só quem criou ou o dono da sala pode fazer isso.', 'error')
    } finally {
      setBusy(null)
    }
  }

  const queue = (tracks: TrackInput[], label = 'queue') =>
    run(label, async () => {
      const res = await session.addKnownTracks(tracks)
      const extra = [res.repeated ? `${res.repeated} já estavam` : '', res.skipped ? `${res.skipped} não couberam` : ''].filter(Boolean).join('; ')
      showToast(tracks.length === 1 ? `"${tracks[0].title}" na fila.` : `${res.added} músicas na fila${extra ? ` (${extra})` : ''}.`, 'ok', 3500)
    })

  function rename(e: FormEvent) {
    e.preventDefault()
    if (name === null) return
    void run('rename', async () => {
      await renameRoomPlaylist(roomKey, pl, name)
      setName(null)
    })
  }

  function addLink(e: FormEvent) {
    e.preventDefault()
    if (!link.trim()) return
    void run('add', async () => {
      const tracks = await tracksFromLink(link.trim(), MAX_PLAYLIST_TRACKS - pl.tracks.length)
      let added = 0
      const current = { ...pl, tracks: [...pl.tracks] }
      for (const t of tracks) {
        try {
          await addToRoomPlaylist(roomKey, current, t)
          current.tracks.push({ id: t.videoId, ...t, author: t.author ?? '', at: 0 })
          added++
        } catch {
          /* repetida ou limite: segue */
        }
      }
      setLink('')
      showToast(
        added ? `${added} ${added === 1 ? 'música adicionada' : 'músicas adicionadas'} à playlist.` : 'Essas músicas já estavam na playlist.',
        added ? 'ok' : 'info',
        3000,
      )
    })
  }

  const move = (index: number, delta: number) => {
    const ids = pl.tracks.map((t) => t.id)
    const to = index + delta
    if (to < 0 || to >= ids.length) return
    ;[ids[index], ids[to]] = [ids[to], ids[index]]
    void run('move', () => reorderRoomPlaylist(roomKey, pl, ids))
  }

  const duplicate = () =>
    run('dup', async () => {
      const id = await createRoomPlaylistWith(roomKey, `${pl.name} (cópia)`.slice(0, MAX_PLAYLIST_NAME), me, pl.tracks)
      showToast(`"${pl.name}" duplicada.`, 'ok', 2500)
      playlistManagerStore.set({ selectedId: id })
    })

  const togglePick = (id: string) =>
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const allShownPicked = shown.length > 0 && shown.every((t) => picked.has(t.id))

  return (
    <div className="pm-editor">
      <div className="pm-editor-head">
        {name !== null ? (
          <form className="inline-field" onSubmit={rename}>
            <input value={name} maxLength={MAX_PLAYLIST_NAME} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} autoFocus />
            <button type="submit" className="btn btn-primary" disabled={!name.trim() || busy === 'rename'}>
              Salvar
            </button>
            <button type="button" className="link-btn" onClick={() => setName(null)}>
              Cancelar
            </button>
          </form>
        ) : (
          <h2 className="pl-title">
            {pl.name}
            {canEdit && (
              <button type="button" className="icon-btn pm-rename" title="Renomear" aria-label="Renomear playlist" onClick={() => setName(pl.name)}>
                <PencilIcon width={15} height={15} />
              </button>
            )}
          </h2>
        )}
        <p className="hint">
          {pl.kind === 'personal' ? `Playlist de ${pl.createdByName}, sugerida na sala` : `Playlist da sala, criada por ${mine ? 'você' : pl.createdByName || 'alguém'}`} ·{' '}
          {pl.tracks.length} {pl.tracks.length === 1 ? 'música' : 'músicas'}
        </p>
        <div className="row pm-actions">
          <button type="button" className="btn btn-primary" disabled={!pl.tracks.length || addLocked || !!busy} onClick={() => queue(pl.tracks, 'all')}>
            <PlayIcon width={14} height={14} /> Pôr tudo na fila
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            title="Põe na fila numa ordem aleatória"
            disabled={pl.tracks.length < 2 || addLocked || !!busy}
            onClick={() => queue(shuffled(pl.tracks), 'shuffle')}
          >
            <ShuffleIcon width={14} height={14} /> Fila aleatória
          </button>
          <button type="button" className="btn btn-secondary" title="Cria uma cópia desta playlist" disabled={!pl.tracks.length || !!busy} onClick={duplicate}>
            <DuplicateIcon width={14} height={14} /> Duplicar
          </button>
          {canEdit && (
            <button
              type="button"
              className="btn btn-secondary"
              title="Embaralha a ordem salva da playlist"
              disabled={pl.tracks.length < 2 || !!busy}
              onClick={() => run('reshuffle', () => reorderRoomPlaylist(roomKey, pl, shuffled(pl.tracks.map((t) => t.id))))}
            >
              <ShuffleIcon width={14} height={14} /> Embaralhar ordem
            </button>
          )}
        </div>
        {addLocked && <p className="hint">Nesta sala, só o dono põe músicas na fila.</p>}
      </div>

      {pl.kind === 'room' && (
        <form className="inline-field pm-add" onSubmit={addLink}>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Cole um link de vídeo ou playlist do YouTube" disabled={busy === 'add'} />
          <button type="submit" className="btn btn-secondary" disabled={busy === 'add' || !link.trim()}>
            {busy === 'add' ? (
              'Lendo…'
            ) : (
              <>
                <PlusIcon width={14} height={14} /> Adicionar
              </>
            )}
          </button>
        </form>
      )}
      {pl.kind === 'personal' && (
        <p className="hint">{mine ? 'Para mudar as músicas desta playlist, edite no seu perfil.' : 'As músicas desta playlist são editadas por quem a sugeriu.'}</p>
      )}

      {pl.tracks.length > 0 && (
        <div className="pm-tools">
          {pl.tracks.length > 6 && (
            <input className="pm-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nesta playlist" />
          )}
          {canEdit && (
            <label className="pm-pick-all">
              <input
                type="checkbox"
                checked={allShownPicked}
                onChange={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((t) => t.id)))}
              />
              Selecionar {q ? 'as encontradas' : 'todas'}
            </label>
          )}
          {canEdit && picked.size > 0 && (
            <button type="button" className="btn btn-danger pm-remove-picked" onClick={() => setConfirm('removePicked')}>
              <TrashIcon width={14} height={14} /> Tirar {picked.size} {picked.size === 1 ? 'música' : 'músicas'}
            </button>
          )}
        </div>
      )}

      {confirm === 'removePicked' && (
        <div className="pm-confirm" role="alert">
          <span>
            Tirar {picked.size} {picked.size === 1 ? 'música' : 'músicas'} de "{pl.name}"?
          </span>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() =>
              run('removePicked', async () => {
                await removeTracksFromRoomPlaylist(roomKey, pl, [...picked])
                showToast(`${picked.size} ${picked.size === 1 ? 'música saiu' : 'músicas saíram'} da playlist.`, 'info', 2500)
                setPicked(new Set())
                setConfirm(null)
              })
            }
          >
            Tirar
          </button>
          <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
            Cancelar
          </button>
        </div>
      )}

      {pl.tracks.length === 0 ? (
        <p className="sugg-empty">Nenhuma música ainda. Cole um link acima ou salve a música que está tocando pelo botão de marcador.</p>
      ) : shown.length === 0 ? (
        <p className="sugg-empty">Nenhuma música encontrada.</p>
      ) : (
        <ol className="pm-tracks">
          {shown.map((t) => {
            const index = pl.tracks.indexOf(t)
            const inQueue = queued.has(t.videoId)
            return (
              <li key={t.id} className={`pm-track ${picked.has(t.id) ? 'is-picked' : ''}`}>
                {canEdit ? (
                  <input type="checkbox" checked={picked.has(t.id)} onChange={() => togglePick(t.id)} aria-label={`Selecionar ${t.title}`} />
                ) : (
                  <span />
                )}
                <span className="pm-pos">{index + 1}</span>
                <img src={thumbnailUrl(t.videoId)} alt="" width={64} height={36} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                <span className="pl-text">
                  <strong title={t.title}>{t.title}</strong>
                  {t.author && <small>{t.author}</small>}
                </span>
                <span className="pm-track-actions">
                  {canEdit && !q && (
                    <>
                      <button type="button" className="icon-btn" title="Subir" aria-label={`Subir ${t.title}`} disabled={index === 0 || !!busy} onClick={() => move(index, -1)}>
                        <ChevronUpIcon width={14} height={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Descer"
                        aria-label={`Descer ${t.title}`}
                        disabled={index === pl.tracks.length - 1 || !!busy}
                        onClick={() => move(index, 1)}
                      >
                        <ChevronDownIcon width={14} height={14} />
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-secondary pm-queue-one" disabled={inQueue || addLocked} onClick={() => queue([t], `q-${t.id}`)}>
                    {inQueue ? (
                      'Na fila'
                    ) : (
                      <>
                        <PlusIcon width={13} height={13} /> Fila
                      </>
                    )}
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      className="icon-btn pm-del"
                      title="Tirar da playlist"
                      aria-label={`Tirar ${t.title} da playlist`}
                      onClick={() => run(`del-${t.id}`, () => removeTracksFromRoomPlaylist(roomKey, pl, [t.id]))}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {canManage && (
        <div className="pm-danger">
          {confirm === 'delete' ? (
            <div className="pm-confirm" role="alert">
              <span>{pl.kind === 'personal' ? `Tirar "${pl.name}" desta sala?` : `Apagar "${pl.name}" para todo mundo? Não dá para desfazer.`}</span>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  run('delete', async () => {
                    await removeRoomPlaylist(roomKey, session.roomId, pl)
                    showToast(pl.kind === 'personal' ? `"${pl.name}" saiu da sala.` : `"${pl.name}" foi apagada.`, 'info', 3000)
                    playlistManagerStore.set({ selectedId: null })
                  })
                }
              >
                {pl.kind === 'personal' ? 'Tirar da sala' : 'Apagar'}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-secondary pm-delete" onClick={() => setConfirm('delete')}>
              <TrashIcon width={14} height={14} /> {pl.kind === 'personal' ? 'Tirar a sugestão desta sala' : 'Apagar playlist'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
