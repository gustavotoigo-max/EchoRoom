import { UserChip } from '../../components/Invites/UserChip'
import { Brand } from '../../components/ui/Brand'
import { Equalizer } from '../../components/ui/Equalizer'
import { DiscordIcon, PlayIcon } from '../../components/ui/Icons'
import { appPath, navigate, START_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { useStore } from '../../stores/createStore'
import '../../styles/landing.css'

const start = (e?: { preventDefault: () => void }) => {
  e?.preventDefault()
  navigate(START_PATH)
}

/** Página de apresentação (inspirada no site do Parsec, com menos seções). */
export function Landing() {
  const profile = useStore(authStore, (s) => s.profile)

  return (
    <div className="landing">
      <header className="topbar lp-topbar">
        <Brand />
        <nav className="topnav">
          <a href="#como-funciona">Como funciona</a>
          <a href="#recursos">Recursos</a>
          <a href={appPath(`${START_PATH}#extensao`)}>Extensão</a>
        </nav>
        <UserChip compact />
        <a className="btn btn-primary lp-open" href={appPath(START_PATH)} onClick={start}>
          {profile ? <img className="avatar" src={profile.avatarUrl} alt="" width={22} height={22} /> : null}
          <span>Abrir o EchoRoom</span>
        </a>
      </header>

      {/* 1. Topo */}
      <section className="lp-hero">
        <div className="lp-glow" aria-hidden="true" />
        <span className="eyebrow">
          <Equalizer on />
          Feito para a sua call do Discord
        </span>
        <h1>
          A mesma música,
          <br />
          <em>no mesmo segundo.</em>
        </h1>
        <p className="lp-lead">
          Salas para ouvir YouTube com os amigos. Cada um toca no próprio navegador, e o EchoRoom mantém todo mundo
          sincronizado: play, pausa, fila e pulos valem para a sala inteira.
        </p>
        <div className="lp-cta">
          <a className="btn btn-primary btn-lg" href={appPath(START_PATH)} onClick={start}>
            Criar uma sala
          </a>
          <a className="btn btn-secondary btn-lg" href={appPath(START_PATH)} onClick={start}>
            Tenho um código
          </a>
        </div>
        <p className="lp-note">
          <DiscordIcon width={16} height={16} /> Entre com o Discord (só nome e avatar) ou como convidado.
        </p>

        <RoomMock />
      </section>

      {/* 2. Como funciona */}
      <section className="lp-section" id="como-funciona">
        <header className="lp-head">
          <span className="lp-kicker">Como funciona</span>
          <h2>Da call para a sala em três passos.</h2>
        </header>
        <ol className="lp-steps">
          <li>
            <b>01</b>
            <strong>Crie a sala</strong>
            <span>Escolha uma senha e pronto: o EchoRoom gera um código e um link para a sala.</span>
          </li>
          <li>
            <b>02</b>
            <strong>Mande no Discord</strong>
            <span>Cole o link no canal. Quem entrar com Discord aparece com o próprio nome e avatar.</span>
          </li>
          <li>
            <b>03</b>
            <strong>Ouçam juntos</strong>
            <span>Qualquer um adiciona músicas e playlists. Play, pausa e pulos chegam para todos ao mesmo tempo.</span>
          </li>
        </ol>
      </section>

      {/* 3. Recursos */}
      <section className="lp-section" id="recursos">
        <header className="lp-head">
          <span className="lp-kicker">Recursos</span>
          <h2>Leve como um link, preciso como um metrônomo.</h2>
        </header>
        <div className="lp-features">
          <article className="lp-feature lp-feature-wide">
            <div>
              <h3>Sincronia de verdade</h3>
              <p>
                Os comandos são agendados pelo relógio do servidor e cada navegador corrige sozinho pequenos atrasos,
                sem cortes no som. Quem entra no meio começa do ponto certo.
              </p>
            </div>
            <div className="lp-sync" aria-hidden="true">
              {['#8b5cff', '#4c8dff', '#2fe0c4'].map((c) => (
                <span key={c} style={{ ['--c' as string]: c }} />
              ))}
              <i />
            </div>
          </article>
          <article className="lp-feature">
            <h3>Com a cara do Discord</h3>
            <p>Login com Discord pedindo só nome e avatar. Nada de ler mensagens ou servidores.</p>
          </article>
          <article className="lp-feature">
            <h3>Extensão para Chrome</h3>
            <p>Um botão no YouTube manda a música que você está vendo direto para a sua sala.</p>
            <a href={appPath(`${START_PATH}#extensao`)}>Como instalar →</a>
          </article>
          <article className="lp-feature">
            <h3>Fila e sugestões do grupo</h3>
            <p>Vídeos e playlists inteiras na fila; o que a galera já ouviu vira sugestão com um clique.</p>
          </article>
          <article className="lp-feature">
            <h3>Leve para o computador</h3>
            <p>Esconda o vídeo e o YouTube manda uma resolução mínima. Volume individual para cada um.</p>
          </article>
        </div>
      </section>

      {/* 4. Chamada final */}
      <section className="lp-final">
        <h2>Chame a galera.</h2>
        <p>Criar uma sala leva dez segundos.</p>
        <a className="btn btn-primary btn-lg" href={appPath(START_PATH)} onClick={start}>
          <PlayIcon width={18} height={18} />
          <span>Criar uma sala</span>
        </a>
      </section>

      <footer className="lp-footer">
        <Brand />
        <span>Não é afiliado ao YouTube nem ao Discord.</span>
      </footer>
    </div>
  )
}

/** Prévia da sala desenhada em HTML (nada de imagem pesada). */
function RoomMock() {
  const queue = [
    { t: 'Noite de sexta', a: 'Gus', c: 'linear-gradient(135deg,#8b5cff,#4c8dff)' },
    { t: 'Synthwave para dirigir', a: 'João', c: 'linear-gradient(135deg,#ff5c7a,#8b5cff)' },
    { t: 'Lo-fi para codar', a: 'Pedro', c: 'linear-gradient(135deg,#2fe0c4,#4c8dff)' },
  ]
  const people = [
    { n: 'Gus', c: '#8b5cff' },
    { n: 'João', c: '#4c8dff' },
    { n: 'Pedro', c: '#2fe0c4' },
    { n: 'Ana', c: '#ff5c7a' },
  ]
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-bar">
        <span className="mock-room">
          <i />
          Sala <b>K4TRH</b>
        </span>
        <span className="mock-status">Sincronizado</span>
        <span className="mock-invite">Convidar</span>
      </div>
      <div className="mock-grid">
        <div className="mock-left">
          <small>A seguir — 3</small>
          {queue.map((q) => (
            <div className="mock-q" key={q.t}>
              <span style={{ background: q.c }} />
              <div>
                <b>{q.t}</b>
                <em>{q.a}</em>
              </div>
            </div>
          ))}
        </div>
        <div className="mock-main">
          <div className="mock-video">
            <div className="mock-art" />
          </div>
          <div className="mock-np">
            <small>
              <Equalizer on /> Tocando agora para a sala
            </small>
            <b>Luzes da cidade</b>
            <div className="mock-progress">
              <span />
            </div>
          </div>
        </div>
        <div className="mock-right">
          <small>Ouvindo — 4</small>
          {people.map((p) => (
            <div className="mock-p" key={p.n}>
              <span style={{ background: p.c }}>{p.n[0]}</span>
              <b>{p.n}</b>
              <Equalizer on />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
