/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Objeto de configuração web do Firebase (texto). */
  readonly VITE_FIREBASE_CONFIG?: string
  /** Client ID público do app no Discord Developer Portal (opcional). */
  readonly VITE_DISCORD_CLIENT_ID?: string
  /** Endereço do serviço de login (Cloudflare Worker), ex.: https://echoroom-auth.x.workers.dev */
  readonly VITE_AUTH_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
