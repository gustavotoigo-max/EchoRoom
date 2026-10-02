import type { Participant } from '../../types/room'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { Equalizer } from '../ui/Equalizer'

/** Lista de membros no estilo do Discord: agrupada por "ouvindo" e "reconectando". */
export function Participants() {
  const participants = useStore(roomStore, (s) => s.room?.participants ?? null)
  const me = useStore(roomStore, (s) => s.participantId)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')

  if (participants === null) {
    return (
      <section className="side-block participants" aria-label="Participantes">
        <header className="side-head">
          <h3>Ouvindo</h3>
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

  const online = participants.filter((p) => p.connected)
  const away = participants.filter((p) => !p.connected)

  return (
    <section className="side-block participants" aria-label="Participantes">
      <Group title="Ouvindo" list={online} me={me} playing={playing} />
      {away.length > 0 && <Group title="Reconectando" list={away} me={me} playing={false} />}
    </section>
  )
}

function Group({ title, list, me, playing }: { title: string; list: Participant[]; me: string; playing: boolean }) {
  return (
    <>
      <header className="side-head">
        <h3>{title}</h3>
        <span className="count">{list.length}</span>
      </header>
      <ul>
        {list.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'is-away'}>
            <span className="p-avatar" aria-hidden="true">
              {p.avatar ? (
                <img src={p.avatar} alt="" width={32} height={32} loading="lazy" />
              ) : (
                <b>{p.name.trim().charAt(0).toUpperCase() || '?'}</b>
              )}
              <i className="presence" />
            </span>
            <span className="p-name">{p.name}</span>
            {p.id === me && <span className="p-tag">você</span>}
            {p.connected && <Equalizer on={playing} />}
          </li>
        ))}
      </ul>
    </>
  )
}
