import type { QueueItem } from '../../types/room'
import { openPanel } from '../RoomSettings/ui'
import { BookmarkPlusIcon } from '../ui/Icons'

const asTrack = (t: QueueItem) => ({ videoId: t.videoId, title: t.title, author: t.author })

/** Botão "salvar em playlist" para a música que está tocando. */
export function SaveToPlaylist({ track }: { track: QueueItem }) {
  return (
    <button
      type="button"
      className="icon-btn mode-btn"
      title="Salvar em uma playlist"
      aria-label="Salvar em uma playlist"
      onClick={() => openPanel('save', { track: asTrack(track) })}
    >
      <BookmarkPlusIcon width={18} height={18} />
    </button>
  )
}

/** Item do menu da fila. */
export function SaveToPlaylistMenuItems({ track, onDone }: { track: QueueItem; onDone: () => void }) {
  return (
    <button
      role="menuitem"
      type="button"
      onClick={() => {
        onDone()
        openPanel('save', { track: asTrack(track) })
      }}
    >
      Salvar em playlist…
    </button>
  )
}
