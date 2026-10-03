import { useEffect, useRef } from 'react'
import { PresenceConfig } from '../../services/firebase/FirebaseRoomBackend'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { PauseIcon } from '../ui/Icons'

const idleMinutes = Math.round(PresenceConfig.idleMs / 60_000)
const idleText = idleMinutes % 60 === 0 ? `${idleMinutes / 60} hora${idleMinutes > 60 ? 's' : ''}` : `${idleMinutes} minutos`

/** Aviso de pausa por inatividade: ninguém mexeu na sala e a lista foi liberada. */
export function IdleNotice() {
  const session = useRoomSession()
  const idle = useStore(roomStore, (s) => s.idle)
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (idle) btn.current?.focus()
  }, [idle])

  if (!idle) return null
  return (
    <div className="idle-overlay" role="alertdialog" aria-modal="true" aria-labelledby="idle-title" aria-describedby="idle-text">
      <div className="idle-card">
        <span className="idle-icon" aria-hidden="true">
          <PauseIcon width={22} height={22} />
        </span>
        <h2 id="idle-title">Sala pausada por inatividade</h2>
        <p id="idle-text">
          Ninguém interagiu com a sala por {idleText}. A música foi pausada e você saiu da lista de quem está ouvindo.
        </p>
        <button ref={btn} type="button" className="btn btn-primary" onClick={session.resumeFromIdle}>
          Voltar à sala
        </button>
      </div>
    </div>
  )
}
