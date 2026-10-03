import { useEffect, useMemo, useState } from 'react'
import { AddTrack } from '../../components/AddTrack/AddTrack'
import { Controls } from '../../components/Controls/Controls'
import { IdleNotice } from '../../components/IdleNotice/IdleNotice'
import { ProfileOverlay } from '../../components/ProfileOverlay/ProfileOverlay'
import { Participants } from '../../components/Participants/Participants'
import { RoomPlaylists } from '../../components/Playlists/RoomPlaylists'
import { PlayerPanel } from '../../components/Player/PlayerPanel'
import { Queue } from '../../components/Queue/Queue'
import { RoomHeader } from '../../components/RoomHeader/RoomHeader'
import { RoomSettingsPanel } from '../../components/RoomSettings/RoomSettings'
import { Suggestions } from '../../components/Suggestions/Suggestions'
import { UserChip } from '../../components/Invites/UserChip'
import { Brand } from '../../components/ui/Brand'
import { Toasts } from '../../components/ui/Toasts'
import { UserPanel } from '../../components/UserPanel/UserPanel'
import { appPath, START_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { takeAutoJoin } from '../../services/externalAdd'
import { roomExists } from '../../services/firebase/roomsApi'
import { RoomSession } from '../../services/roomSession'
import { RoomSessionContext } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { resetRoomStore, roomStore } from '../../stores/roomStore'
import { storage } from '../../utils/storage'
import { JoinGate } from './JoinGate'

type Phase =
  | { kind: 'checking' }
  | { kind: 'missing'; message: string }
  | { kind: 'gate' }
  | { kind: 'joined'; roomKey: string; name: string }

export function Room({ roomId }: { roomId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const fatal = useStore(roomStore, (s) => s.fatalError)
  const removed = useStore(roomStore, (s) => s.removedReason)

  useEffect(() => {
    let alive = true
    roomExists(roomId)
      .then((exists) => {
        if (!alive) return
        if (!exists) return setPhase({ kind: 'missing', message: 'A sala não existe mais.' })
        // Chave já conhecida (perfil, convite aceito ou extensão): entra direto.
        const key = storage.getRoomKey(roomId)
        const profile = authStore.get().profile
        if (key && (profile || takeAutoJoin(roomId))) {
          const name = profile?.name || storage.getName().trim()
          if (name) return setPhase({ kind: 'joined', roomKey: key, name })
        }
        setPhase({ kind: 'gate' })
      })
      .catch((err: Error) => alive && setPhase({ kind: 'missing', message: err.message }))
    return () => {
      alive = false
    }
  }, [roomId])

  // Removido ou bloqueado pelo dono (ou sala só para Discord).
  useEffect(() => {
    if (phase.kind === 'joined' && removed) {
      setPhase({ kind: 'missing', message: removed })
      roomStore.set({ removedReason: null })
    }
  }, [removed, phase.kind])

  // Sala apagada (ou chave salva inválida) durante a sessão.
  useEffect(() => {
    if (phase.kind !== 'joined' || !fatal) return
    if (fatal === 'A sala não existe mais.') {
      storage.clearRoomKey(roomId)
      void import('../../services/firebase/social').then((m) => m.forgetMyRoom(roomId)).catch(() => {})
      setPhase({ kind: 'missing', message: fatal })
    }
  }, [fatal, phase.kind, roomId])

  if (phase.kind === 'joined') {
    return <RoomView roomId={roomId} roomKey={phase.roomKey} name={phase.name} />
  }

  return (
    <div className="home">
      <header className="topbar">
        <Brand />
        <UserChip />
      </header>
      <main className="gate-main">
        {phase.kind === 'checking' && <div className="panel gate skeleton-panel" aria-busy="true" />}
        {phase.kind === 'missing' && (
          <div className="panel gate">
            <h2>{phase.message}</h2>
            <p className="hint">Fale com quem criou a sala ou crie uma nova.</p>
            <a className="btn btn-primary" href={appPath(START_PATH)}>
              Criar uma sala
            </a>
          </div>
        )}
        {phase.kind === 'gate' && (
          <JoinGate
            roomId={roomId}
            needsPassword={!storage.getRoomKey(roomId)}
            notice={fatal}
            onJoined={(roomKey, name) => {
              roomStore.set({ fatalError: null })
              setPhase({ kind: 'joined', roomKey, name })
            }}
          />
        )}
      </main>
    </div>
  )
}

function RoomView({ roomId, roomKey, name }: { roomId: string; roomKey: string; name: string }) {
  const session = useMemo(
    () => new RoomSession(roomId, roomKey, name, authStore.get().profile?.avatarUrl ?? null),
    [roomId, roomKey, name],
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
          <aside className="room-left" aria-label="Fila e sugestões">
            <Queue />
            <Suggestions />
            <UserPanel />
          </aside>
          <div className="room-main">
            <FatalBanner />
            <PlayerPanel />
            <Controls />
            <AddTrack />
          </div>
          <aside className="room-right" aria-label="Participantes e playlists">
            <Participants />
            <RoomPlaylists />
          </aside>
        </main>
        <Toasts />
        <RoomSettingsPanel />
        <ProfileOverlay />
        <IdleNotice />
      </div>
    </RoomSessionContext.Provider>
  )
}

function FatalBanner() {
  const fatal = useStore(roomStore, (s) => s.fatalError)
  if (!fatal) return null
  return (
    <div className="room-banner" role="alert">
      {fatal}
    </div>
  )
}
