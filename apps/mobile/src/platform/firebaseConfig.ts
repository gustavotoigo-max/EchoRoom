import { FIREBASE_CONFIG_RAW } from './env'

/** Versão do celular de config/firebase: mesma leitura, valor vindo do build do app. */

export interface FirebaseWebConfig {
  apiKey: string
  authDomain?: string
  databaseURL: string
  projectId: string
  storageBucket?: string
  messagingSenderId?: string
  appId: string
  measurementId?: string
}

export function parseFirebaseConfig(raw: string | undefined | null): FirebaseWebConfig | null {
  if (!raw || !raw.trim()) return null
  let text = raw.trim()
  // O trecho do console costuma vir com `import { initializeApp } ...` e
  // `initializeApp(firebaseConfig)`. Isola só o objeto que contém apiKey.
  const keyAt = text.search(/["']?apiKey["']?\s*:/)
  if (keyAt < 0) return null
  const start = text.lastIndexOf('{', keyAt)
  if (start < 0) return null
  let depth = 0
  let end = -1
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  if (end < 0) return null
  text = text.slice(start, end + 1)
  // Converte objeto JavaScript em JSON: aspas nas chaves, aspas simples, vírgula final.
  const json = text
    .replace(/^\s*\/\/.*$/gm, '') // comentários em linha própria
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*}/g, '}')
  try {
    const cfg = JSON.parse(json) as FirebaseWebConfig
    if (!cfg.apiKey || !cfg.projectId || !cfg.appId) return null
    if (!cfg.databaseURL) cfg.databaseURL = `https://${cfg.projectId}-default-rtdb.firebaseio.com`
    return cfg
  } catch {
    return null
  }
}

export const firebaseConfig = parseFirebaseConfig(FIREBASE_CONFIG_RAW)
