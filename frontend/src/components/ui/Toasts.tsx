import { useStore } from '../../stores/createStore'
import { dismissToast, toastStore } from '../../stores/toastStore'

export function Toasts() {
  const toasts = useStore(toastStore, (s) => s.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button type="button" className="toast-close" aria-label="Fechar aviso" onClick={() => dismissToast(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
