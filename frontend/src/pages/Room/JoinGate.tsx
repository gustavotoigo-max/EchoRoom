import { useState, type FormEvent } from 'react'
import { currentIdentity, IdentityField } from '../../components/ui/IdentityField'
import { joinRoom } from '../../services/firebase/roomsApi'
import { storage } from '../../utils/storage'

interface Props {
  roomId: string
  needsPassword: boolean
  notice?: string | null
  onJoined: (roomKey: string, name: string) => void
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
    const trimmed = currentIdentity(name).name
    if (!trimmed) return setError('Entre com Discord ou digite um nome.')
    setBusy(true)
    setError(null)
    try {
      let key = storage.getRoomKey(roomId)
      if (needsPassword || !key) {
        if (!password) {
          setBusy(false)
          return setError('Digite a senha da sala.')
        }
        key = (await joinRoom(roomId, password)).roomKey
        storage.setRoomKey(roomId, key)
      }
      if (name.trim()) storage.setName(name)
      onJoined(key, trimmed)
    } catch (err) {
      setError((err as Error).message || 'Não foi possível entrar na sala.')
      setBusy(false)
    }
  }

  return (
    <form className="panel gate" onSubmit={submit} noValidate>
      <h2>
        Sala <span className="mono-code">{roomId}</span>
      </h2>
      <IdentityField guestName={name} onGuestName={setName} autoFocus={!name} />
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
