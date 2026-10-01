/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Objeto de configuração web do Firebase (texto). */
  readonly VITE_FIREBASE_CONFIG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
