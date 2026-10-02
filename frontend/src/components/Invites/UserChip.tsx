import { useEffect, useRef, useState } from 'react'
import { appPath, navigate, PROFILE_PATH } from '../../router'
import { authStore } from '../../services/discordAuth'
import { inviteStore } from '../../services/firebase/social'
import { useStore } from '../../stores/createStore'
import { BellIcon } from '../ui/Icons'
import { InviteCard } from './InviteCard'

/** Sino de convites + avatar com link para o perfil (só para quem entrou com Discord). */
export function UserChip({ compact = false }: { compact?: boolean }) {
  const profile = useStore(authStore, (s) => s.profile)
  const invites = useStore(inviteStore, (s) => s.invites)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  if (!profile) return null
  return (
    <div className="user-chip" ref={ref}>
      <button
        type="button"
        className={`icon-btn bell ${invites.length ? 'has-new' : ''}`}
        aria-label={invites.length ? `${invites.length} convites` : 'Convites'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon width={18} height={18} />
        {invites.length > 0 && <b>{invites.length}</b>}
      </button>
      <a
        className="chip-profile"
        href={appPath(PROFILE_PATH)}
        onClick={(e) => {
          e.preventDefault()
          navigate(PROFILE_PATH)
        }}
        title="Seu perfil"
      >
        <img className="avatar" src={profile.avatarUrl} alt="" width={28} height={28} />
        {!compact && <span>{profile.name}</span>}
      </a>
      {open && (
        <div className="bell-menu" role="dialog" aria-label="Convites">
          <header>Convites</header>
          {invites.length === 0 ? (
            <p className="bell-empty">Nenhum convite pendente. Convites valem por 1 hora.</p>
          ) : (
            invites.map((i) => <InviteCard key={i.id} invite={i} onDone={() => setOpen(false)} />)
          )}
        </div>
      )}
    </div>
  )
}
