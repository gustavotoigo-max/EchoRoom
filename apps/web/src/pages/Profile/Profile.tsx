import { useEffect, useState } from 'react'
import { InviteCard } from '../../components/Invites/InviteCard'
import { UserChip } from '../../components/Invites/UserChip'
import { Brand } from '../../components/ui/Brand'
import { CrownIcon, DiscordIcon } from '../../components/ui/Icons'
import { appPath, navigate, START_PATH } from '../../router'
import { authStore, discordEnabled, logoutDiscord, startDiscordLogin } from '../../services/discordAuth'
import { inviteStore, leaveRoom, subscribeMyRooms, type MyRoom } from '../../services/firebase/social'
import { useStore } from '../../stores/createStore'
import { showToast } from '../../stores/toastStore'
import { Toasts } from '../../components/ui/Toasts'
import { storage } from '../../utils/storage'
import { MyPlaylists } from './MyPlaylists'

function lastAccess(ms: number): string {
  if (!ms) return ''
  const d = Math.round((Date.now() - ms) / 86_400_000)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

/** Perfil: dados do Discord, convites pendentes e as salas da pessoa. */
export function Profile() {
  const { profile, ready, busy } = useStore(authStore, (s) => s)
  const invites = useStore(inviteStore, (s) => s.invites)
  const [rooms, setRooms] = useState<MyRoom[] | null>(null)
  const [error, setError] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setRooms(null)
    return subscribeMyRooms(profile.uid, setRooms, () => setError(true))
  }, [profile])

  function open(room: MyRoom) {
    storage.setRoomKey(room.roomId, room.key)
    navigate(`/room/${room.roomId}`)
  }

  async function leave(room: MyRoom) {
    try {
      await leaveRoom(room)
      showToast(`Você saiu de "${room.name}".`, 'info', 3000)
    } catch {
      showToast('Não foi possível sair da sala.', 'error')
    }
    setConfirmLeave(null)
  }

  return (
    <div className="home profile-page">
      <header className="topbar">
        <Brand />
        <UserChip />
      </header>
      <main className="profile-main">
        {!profile ? (
          <div className="panel gate">
            <h2>Seu perfil</h2>
            <p className="hint">
              {ready
                ? 'O perfil guarda as salas das quais você faz parte e os convites que recebe. Entre com Discord para ver.'
                : 'Carregando…'}
            </p>
            {discordEnabled && ready && (
              <button type="button" className="btn btn-discord" onClick={startDiscordLogin} disabled={busy}>
                <DiscordIcon width={20} height={20} />
                <span>Entrar com Discord</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <section className="profile-head">
              <img className="avatar" src={profile.avatarUrl} alt="" width={88} height={88} />
              <div>
                <h1>{profile.name}</h1>
                <p>@{profile.username} · conectado com Discord</p>
              </div>
              <div className="profile-actions">
                <a
                  className="btn btn-primary"
                  href={appPath(START_PATH)}
                  onClick={(e) => {
                    e.preventDefault()
                    navigate(START_PATH)
                  }}
                >
                  Criar sala
                </a>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    await logoutDiscord()
                    navigate('/')
                  }}
                >
                  Sair do Discord
                </button>
              </div>
            </section>

            {invites.length > 0 && (
              <section className="profile-block">
                <header className="side-head">
                  <h3>Convites pendentes</h3>
                  <span className="count">{invites.length}</span>
                </header>
                <div className="invite-list">
                  {invites.map((i) => (
                    <InviteCard key={i.id} invite={i} />
                  ))}
                </div>
              </section>
            )}

            <section className="profile-block">
              <header className="side-head">
                <h3>Minhas salas</h3>
                <span className="count">{rooms ? rooms.length : ''}</span>
              </header>
              {error ? (
                <p className="sugg-empty">Não foi possível carregar suas salas. As regras do banco foram atualizadas?</p>
              ) : rooms === null ? (
                <div className="room-cards">
                  {[0, 1].map((i) => (
                    <div key={i} className="room-card skeleton" style={{ height: 120 }} />
                  ))}
                </div>
              ) : rooms.length === 0 ? (
                <p className="sugg-empty">
                  Você ainda não está em nenhuma sala. Crie uma ou aceite um convite: as salas em que você entrar com
                  Discord aparecem aqui.
                </p>
              ) : (
                <div className="room-cards">
                  {rooms.map((r) => (
                    <article key={r.roomId} className={`room-card ${r.role === 'owner' ? 'is-owner' : ''}`}>
                      <div className="room-card-top">
                        <h4 title={r.name}>{r.name}</h4>
                        {r.role === 'owner' ? (
                          <span className="role-badge owner">
                            <CrownIcon width={12} height={12} /> Dono
                          </span>
                        ) : (
                          <span className="role-badge">Membro</span>
                        )}
                      </div>
                      <p>
                        <span className="mono-code">{r.roomId}</span>
                        {r.lastAt ? ` · último acesso ${lastAccess(r.lastAt)}` : ''}
                      </p>
                      <div className="room-card-actions">
                        <button type="button" className="btn btn-primary" onClick={() => open(r)}>
                          Abrir sala
                        </button>
                        {r.role !== 'owner' &&
                          (confirmLeave === r.roomId ? (
                            <>
                              <button type="button" className="btn btn-danger" onClick={() => leave(r)}>
                                Confirmar saída
                              </button>
                              <button type="button" className="link-btn" onClick={() => setConfirmLeave(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button type="button" className="btn btn-secondary" onClick={() => setConfirmLeave(r.roomId)}>
                              Sair da sala
                            </button>
                          ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <MyPlaylists profile={profile} rooms={rooms} />
          </>
        )}
      </main>
      <Toasts />
    </div>
  )
}
