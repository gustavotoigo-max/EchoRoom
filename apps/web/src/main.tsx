import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { authStore, initDiscordAuth } from './services/discordAuth'
import { watchInvites } from './services/firebase/social'
import { initExternalAdd } from './services/externalAdd'
import { initExtensionBridge } from './services/extensionBridge'
import './styles/index.css'

initDiscordAuth()
initExternalAdd()
initExtensionBridge()

// Convites chegam em qualquer página para quem entrou com Discord.
const syncInvites = () => {
  const { profile, ready } = authStore.get()
  if (ready) watchInvites(profile?.uid ?? null)
}
authStore.subscribe(syncInvites)
syncInvites()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
