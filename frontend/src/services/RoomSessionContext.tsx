import { createContext, useContext } from 'react'
import type { RoomSession } from './roomSession'

export const RoomSessionContext = createContext<RoomSession | null>(null)

export function useRoomSession(): RoomSession {
  const s = useContext(RoomSessionContext)
  if (!s) throw new Error('useRoomSession fora de RoomSessionContext')
  return s
}
