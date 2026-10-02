import { createStore } from '../../stores/createStore'

/** Painéis da sala: configurações e convidar. */
export const roomUi = createStore<{ panel: 'settings' | 'invite' | null }>({ panel: null })
export const openPanel = (panel: 'settings' | 'invite' | null) => roomUi.set({ panel })
