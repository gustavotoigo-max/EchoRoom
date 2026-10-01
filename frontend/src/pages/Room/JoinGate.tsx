import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../../services/api'
import { storage } from '../../utils/storage'

interface Props {
  roomId: string
  needsPassword: boolean
  notice?: string | null
  onJoined: (token: string, name: string) => void
}

/**
 * Tela de entrada. O clique em "Entrar e começar a ouvir" também é a
 * interação do usuário que libera o autoplay do navegador.
 */
export function JoinGate({ roomId, needsPassword, notice, onJoined }: Props) {
  const [name, setName] = useState(storage.getName())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(notice ?? null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Digite seu nome.')
    setBusy(true)
    setError(null)
    try {
      let token = storage.getRoomToken(roomId)
      if (needsPassword || !token) {
        if (!password) {
          setBusy(false)
          return setError('Digite a senha da sala.')
        }
        token = (await api.joinRoom(roomId, password)).token
        storage.setRoomToken(roomId, token)
      }
      storage.setName(trimmed)
      onJoined(token, trimmed)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível entrar na sala.')
      setBusy(false)
    }
  }

  return (
    <form className="panel gate" onSubmit={submit} noValidate>
      <h2>
        Sala <span className="mono-code">{roomId}</span>
      </h2>
      <label className="field">
        <span>Seu nome</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          autoFocus={!name}
          autoComplete="nickname"
        />
      </label>
      {needsPassword && (
        <label className="field">
          <span>Senha da sala</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!!name}
            autoComplete="current-password"
          />
        </label>
      )}
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Entrando…' : 'Entrar e começar a ouvir'}
      </button>
    </form>
  )
}
