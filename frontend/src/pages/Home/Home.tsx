import { useState, type FormEvent } from 'react'
import { Brand } from '../../components/ui/Brand'
import { CopyButton } from '../../components/ui/CopyButton'
import { ThemePicker } from '../../components/ui/ThemePicker'
import { appPath, navigate } from '../../router'
import { clearPendingAdd, pendingStore } from '../../services/externalAdd'
import { useStore } from '../../stores/createStore'
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
  const pending = useStore(pendingStore, (s) => s.pending)

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
        <ThemePicker />
      </header>

      {pending && (
        <div className="pending-banner" role="status">
          Pronta para tocar: {pending.title ? `"${pending.title}"` : 'música enviada pela extensão'}
          <small>
            Crie uma sala ou entre em uma — ela entra na fila automaticamente.{' '}
            <button type="button" className="link-btn" onClick={clearPendingAdd}>
              Descartar
            </button>
          </small>
        </div>
      )}

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
          <p className="home-extension">
            Ouvindo no YouTube? <a href="#extensao">Instale a extensão para Chrome</a> e mande a música para a sua sala
            com um clique.
          </p>
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

      <ExtensionGuide />
    </div>
  )
}

/** Passo a passo de instalação da extensão (não está na Chrome Web Store). */
function ExtensionGuide() {
  return (
    <section className="ext-guide" id="extensao" aria-labelledby="ext-title">
      <div className="ext-head">
        <div>
          <h2 id="ext-title">Extensão para Chrome</h2>
          <p>
            Coloca um botão <strong>Tocar no EchoRoom</strong> nos vídeos e playlists do YouTube. Um clique pausa o
            YouTube, abre o EchoRoom e já coloca a música na última sala em que você entrou.
          </p>
        </div>
        <a className="btn btn-primary" href={appPath('echoroom-chrome.zip')} download>
          Baixar extensão (.zip)
        </a>
      </div>

      <ol className="ext-steps">
        <li>
          <strong>Baixe e descompacte</strong>
          <span>
            Clique em “Baixar extensão”. No arquivo baixado, clique com o botão direito → <em>Extrair tudo</em>. Guarde
            a pasta num lugar fixo: o Chrome usa ela enquanto a extensão estiver instalada.
          </span>
        </li>
        <li>
          <strong>Abra as extensões do Chrome</strong>
          <span>
            Cole na barra de endereços e aperte Enter:
            <span className="ext-copy">
              <code>chrome://extensions</code>
              <CopyButton text="chrome://extensions" label="Copiar" doneLabel="Copiado" />
            </span>
          </span>
        </li>
        <li>
          <strong>Ligue o modo do desenvolvedor</strong>
          <span>
            A chave <em>Modo do desenvolvedor</em> fica no canto superior direito da página de extensões.
          </span>
        </li>
        <li>
          <strong>Carregue a pasta</strong>
          <span>
            Clique em <em>Carregar sem compactação</em> e escolha a pasta que você descompactou (a que contém o arquivo{' '}
            <code>manifest.json</code>).
          </span>
        </li>
        <li>
          <strong>Use no YouTube</strong>
          <span>
            Abra um vídeo ou playlist: o botão aparece no canto direito da tela. Dá para arrastar pela alça ⋮⋮ ou
            esconder pelo ×. Entre numa sala do EchoRoom pelo menos uma vez para a extensão saber para onde mandar.
          </span>
        </li>
      </ol>

      <p className="ext-note">
        Para atualizar: baixe o zip de novo, substitua os arquivos da pasta e clique em ↻ no card da extensão em{' '}
        <code>chrome://extensions</code>. Funciona também no Edge, Brave e Opera (página de extensões de cada um).
      </p>
    </section>
  )
}
