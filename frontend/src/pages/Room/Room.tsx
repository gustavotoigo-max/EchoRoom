import { useEffect, useMemo, useState } from 'react'
import { AddTrack } from '../../components/AddTrack/AddTrack'
import { Controls } from '../../components/Controls/Controls'
import { Participants } from '../../components/Participants/Participants'
import { PlayerPanel } from '../../components/Player/PlayerPanel'
import { Queue } from '../../components/Queue/Queue'
import { RoomHeader } from '../../components/RoomHeader/RoomHeader'
import { Brand } from '../../components/ui/Brand'
import { api, ApiError } from '../../services/api'
import { RoomSession } from '../../services/roomSession'
import { RoomSessionContext } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { resetRoomStore, roomStore } from '../../stores/roomStore'
import { storage } from '../../utils/storage'
import { JoinGate } from './JoinGate'

type Phase = { kind: 'checking' } | { kind: 'missing'; message: string } | { kind: 'gate' } | { kind: 'joined'; token: string; name: string }

export function Room({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const fatal = useStore(roomStore, (s) => s.fatalError)

  useEffect(() => {
    let alive = true
    api
      .getRoom(roomId)
      .then(() => alive && setPhase({ kind: 'gate' }))
      .catch((err) => {
        if (!alive) return
        const msg = err instanceof ApiError && err.status === 404 ? 'A sala não existe mais.' : (err as Error).message
        setPhase({ kind: 'missing', message: msg })
      })
    return () => {
      alive = false
    }
  }, [roomId])

  // Token inválido durante a sessão: volta para a tela de senha.
  useEffect(() => {
    if (phase.kind !== 'joined' || !fatal) return
    if (fatal === 'A sala não existe mais.') setPhase({ kind: 'missing', message: fatal })
    else setPhase({ kind: 'gate' })
  }, [fatal, phase.kind])

  if (phase.kind === 'joined') {
    return <RoomView roomId={roomId} token={phase.token} name={phase.name} />
  }

  return (
    <div className="home">
      <header className="topbar">
        <Brand />
      </header>
      <main className="gate-main">
        {phase.kind === 'checking' && <div className="panel gate skeleton-panel" aria-busy="true" />}
        {phase.kind === 'missing' && (
          <div className="panel gate">
            <h2>{phase.message}</h2>
            <p className="hint">Confira o link com quem criou a sala ou crie uma nova.</p>
            <a className="btn btn-primary" href="/">
              Criar uma sala
            </a>
          </div>
        )}
        {phase.kind === 'gate' && (
          <JoinGate
            roomId={roomId}
            needsPassword={!storage.getRoomToken(roomId)}
            notice={fatal}
            onJoined={(token, name) => {
              roomStore.set({ fatalError: null })
              setPhase({ kind: 'joined', token, name })
            }}
          />
        )}
      </main>
    </div>
  )
}

function RoomView({ roomId, token, name }: { roomId: string; token: string; name: string }) {
  const session = useMemo(
    () => new RoomSession(roomId, token, name, storage.getParticipantId()),
    [roomId, token, name],
  )

  useEffect(() => {
    session.start()
    return () => {
      session.stop()
      resetRoomStore()
    }
  }, [session])

  return (
    <RoomSessionContext.Provider value={session}>
      <div className="room">
        <RoomHeader roomId={roomId} />
        <main className="room-grid">
          <div className="room-main">
            <PlayerPanel />
            <Controls />
            <AddTrack />
          </div>
          <aside className="room-side">
            <Participants />
            <Queue />
          </aside>
        </main>
      </div>
    </RoomSessionContext.Provider>
  )
}
