import { useEffect, useState } from 'react'
import { authStore, discordEnabled, startDiscordLogin } from '../../services/discordAuth'
import { searchProfiles, sendInvite, type PublicProfile } from '../../services/firebase/social'
import { useRoomSession } from '../../services/RoomSessionContext'
import { useStore } from '../../stores/createStore'
import { roomStore } from '../../stores/roomStore'
import { roomLink } from '../../utils/format'
import { CopyButton } from '../ui/CopyButton'
import { CheckIcon, DiscordIcon, SendIcon } from '../ui/Icons'

/** Convidar: link da sala ou convite direto para quem já tem perfil. */
export function InviteDialog() {
  const session = useRoomSession()
  const profile = useStore(authStore, (s) => s.profile)
  const roomName = useStore(roomStore, (s) => s.meta?.name ?? `Sala ${session.roomId}`)
  const inRoom = useStore(roomStore, (s) => (s.room?.participants ?? []).map((p) => p.id).join(','))
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PublicProfile[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent' | string>>({})

  useEffect(() => {
    const text = q.trim()
    if (text.replace(/^@/, '').length < 2) {
      setResults(null)
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      searchProfiles(text)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  async function invite(to: PublicProfile) {
    if (!profile) return
    setSent((s) => ({ ...s, [to.uid]: 'sending' }))
    try {
      await sendInvite(profile, to, { roomId: session.roomId, roomKey: session.backend.roomKey, roomName })
      setSent((s) => ({ ...s, [to.uid]: 'sent' }))
    } catch (err) {
      setSent((s) => ({ ...s, [to.uid]: (err as Error).message || 'Não foi possível convidar.' }))
    }
  }

  const here = new Set(inRoom.split(','))

  return (
    <>
      <section className="drawer-section">
        <h3>Link da sala</h3>
        <div className="inline-field">
          <input readOnly value={roomLink(session.roomId)} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={roomLink(session.roomId)} label="Copiar" doneLabel="Copiado" />
        </div>
        <p className="hint">Quem abrir o link vai precisar da senha da sala.</p>
      </section>

      <section className="drawer-section">
        <h3>Convidar pelo EchoRoom</h3>
        {!profile ? (
          <>
            <p className="hint">Entre com Discord para convidar pessoas direto pelo site, sem precisar da senha.</p>
            {discordEnabled && (
              <button type="button" className="btn btn-discord" onClick={startDiscordLogin}>
                <DiscordIcon width={18} height={18} /> Entrar com Discord
              </button>
            )}
          </>
        ) : (
          <>
            <p className="hint">
              Busque pelo nome de usuário do Discord de quem já entrou no EchoRoom. A pessoa recebe uma notificação e
              entra sem senha. O convite vale por 1 hora.
            </p>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="@usuario do Discord"
              aria-label="Buscar pessoa"
              autoFocus
            />
            <ul className="people-list">
              {searching && results === null && <li className="hint">Buscando…</li>}
              {results?.length === 0 && <li className="hint">Ninguém encontrado. A pessoa precisa ter entrado com Discord no EchoRoom pelo menos uma vez.</li>}
              {results?.map((p) => {
                const state = sent[p.uid]
                const isMe = p.uid === profile.uid
                return (
                  <li key={p.uid}>
                    <span className="p-avatar" aria-hidden="true">
                      {p.avatar ? <img src={p.avatar} alt="" width={32} height={32} /> : <b>{p.name.charAt(0)}</b>}
                    </span>
                    <span className="people-text">
                      <strong>{p.name}</strong>
                      <small>@{p.username}</small>
                      {state && state !== 'sending' && state !== 'sent' && <small className="form-error">{state}</small>}
                    </span>
                    {isMe || here.has(p.uid) ? (
                      <span className="p-tag">{isMe ? 'você' : 'na sala'}</span>
                    ) : state === 'sent' ? (
                      <span className="sent-tag">
                        <CheckIcon width={14} height={14} /> Enviado
                      </span>
                    ) : (
                      <button type="button" className="btn btn-primary" disabled={state === 'sending'} onClick={() => invite(p)}>
                        <SendIcon width={14} height={14} /> Convidar
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </>
  )
}
