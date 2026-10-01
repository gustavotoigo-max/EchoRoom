import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRoomSession } from '../../services/RoomSessionContext'
import { extractVideoId } from '../../utils/youtubeUrlParser'
import { PlusIcon } from '../ui/Icons'

type Feedback = { kind: 'busy' | 'ok' | 'error'; text: string } | null

/**
 * Campo de adicionar música. Hoje aceita URL; a mesma caixa pode virar
 * "pesquisar ou colar URL" sem mudar o resto da tela.
 */
export function AddTrack() {
  const session = useRoomSession()
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<Feedback>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const url = value.trim()
    if (!url) return
    if (!extractVideoId(url)) {
      setFeedback({ kind: 'error', text: 'Esse link não é de um vídeo do YouTube.' })
      return
    }
    setFeedback({ kind: 'busy', text: 'Adicionando…' })
    try {
      await session.addTrack(url)
      setValue('')
      setFeedback({ kind: 'ok', text: 'Adicionada à fila' })
    } catch (err) {
      setFeedback({ kind: 'error', text: (err as Error).message || 'Não foi possível adicionar.' })
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback((f) => (f?.kind === 'ok' ? null : f)), 2200)
  }

  return (
    <form className="add-track" onSubmit={submit}>
      <label htmlFor="add-track-input">Adicionar música</label>
      <div className="add-track-row">
        <input
          id="add-track-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (feedback?.kind === 'error') setFeedback(null)
          }}
          placeholder="Cole um link do YouTube"
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
      </p>
    </form>
  )
}
