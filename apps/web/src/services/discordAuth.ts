import { createStore } from '../stores/createStore'
import { appPath, navigate } from '../router'
import { firebaseConfig } from '../config/firebase'
import { currentUser, isDiscordUid, signInWithServerToken, signOutUser } from './firebase/app'

/**
 * Login com Discord (OAuth2 "authorization code", escopo `identify`).
 *
 * 1. O site manda a pessoa para o Discord pedindo só nome e avatar.
 * 2. O Discord volta para o site com um `code`.
 * 3. O serviço de login (Cloudflare) confirma o `code` com o Discord e
 *    devolve um token do Firebase. O token do Discord nunca chega ao site.
 * 4. Com esse token o Firebase sabe quem é a pessoa (uid "discord_<id>"),
 *    e as regras do banco protegem dono da sala, perfis e convites.
 */

export interface DiscordProfile {
  /** uid no Firebase ("discord_<id>"). */
  uid: string
  /** Administrador do site (definido no backend, em ADMIN_UIDS). */
  admin?: boolean
  id: string
  name: string
  username: string
  avatarUrl: string
}

const PROFILE_KEY = 'echoroom.discord'
const STATE_KEY = 'echoroom.discordState'
const RETURN_KEY = 'echoroom.discordReturn'

export const DISCORD_CLIENT_ID = ((import.meta.env?.VITE_DISCORD_CLIENT_ID as string | undefined) ?? '').trim()
export const AUTH_URL = ((import.meta.env?.VITE_AUTH_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')
export const discordEnabled = /^\d{15,25}$/.test(DISCORD_CLIENT_ID) && /^https:\/\//.test(AUTH_URL)

function readCachedProfile(): DiscordProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    const p = raw ? (JSON.parse(raw) as DiscordProfile) : null
    return p?.uid ? p : null // perfis do login antigo (sem uid) são descartados
  } catch {
    return null
  }
}

function cacheProfile(p: DiscordProfile | null): void {
  try {
    if (p) localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
    else localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* ignora */
  }
}

export const authStore = createStore<{
  profile: DiscordProfile | null
  error: string | null
  busy: boolean
  /** A sessão salva já foi conferida com o Firebase. */
  ready: boolean
}>({
  profile: typeof window !== 'undefined' ? readCachedProfile() : null,
  error: null,
  busy: false,
  ready: false,
})

/** Endereço de retorno cadastrado no Discord: a raiz do site. */
export function discordRedirectUri(): string {
  return `${window.location.origin}${appPath('/')}`
}

/** Vai para o Discord. Depois do login, volta para `returnTo` (padrão: a página atual). */
export function startDiscordLogin(returnTo?: string): void {
  if (!discordEnabled) return
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-')
  try {
    sessionStorage.setItem(STATE_KEY, state)
    // Volta para a mesma página (ex.: a sala) depois do login.
    sessionStorage.setItem(RETURN_KEY, returnTo ?? window.location.pathname.replace(appPath('/'), '/') + window.location.hash)
  } catch {
    /* sem sessionStorage: volta para o início */
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: discordRedirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  })
  window.location.assign(`https://discord.com/oauth2/authorize?${params}`)
}

export async function logoutDiscord(): Promise<void> {
  cacheProfile(null)
  authStore.set({ profile: null, error: null })
  try {
    await signOutUser()
  } catch {
    /* ignora */
  }
}

/** Chamado ao abrir o site: confere a sessão salva e trata o retorno do Discord (?code=…). */
export function initDiscordAuth(): void {
  if (!firebaseConfig) {
    authStore.set({ profile: null, ready: true })
    return
  }
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')
  if (code || error) return void finishLogin(params)
  // ?login=1 (botão "Entrar com Discord" da extensão): vai direto para o Discord.
  if (params.has('login')) {
    params.delete('login')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
    if (!authStore.get().profile && discordEnabled) return startDiscordLogin()
  }
  void restoreSession()
}

/** Perfil a partir das claims do token (dn, un, av), que o serviço de login preencheu. */
async function profileFromFirebase(): Promise<DiscordProfile | null> {
  const user = await currentUser()
  if (!user || !isDiscordUid(user.uid)) return null
  const { claims } = await user.getIdTokenResult()
  return {
    uid: user.uid,
    id: user.uid.slice('discord_'.length),
    name: String(claims.dn ?? 'Discord'),
    username: String(claims.un ?? ''),
    avatarUrl: String(claims.av ?? ''),
    admin: claims.adm === true,
  }
}

async function restoreSession(): Promise<void> {
  try {
    const profile = await profileFromFirebase()
    cacheProfile(profile)
    authStore.set({ profile, ready: true })
    if (profile) {
      const { publishProfile } = await import('./firebase/social')
      void publishProfile(profile)
    }
  } catch {
    authStore.set({ ready: true })
  }
}

async function finishLogin(params: URLSearchParams): Promise<void> {
  let expected: string | null = null
  let returnPath = '/'
  try {
    expected = sessionStorage.getItem(STATE_KEY)
    returnPath = sessionStorage.getItem(RETURN_KEY) || '/'
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    /* ignora */
  }
  // Limpa o code da barra de endereços na hora.
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')
  for (const k of ['code', 'state', 'error', 'error_description']) params.delete(k)
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  if (returnPath !== '/') {
    const [path, hash] = returnPath.split('#')
    navigate(path, true)
    if (hash) window.history.replaceState(null, '', window.location.pathname + '#' + hash)
  }

  if (error || !code) {
    authStore.set({
      ready: true,
      error: error === 'access_denied' ? 'Login com Discord cancelado.' : 'O Discord não autorizou o login. Tente de novo.',
    })
    return restoreSession()
  }
  if (!expected || state !== expected) {
    authStore.set({ ready: true, error: 'Login com Discord inválido. Tente de novo.' })
    return restoreSession()
  }

  authStore.set({ busy: true, error: null })
  try {
    const res = await fetch(`${AUTH_URL}/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: discordRedirectUri() }),
    })
    const data = (await res.json().catch(() => ({}))) as { firebaseToken?: string; error?: string }
    if (!res.ok || !data.firebaseToken) throw new Error(loginErrorMessage(data.error))
    await signInWithServerToken(data.firebaseToken)
    const profile = await profileFromFirebase()
    if (!profile) throw new Error('Não foi possível concluir o login.')
    cacheProfile(profile)
    authStore.set({ profile, busy: false, ready: true })
    const { publishProfile } = await import('./firebase/social')
    void publishProfile(profile)
    // Música da extensão esperando o login: segue para a sala.
    const ext = await import('./externalAdd')
    const pending = ext.pendingStore.get().pending
    if (pending) ext.handleExternalAdd(pending, true)
  } catch (err) {
    authStore.set({ busy: false, ready: true, error: (err as Error).message || 'Não foi possível entrar com Discord.' })
    void restoreSession()
  }
}

function loginErrorMessage(code?: string): string {
  switch (code) {
    case 'not_configured':
      return 'O serviço de login ainda não foi configurado (Cloudflare).'
    case 'origin_not_allowed':
      return 'O serviço de login não reconhece este site (confira ALLOWED_ORIGIN no Cloudflare).'
    case 'discord_rejected':
      return 'O Discord recusou o login. Confira o Client Secret e o endereço de retorno.'
    case 'suspended':
      return 'Sua conta foi suspensa pelo administrador do EchoRoom.'
    case 'pending':
      return 'O EchoRoom está com acesso por aprovação. Seu pedido foi enviado: tente de novo quando o administrador aprovar.'
    default:
      return 'Não foi possível entrar com Discord. Tente de novo.'
  }
}
