import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initDiscordAuth } from './services/discordAuth'
import { initExternalAdd } from './services/externalAdd'
import './styles/global.css'

initDiscordAuth()
initExternalAdd()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
