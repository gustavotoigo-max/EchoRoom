import { createStore } from '../../stores/createStore'
import type { TrackInput } from '../../services/firebase/playlists'

/** Painéis laterais da sala. */
export type RoomPanel = 'settings' | 'invite' | 'playlist' | 'save' | 'share' | 'newPlaylist'

export const roomUi = createStore<{ panel: RoomPanel | null; playlistId: string | null; track: TrackInput | null }>({
  panel: null,
  playlistId: null,
  track: null,
})

export const openPanel = (panel: RoomPanel | null, extra: { playlistId?: string; track?: TrackInput } = {}) =>
  roomUi.set({ panel, playlistId: extra.playlistId ?? null, track: extra.track ?? null })
