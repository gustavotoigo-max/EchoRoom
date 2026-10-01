import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { parseYouTubeLink } from '../../utils/youtubeUrlParser'
import { PlusIcon } from '../ui/Icons'

type Feedback =
  | { kind: 'busy' | 'ok' | 'error'; text: string; offerPlaylist?: string }
  | null

/**
 * Campo de adicionar música. Aceita link de vídeo, shorts ou playlist.
 * Um link de vídeo que veio de dentro de uma playlist (watch?v=…&list=…)
 * adiciona só o vídeo e oferece "adicionar a playlist inteira".
 */
export function AddTrack() {
  const session = useRoomSession()
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  function clearLater(ms: number) {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback((f) => (f?.kind === 'ok' ? null : f)), ms)
  }

  async function add(url: string, wholePlaylist = false) {
    setFeedback({ kind: 'busy', text: wholePlaylist ? 'Lendo a playlist…' : 'Adicionando…' })
    try {
      const res = await session.addTrack(url, {
        wholePlaylist,
        onProgress: (text) => setFeedback({ kind: 'busy', text }),
      })
      setValue('')
      const link = parseYouTubeLink(url)
      if (res.added > 1 || wholePlaylist || link.kind === 'playlist') {
        const extra = res.skipped ? ` (${res.skipped} ficaram de fora: limite da fila)` : ''
        setFeedback({ kind: 'ok', text: `${res.added} músicas da playlist adicionadas${extra}` })
        clearLater(5000)
      } else if (link.kind === 'video' && link.playlistId) {
        setFeedback({ kind: 'ok', text: 'Adicionada à fila.', offerPlaylist: url })
        clearLater(9000)
      } else {
        setFeedback({ kind: 'ok', text: 'Adicionada à fila' })
        clearLater(2200)
      }
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message || 'Não foi possível adicionar.' })
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const url = value.trim()
    if (!url) return
    if (parseYouTubeLink(url).kind === 'invalid') {
      setFeedback({ kind: 'error', text: 'Esse link não é de um vídeo nem de uma playlist do YouTube.' })
      return
    }
    void add(url)
  }

  return (
    <form className="add-track" onSubmit={submit}>
      <label htmlFor="add-track-input">Adicionar música ou playlist</label>
      <div className="add-track-row">
        <input
          id="add-track-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (feedback?.kind === 'error') setFeedback(null)
          }}
          placeholder="Cole um link de vídeo ou playlist do YouTube"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={feedback?.kind === 'busy' || !value.trim()}>
          <PlusIcon width={16} height={16} />
          <span>Adicionar</span>
        </button>
      </div>
      <p className={`add-feedback is-${feedback?.kind ?? 'none'}`} aria-live="polite">
        {feedback?.text ?? ''}
        {feedback?.offerPlaylist && (
          <button type="button" className="link-btn" onClick={() => add(feedback.offerPlaylist!, true)}>
            Adicionar a playlist inteira
          </button>
        )}
      </p>
    </form>
  )
}
