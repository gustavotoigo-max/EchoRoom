import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'

export function Participants() {
  const participants = useStore(roomStore, (s) => s.room?.participants ?? null)
  const me = useStore(roomStore, (s) => s.participantId)
  const online = participants?.filter((p) => p.connected).length ?? 0

  return (
    <section className="side-block participants" aria-label="Participantes">
      <header className="side-head">
        <h3>Participantes</h3>
        <span className="count">{participants ? online : ''}</span>
      </header>
      <ul>
        {participants === null
          ? [0, 1].map((i) => (
              <li key={i}>
                <div className="skeleton skeleton-line" />
              </li>
            ))
          : participants.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'is-away'}>
                <i className="presence" aria-hidden="true" />
                <span className="p-name">{p.name}</span>
                {p.id === me && <span className="p-tag">você</span>}
                {!p.connected && <span className="p-tag">reconectando</span>}
              </li>
            ))}
      </ul>
    </section>
  )
}
