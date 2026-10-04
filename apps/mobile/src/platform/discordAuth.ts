import * as Linking from 'expo-linking'
import { createStore } from '@web/stores/createStore'
import { currentUser, isDiscordUid, signInWithServerToken, signOutUser } from './firebaseApp'
import { firebaseConfig } from './firebaseConfig'
import { AUTH_URL, DISCORD_CLIENT_ID } from './env'
import { read, write } from './storage'

/**
 * Login com Discord no app (versão do celular de services/discordAuth).
 *
 * 1. O app abre a autorização padrão do Discord (pede só nome e avatar).
 *    No Android, se o app do Discord estiver instalado, ele mesmo pode abrir.
 * 2. O Discord volta para a página de retorno do serviço de login
 *    (…/discord/app), que devolve o `code` para o app (echoroom://auth).
 * 3. O app manda o `code` ao serviço de login e recebe o token do Firebase.
 *    O token do Discord e o Client Secret nunca chegam ao celular.
 */

export interface DiscordProfile {
  uid: string
  admin?: boolean
  id: string
  name: string
  username: string
  avatarUrl: string
}

const PROFILE_KEY = 'echoroom.discord'

export { AUTH_URL, DISCORD_CLIENT_ID }
export const discordEnabled = /^\d{15,25}$/.test(DISCORD_CLIENT_ID) && /^https:\/\//.test(AUTH_URL)

/** Endereço de retorno cadastrado no Discord para o app. */
export function discordRedirectUri(): string {
  return `${AUTH_URL}/discord/app`
}

function readCachedProfile(): DiscordProfile | null {
  try {
    const raw = read(PROFILE_KEY)
    const p = raw ? (JSON.parse(raw) as DiscordProfile) : null
    return p?.uid ? p : null
  } catch {
    return null
  }
}

function cacheProfile(p: DiscordProfile | null): void {
  write(PROFILE_KEY, p ? JSON.stringify(p) : null)
}

export const authStore = createStore<{
  profile: DiscordProfile | null
  error: string | null
  busy: boolean
  ready: boolean
}>({ profile: null, error: null, busy: false, ready: false })

let expectedState: string | null = null
let linkSub: { remove(): void } | null = null

/** Abre o Discord para autorizar. A resposta chega pelo link echoroom://auth. */
export async function startDiscordLogin(): Promise<void> {
  if (!discordEnabled) {
    authStore.set({ error: 'O login com Discord não foi configurado neste app.' })
    return
  }
  expectedState = globalThis.crypto.getRandomValues(new Uint32Array(4)).join('-')
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: discordRedirectUri(),
    scope: 'identify',
    state: expectedState,
  })
  authStore.set({ error: null })
  await Linking.openURL(`https://discord.com/oauth2/authorize?${params}`)
}

/** Chamado ao abrir o app: restaura a sessão e passa a ouvir o retorno do Discord. */
export function initDiscordAuth(): void {
  authStore.set({ profile: readCachedProfile() })
  if (!firebaseConfig) {
    authStore.set({ profile: null, ready: true })
    return
  }
  linkSub?.remove()
  linkSub = Linking.addEventListener('url', ({ url }) => void handleUrl(url))
  void Linking.getInitialURL().then((url) => {
    if (url && isAuthUrl(url)) void handleUrl(url)
    else void restoreSession()
  })
}

const isAuthUrl = (url: string) => /^echoroom:\/\/auth\b/i.test(url)

async function handleUrl(url: string): Promise<void> {
  if (!isAuthUrl(url)) return
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  const params = new URLSearchParams(query)
  const code = params.get('code')
  const error = params.get('error')
  const state = params.get('state')
  const expected = expectedState
  expectedState = null

  if (error || !code) {
    authStore.set({
      ready: true,
      error: error === 'access_denied' ? 'Login com Discord cancelado.' : 'O Discord não autorizou o login. Tente de novo.',
    })
    return restoreSession()
  }
  // O app pode ter sido fechado pelo sistema enquanto o Discord estava aberto:
  // sem "state" guardado, o code só vale se ainda não houver login.
  if ((expected && state !== expected) || (!expected && authStore.get().profile)) {
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
    const { publishProfile } = await import('@web/services/firebase/social')
    void publishProfile(profile)
  } catch (err) {
    authStore.set({ busy: false, ready: true, error: (err as Error).message || 'Não foi possível entrar com Discord.' })
    void restoreSession()
  }
}

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
      const { publishProfile } = await import('@web/services/firebase/social')
      void publishProfile(profile)
    }
  } catch {
    authStore.set({ ready: true })
  }
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

function loginErrorMessage(code?: string): string {
  switch (code) {
    case 'not_configured':
      return 'O serviço de login ainda não foi configurado (Cloudflare).'
    case 'origin_not_allowed':
    case 'bad_request':
      return 'O serviço de login não reconhece o app. Ele precisa da versão nova do backend.'
    case 'discord_rejected':
      return 'O Discord recusou o login. Confira se o endereço de retorno do app está cadastrado no Discord.'
    case 'suspended':
      return 'Sua conta foi suspensa pelo administrador do EchoRoom.'
    case 'pending':
      return 'O EchoRoom está com acesso por aprovação. Seu pedido foi enviado: tente de novo quando o administrador aprovar.'
    default:
      return 'Não foi possível entrar com Discord. Tente de novo.'
  }
}
