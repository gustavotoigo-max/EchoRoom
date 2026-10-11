import { createStore } from '../../stores/createStore'

/** Janela "Gerenciar playlists" (por cima da sala, no mesmo modelo do perfil). */
export type ManagerTab = 'playlists' | 'queue'

export const playlistManagerStore = createStore<{ open: boolean; tab: ManagerTab; selectedId: string | null }>({
  open: false,
  tab: 'playlists',
  selectedId: null,
})

export const openPlaylistManager = (extra: { tab?: ManagerTab; selectedId?: string | null } = {}) =>
  playlistManagerStore.set({
    open: true,
    tab: extra.tab ?? 'playlists',
    selectedId: extra.selectedId !== undefined ? extra.selectedId : playlistManagerStore.get().selectedId,
  })

export const closePlaylistManager = () => playlistManagerStore.set({ open: false })
