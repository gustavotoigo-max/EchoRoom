import { Home } from './pages/Home/Home'
import { Room } from './pages/Room/Room'
import { matchRoom, usePathname } from './router'

export function App() {
  const path = usePathname()
  const roomId = matchRoom(path)
  return roomId ? <Room key={roomId} roomId={roomId} /> : <Home />
}
