import { useState, type FormEvent } from 'react'
import { Brand } from '../../components/ui/Brand'
import { CopyButton } from '../../components/ui/CopyButton'
import { navigate } from '../../router'
import { createRoom, MIN_PASSWORD } from '../../services/firebase/roomsApi'
import { parseRoomInput, roomLink } from '../../utils/format'
import { storage } from '../../utils/storage'

export function Home() {
  const [name, setName] = useState(storage.getName())
  const [password, setPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setCreateError('Digite seu nome.')
    if (password.length < MIN_PASSWORD) return setCreateError(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`)
    setCreating(true)
    setCreateError(null)
    try {
      const res = await createRoom(password)
      storage.setName(name)
      storage.setRoomKey(res.roomId, res.roomKey)
      setCreated(res.roomId)
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  function join(e: FormEvent) {
    e.preventDefault()
    const id = parseRoomInput(code)
    if (!id) return setJoinError('Cole o link da sala ou digite o código de 5 caracteres.')
    if (name.trim()) storage.setName(name)
    navigate(`/room/${id}`)
  }

  return (
    <div className="home">
      <header className="topbar">
        <Brand />
      </header>

      <main className="home-main">
        <section className="home-intro">
          <h1>Ouçam juntos, no mesmo segundo.</h1>
          <p>
            Crie uma sala, mande o link no Discord e cada pessoa toca o YouTube no próprio navegador — com play,
            pausa e fila compartilhados.
          </p>
          <div className="echo-lines" aria-hidden="true">
            <span style={{ ['--w' as string]: '62%' }} />
            <span style={{ ['--w' as string]: '62%' }} />
            <span style={{ ['--w' as string]: '62%' }} />
            <i />
          </div>
        </section>

        <section className="home-panels">
          {created ? (
            <div className="panel created" aria-live="polite">
              <h2>Sala criada</h2>
              <div className="room-code" aria-label={`Código da sala ${created}`}>
                {created}
              </div>
              <label className="field">
                <span>Link da sala</span>
                <input readOnly value={roomLink(created)} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <p className="hint">Envie o link e a senha para quem vai ouvir com você.</p>
              <div className="row">
                <CopyButton text={roomLink(created)} />
                <button type="button" className="btn btn-primary grow" onClick={() => navigate(`/room/${created}`)}>
                  Entrar na sala
                </button>
              </div>
            </div>
          ) : (
            <form className="panel" onSubmit={create} noValidate>
              <h2>Criar sala</h2>
              <label className="field">
                <span>Seu nome</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={32}
                  autoComplete="nickname"
                  placeholder="Como os outros vão te ver"
                />
              </label>
              <label className="field">
                <span>Senha da sala</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={`Mínimo de ${MIN_PASSWORD} caracteres`}
                />
              </label>
              {createError && <p className="form-error">{createError}</p>}
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? 'Criando sala…' : 'Criar sala'}
              </button>
            </form>
          )}

          <form className="panel panel-quiet" onSubmit={join} noValidate>
            <h2>Entrar em uma sala</h2>
            <div className="inline-field">
              <label className="field grow">
                <span>Código ou link</span>
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setJoinError(null)
                  }}
                  placeholder="ABX72 ou link da sala"
                  autoCapitalize="characters"
                />
              </label>
              <button type="submit" className="btn btn-secondary">
                Entrar
              </button>
            </div>
            {joinError && <p className="form-error">{joinError}</p>}
          </form>
        </section>
      </main>
    </div>
  )
}
