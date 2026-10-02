import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initExternalAdd } from './services/externalAdd'
import { initTheme } from './theme/themes'
import './styles/global.css'
import './styles/themes.css'

initTheme()
initExternalAdd()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
