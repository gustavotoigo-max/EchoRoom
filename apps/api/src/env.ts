/** Variáveis do Worker (Cloudflare → Settings → Variables and Secrets). */
export interface Env {
  DISCORD_CLIENT_ID: string
  /** Secreto. */
  DISCORD_CLIENT_SECRET: string
  /** Secreto: JSON da conta de serviço do Firebase. */
  FIREBASE_SERVICE_ACCOUNT: string
  /** Origens do site, separadas por vírgula (ex.: https://gustavotoigo-max.github.io). */
  ALLOWED_ORIGIN: string
  /** uids dos administradores, separados por vírgula (ex.: discord_123…). */
  ADMIN_UIDS?: string
  /** Opcional: endereço do Realtime Database (padrão: https://<projeto>-default-rtdb.firebaseio.com). */
  FIREBASE_DATABASE_URL?: string
}

export interface ServiceAccount {
  project_id: string
  client_email: string
  private_key: string
}

export function readServiceAccount(env: Env): ServiceAccount | null {
  try {
    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '') as Partial<ServiceAccount>
    return sa.client_email && sa.private_key && sa.project_id ? (sa as ServiceAccount) : null
  } catch {
    return null
  }
}

export const adminUids = (env: Env) =>
  (env.ADMIN_UIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export const allowedOrigins = (env: Env) =>
  (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
