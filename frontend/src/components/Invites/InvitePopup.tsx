import { useEffect, useState } from 'react'
import { inviteStore } from '../../services/firebase/social'
import { useStore } from '../../stores/createStore'
import { CloseIcon } from '../ui/Icons'
import { InviteCard } from './InviteCard'

const seen = new Set<string>()

/** Notificação de convite novo, em qualquer página. Fechar deixa o convite no sino. */
export function InvitePopup() {
  const invites = useStore(inviteStore, (s) => s.invites)
  const [, force] = useState(0)
  const next = invites.find((i) => !seen.has(i.id))

  // Atualiza o "expira em" a cada 30 s.
  useEffect(() => {
    if (!next) return
    const t = setInterval(() => force((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [next])

  if (!next) return null
  const close = () => {
    seen.add(next.id)
    force((n) => n + 1)
  }
  return (
    <div className="invite-popup" role="alertdialog" aria-label="Novo convite">
      <header>
        <span>Novo convite</span>
        <button type="button" className="toast-close" aria-label="Fechar" onClick={close}>
          <CloseIcon width={16} height={16} />
        </button>
      </header>
      <InviteCard invite={next} onDone={close} />
    </div>
  )
}
