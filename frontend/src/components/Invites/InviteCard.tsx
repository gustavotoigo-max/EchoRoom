import { useState } from 'react'
import { navigate } from '../../router'
import { acceptInvite, declineInvite, expiresIn, type Invite } from '../../services/firebase/social'
import { showToast } from '../../stores/toastStore'

/** Um convite com Aceitar/Recusar. Aceitar abre a sala. */
export function InviteCard({ invite, onDone }: { invite: Invite; onDone?: () => void }) {
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true)
    try {
      await acceptInvite(invite)
      onDone?.()
      navigate(`/room/${invite.roomId}`)
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível aceitar o convite.', 'error')
      setBusy(false)
    }
  }

  async function decline() {
    setBusy(true)
    try {
      await declineInvite(invite)
      onDone?.()
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="invite-card">
      <span className="p-avatar" aria-hidden="true">
        {invite.fromAvatar ? <img src={invite.fromAvatar} alt="" width={32} height={32} /> : <b>{invite.fromName.charAt(0)}</b>}
      </span>
      <div className="invite-text">
        <span>
          <strong>{invite.fromName}</strong> te convidou para <strong>{invite.roomName}</strong>
        </span>
        <small>{expiresIn(invite)}</small>
      </div>
      <div className="invite-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={accept}>
          Aceitar
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={decline}>
          Recusar
        </button>
      </div>
    </div>
  )
}
