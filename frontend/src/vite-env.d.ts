/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Objeto de configuração web do Firebase (texto). */
  readonly VITE_FIREBASE_CONFIG?: string
  /** Client ID público do app no Discord Developer Portal (opcional). */
  readonly VITE_DISCORD_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
