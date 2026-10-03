import { createStore } from '../../stores/createStore'
import type { Playlist } from '../../services/firebase/playlists'

/** Playlists vistas na sala (da sala + sugeridas) e as pessoais de quem está logado. */
export const playlistStore = createStore<{ room: Playlist[] | null; mine: Playlist[] | null }>({ room: null, mine: null })
