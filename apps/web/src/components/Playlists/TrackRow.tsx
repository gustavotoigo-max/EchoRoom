import { thumbnailUrl } from '../../services/youtube/metadata'
import { PlusIcon } from '../ui/Icons'

/** Uma música numa lista de playlist: miniatura, título, "Fila" e (se puder) remover. */
export function TrackRow({
  t,
  onQueue,
  onRemove,
  inQueue,
}: {
  t: { videoId: string; title: string; author: string }
  onQueue: () => void
  onRemove?: () => void
  inQueue: boolean
}) {
  return (
    <li className="pl-track">
      <img src={thumbnailUrl(t.videoId)} alt="" width={56} height={32} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
      <span className="pl-text">
        <strong title={t.title}>{t.title}</strong>
        {t.author && <small>{t.author}</small>}
      </span>
      <button type="button" className="btn btn-secondary sugg-add" disabled={inQueue} onClick={onQueue}>
        {inQueue ? 'Na fila' : (
          <>
            <PlusIcon width={14} height={14} />
            <span>Fila</span>
          </>
        )}
      </button>
      {onRemove && (
        <button type="button" className="sugg-remove" title="Tirar da playlist" aria-label={`Tirar ${t.title} da playlist`} onClick={onRemove}>
          ×
        </button>
      )}
    </li>
  )
}
