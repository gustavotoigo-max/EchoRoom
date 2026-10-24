import { useState, type FormEvent } from 'react'
import { MAX_PLAYLIST_TRACKS } from '../../services/firebase/playlists'
import { showToast } from '../../stores/toastStore'
import { importPlaylistFromLink } from './linkTracks'

/** Colar o link de uma playlist do YouTube / YouTube Music e salvar na biblioteca. */
export function ImportPlaylistForm({ onImported }: { onImported?: (id: string) => void }) {
  const [link, setLink] = useState('')
  const [progress, setProgress] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!link.trim() || progress) return
    setProgress('Lendo a playlist…')
    try {
      const res = await importPlaylistFromLink(link.trim(), setProgress)
      setLink('')
      const extra = res.skipped ? ` (${res.skipped} ficaram de fora: o limite é ${MAX_PLAYLIST_TRACKS})` : ''
      showToast(`"${res.name}" importada com ${res.added} ${res.added === 1 ? 'música' : 'músicas'}${extra}.`, 'ok', 4000)
      onImported?.(res.id)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível importar.', 'error')
    } finally {
      setProgress(null)
    }
  }

  return (
    <form className="inline-field pl-import" onSubmit={submit}>
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="Link de playlist do YouTube ou YouTube Music"
        aria-label="Link de playlist do YouTube ou YouTube Music"
        disabled={!!progress}
      />
      <button type="submit" className="btn btn-secondary" disabled={!!progress || !link.trim()}>
        {progress ?? 'Importar'}
      </button>
    </form>
  )
}
