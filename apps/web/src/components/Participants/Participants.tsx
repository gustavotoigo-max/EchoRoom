import { useEffect, useRef, useState } from 'react'
import { banParticipant, kickParticipant } from '../../services/firebase/roomsApi'
import { useRoomSession } from '../../services/RoomSessionContext'
import type { Participant } from '../../types/room'
import { timeAgo } from '../../utils/format'
import { useStore } from '../../stores/createStore'
import { roomStore, selectIsOwner } from '../../stores/roomStore'
import { showToast } from '../../stores/toastStore'
import { Equalizer } from '../ui/Equalizer'
import { CrownIcon, MoreIcon } from '../ui/Icons'

/**
 * Convidados: todo mundo que já entrou na sala. Quem está aqui agora vem
 * primeiro; quem saiu continua na lista, com a foto apagada.
 */
export function Participants() {
  const participants = useStore(roomStore, (s) => s.room?.participants ?? null)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')

  if (participants === null) {
    return (
      <section className="side-block participants" aria-label="Convidados">
        <header className="side-head">
          <h3>Convidados</h3>
        </header>
        <ul>
          {[0, 1].map((i) => (
            <li key={i}>
              <div className="skeleton skeleton-line" />
            </li>
          ))}
        </ul>
      </section>
    )
  }

  const online = participants.filter((p) => p.connected).length

  return (
    <section className="side-block participants" aria-label="Convidados">
      <header className="side-head">
        <h3>Convidados</h3>
        <span className="count">{participants.length}</span>
        <span className="p-online" title={`${online} na sala agora`}>
          <i aria-hidden="true" />
          {online} online
        </span>
      </header>
      <ul>
        {participants.map((p) => (
          <Row key={p.id} p={p} playing={playing} />
        ))}
      </ul>
    </section>
  )
}

function Row({ p, playing }: { p: Participant; playing: boolean }) {
  const session = useRoomSession()
  const me = useStore(roomStore, (s) => s.participantId)
  const ownerUid = useStore(roomStore, (s) => s.meta?.ownerUid ?? null)
  const iAmOwner = useStore(roomStore, selectIsOwner)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const isMe = p.id === me
  const isOwner = p.id === ownerUid
  const canModerate = iAmOwner && !isMe

  async function act(kind: 'kick' | 'ban') {
    setOpen(false)
    try {
      if (kind === 'kick') await kickParticipant(session.backend.roomKey, p.id)
      else await banParticipant(session.backend.roomKey, p.id, p.name)
      showToast(kind === 'kick' ? (p.connected ? `${p.name} foi removido da sala.` : `${p.name} saiu da lista de convidados.`) : `${p.name} foi bloqueado.`, 'info', 3000)
    } catch {
      showToast('Não foi possível. Só o dono pode fazer isso.', 'error')
    }
  }

  return (
    <li ref={ref} className={`${p.connected ? '' : 'is-away'} ${canModerate ? 'can-mod' : ''}`}>
      <span className="p-avatar" aria-hidden="true">
        {p.avatar ? (
          <img src={p.avatar} alt="" width={32} height={32} loading="lazy" />
        ) : (
          <b>{p.name.trim().charAt(0).toUpperCase() || '?'}</b>
        )}
        <i className="presence" />
      </span>
      <span className="p-who">
        <span className="p-name">
          {p.name}
          {isOwner && (
            <span className="p-crown" title="Dono da sala" aria-label="dono da sala">
              <CrownIcon width={12} height={12} />
            </span>
          )}
        </span>
        {!p.connected && <small className="p-seen">{p.lastSeen ? `Visto ${timeAgo(p.lastSeen)}` : 'Offline'}</small>}
      </span>
      {isMe ? <span className="p-tag">você</span> : p.guest ? <span className="p-tag p-guest" title="Entrou sem Discord">visitante</span> : null}
      {p.connected && <Equalizer on={playing} />}
      {canModerate && (
        <>
          <button
            type="button"
            className="icon-btn q-more p-more"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Opções para ${p.name}`}
            onClick={() => setOpen((o) => !o)}
          >
            <MoreIcon width={16} height={16} />
          </button>
          {open && (
            <div className="menu" role="menu">
              <button role="menuitem" type="button" onClick={() => act('kick')}>
                {p.connected ? 'Remover da sala' : 'Tirar da lista'}
              </button>
              <button role="menuitem" type="button" className="danger" onClick={() => act('ban')}>
                Bloquear
              </button>
            </div>
          )}
        </>
      )}
    </li>
  )
}
