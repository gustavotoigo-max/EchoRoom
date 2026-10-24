import { useState } from 'react'
import { importMyPlaylist, MAX_PLAYLIST_TRACKS } from '../../services/firebase/playlists'
import { googleEnabled } from '../../services/googleAuth'
import { listMyYouTubePlaylists, myPlaylistTracks, type AccountPlaylist } from '../../services/youtube/account'
import { showToast } from '../../stores/toastStore'

/**
 * Importar playlists da conta Google (YouTube e YouTube Music): lista as
 * playlists da pessoa e ela marca quais trazer para a biblioteca.
 */
export function ImportFromGoogle() {
  const [lists, setLists] = useState<AccountPlaylist[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<string | null>(null)

  if (!googleEnabled) return null

  async function load() {
    setProgress('Abrindo o Google…')
    try {
      const found = await listMyYouTubePlaylists()
      setLists(found)
      setPicked(new Set())
      if (!found.length) showToast('Nenhuma playlist nessa conta do YouTube.', 'info', 4000)
    } catch (err) {
      showToast((err as Error).message, 'error')
    } finally {
      setProgress(null)
    }
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function run() {
    const chosen = (lists ?? []).filter((p) => picked.has(p.id))
    let done = 0
    for (const pl of chosen) {
      setProgress(`Importando ${done + 1} de ${chosen.length}…`)
      try {
        const tracks = await myPlaylistTracks(pl.id, MAX_PLAYLIST_TRACKS + 1)
        await importMyPlaylist(pl.title, tracks, { kind: 'youtube', listId: pl.id })
        done++
      } catch (err) {
        showToast(`"${pl.title}": ${(err as Error).message}`, 'error')
      }
    }
    setProgress(null)
    if (done) {
      showToast(`${done} ${done === 1 ? 'playlist importada' : 'playlists importadas'}.`, 'ok', 4000)
      setLists(null)
    }
  }

  if (!lists) {
    return (
      <button type="button" className="btn btn-secondary gpl-open" onClick={load} disabled={!!progress}>
        {progress ?? 'Importar da minha conta Google'}
      </button>
    )
  }

  return (
    <div className="gpl">
      <div className="gpl-head">
        <strong>Suas playlists no YouTube</strong>
        <button type="button" className="link-btn" onClick={() => setLists(null)} disabled={!!progress}>
          Fechar
        </button>
      </div>
      <ul className="gpl-list">
        {lists.map((p) => (
          <li key={p.id}>
            <label>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} disabled={!!progress} />
              {p.thumb ? <img src={p.thumb} alt="" width={48} height={36} loading="lazy" /> : <span className="gpl-thumb" />}
              <span className="gpl-name" title={p.title}>
                {p.title}
              </span>
              <small>
                {p.count} {p.count === 1 ? 'música' : 'músicas'}
              </small>
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-primary" onClick={run} disabled={!!progress || picked.size === 0}>
        {progress ?? (picked.size ? `Importar ${picked.size}` : 'Marque as playlists')}
      </button>
      {lists.some((p) => p.count > MAX_PLAYLIST_TRACKS) && (
        <p className="hint">Playlists com mais de {MAX_PLAYLIST_TRACKS} músicas entram só com as primeiras {MAX_PLAYLIST_TRACKS}.</p>
      )}
    </div>
  )
}
