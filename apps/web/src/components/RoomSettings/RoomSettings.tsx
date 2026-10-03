import { useEffect } from 'react'
import { useStore } from '../../stores/createStore'
import { CloseIcon } from '../ui/Icons'
import { InviteDialog } from './InviteDialog'
import { openPanel, roomUi, type RoomPanel } from './ui'
import { NewPlaylistPanel, PlaylistDetail, SavePanel, SharePanel } from '../Playlists/PlaylistPanels'
import { SettingsBody } from './SettingsBody'

const TITLES: Record<RoomPanel, string> = {
  settings: 'Configurações da sala',
  invite: 'Convidar para a sala',
  playlist: 'Playlist',
  save: 'Salvar em playlist',
  share: 'Sugerir playlist',
  newPlaylist: 'Nova playlist',
}

/** Painel lateral: configurações, convite e playlists. */
export function RoomSettingsPanel() {
  const panel = useStore(roomUi, (s) => s.panel)
  useEffect(() => {
    if (!panel) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openPanel(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])
  useEffect(() => () => openPanel(null), [])
  if (!panel) return null
  return (
    <div className="drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && openPanel(null)}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={TITLES[panel]}>
        <header className="drawer-head">
          <h2>{TITLES[panel]}</h2>
          <button type="button" className="icon-btn drawer-close" aria-label="Fechar" onClick={() => openPanel(null)}>
            <CloseIcon width={18} height={18} />
          </button>
        </header>
        <div className="drawer-body">
          {panel === 'settings' && <SettingsBody />}
          {panel === 'invite' && <InviteDialog />}
          {panel === 'playlist' && <PlaylistDetail />}
          {panel === 'save' && <SavePanel />}
          {panel === 'share' && <SharePanel />}
          {panel === 'newPlaylist' && <NewPlaylistPanel />}
        </div>
      </aside>
    </div>
  )
}
