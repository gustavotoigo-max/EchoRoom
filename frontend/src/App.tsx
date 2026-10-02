import { Brand } from './components/ui/Brand'
import { firebaseConfig } from './config/firebase'
import { Home } from './pages/Home/Home'
import { Landing } from './pages/Landing/Landing'
import { Room } from './pages/Room/Room'
import { isStartPath, matchRoom, usePathname } from './router'

export function App() {
  const path = usePathname()
  if (!firebaseConfig) return <SetupNeeded />
  const roomId = matchRoom(path)
  if (roomId) return <Room key={roomId} roomId={roomId} />
  return isStartPath(path) ? <Home /> : <Landing />
}

/** Mostrado quando o site foi publicado sem a configuração do Firebase. */
function SetupNeeded() {
  return (
    <div className="home">
      <header className="topbar">
        <Brand />
      </header>
      <main className="setup">
        <h1>Falta conectar o Firebase</h1>
        <p>
          Este site foi publicado sem a configuração do Firebase. No GitHub, abra o repositório →{' '}
          <code>Settings → Secrets and variables → Actions → Variables</code>, crie a variável{' '}
          <code>FIREBASE_CONFIG</code> com o objeto de configuração do app web do Firebase e rode o deploy de novo
          (aba <code>Actions</code> → <code>Deploy GitHub Pages</code> → <code>Run workflow</code>).
        </p>
      </main>
    </div>
  )
}
