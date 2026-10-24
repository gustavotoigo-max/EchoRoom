import { createStore } from '../stores/createStore'
import { showToast } from '../stores/toastStore'
import { appPath, navigate } from '../router'
import { firebaseConfig } from '../config/firebase'
import { currentUser, isAccountUid, signInWithServerToken, signOutUser } from './firebase/app'

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
/** O retorno do Discord é para vincular à conta logada (não para entrar). */
const LINK_KEY = 'echoroom.discordLink'

export const DISCORD_CLIENT_ID = ((import.meta.env?.VITE_DISCORD_CLIENT_ID as string | undefined) ?? '').trim()
export const AUTH_URL = ((import.meta.env?.VITE_AUTH_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')
export const discordEnabled = /^\d{15,25}$/.test(DISCORD_CLIENT_ID) && /^https:\/\//.test(AUTH_URL)
/** Login por e-mail: só precisa do serviço de login e do Firebase. */
export const emailEnabled = /^https:\/\//.test(AUTH_URL) && !!firebaseConfig

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
export function startDiscordLogin(returnTo?: string, opts: { link?: boolean } = {}): void {
  if (!discordEnabled) return
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-')
  try {
    sessionStorage.setItem(STATE_KEY, state)
    if (opts.link) sessionStorage.setItem(LINK_KEY, '1')
    else sessionStorage.removeItem(LINK_KEY)
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

/** Avisa quem mostra as formas de entrar (perfil) que algo mudou. */
export const accountVersion = createStore<{ n: number }>({ n: 0 })
export const accountChanged = () => accountVersion.set({ n: accountVersion.get().n + 1 })

/** Vincula o Discord à conta logada (volta para a mesma página). */
export const startDiscordLink = () => startDiscordLogin(undefined, { link: true })

/** Sai da conta (Discord ou e-mail). */
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
  if (!user || !isAccountUid(user.uid)) return null
  const { claims } = await user.getIdTokenResult()
  return {
    uid: user.uid,
    id: user.uid.slice(user.uid.indexOf('_') + 1),
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
  let linking = false
  try {
    expected = sessionStorage.getItem(STATE_KEY)
    returnPath = sessionStorage.getItem(RETURN_KEY) || '/'
    linking = sessionStorage.getItem(LINK_KEY) === '1'
    sessionStorage.removeItem(STATE_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    sessionStorage.removeItem(LINK_KEY)
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

  if (linking) return finishLink(code)

  authStore.set({ busy: true, error: null })
  try {
    const res = await fetch(`${AUTH_URL}/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirectUri: discordRedirectUri() }),
    })
    const data = (await res.json().catch(() => ({}))) as { firebaseToken?: string; error?: string }
    if (!res.ok || !data.firebaseToken) throw new Error(loginErrorMessage(data.error))
    await completeLogin(data.firebaseToken)
  } catch (err) {
    authStore.set({ busy: false, ready: true, error: (err as Error).message || 'Não foi possível entrar com Discord.' })
    void restoreSession()
  }
}

/** Retorno do Discord para vincular: a sessão continua a mesma conta. */
async function finishLink(code: string): Promise<void> {
  await restoreSession()
  try {
    const user = await currentUser()
    if (!user || !isAccountUid(user.uid)) throw new Error('Entre na sua conta antes de vincular o Discord.')
    const res = await fetch(`${AUTH_URL}/discord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ code, redirectUri: discordRedirectUri(), link: true }),
    })
    const data = (await res.json().catch(() => ({}))) as { username?: string; error?: string }
    if (!res.ok) throw new Error(loginErrorMessage(data.error))
    showToast(`Discord @${data.username ?? ''} vinculado à sua conta.`, 'ok', 4000)
    accountChanged()
  } catch (err) {
    showToast((err as Error).message || 'Não foi possível vincular o Discord.', 'error', 6000)
  }
}

/**
 * Entra na conta com o token do serviço de login (Discord ou e-mail) e
 * atualiza o perfil, o cache e o perfil público.
 */
export async function completeLogin(firebaseToken: string): Promise<DiscordProfile> {
  await signInWithServerToken(firebaseToken)
  const profile = await profileFromFirebase()
  if (!profile) throw new Error('Não foi possível concluir o login.')
  cacheProfile(profile)
  authStore.set({ profile, busy: false, ready: true, error: null })
  const { publishProfile } = await import('./firebase/social')
  void publishProfile(profile)
  // Música da extensão esperando o login: segue para a sala.
  const ext = await import('./externalAdd')
  const pending = ext.pendingStore.get().pending
  if (pending) ext.handleExternalAdd(pending, true)
  return profile
}

export function loginErrorMessage(code?: string): string {
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
    case 'full':
      return 'O EchoRoom chegou ao limite de contas por enquanto. Seu pedido foi enviado ao administrador: tente de novo quando ele aprovar.'
    case 'unlinked':
      return 'Esse login foi desvinculado da conta. Entre de outro jeito e vincule de novo no perfil.'
    case 'discord_in_use':
      return 'Esse Discord já está ligado a outra conta do EchoRoom.'
    case 'email_in_use':
      return 'Esse e-mail já está ligado a outra conta do EchoRoom.'
    case 'google_in_use':
      return 'Essa conta Google já está ligada a outra conta do EchoRoom.'
    case 'google_rejected':
      return 'O Google não confirmou o login. Tente de novo.'
    case 'username_taken':
      return 'Esse nome de usuário já está em uso. Escolha outro.'
    case 'bad_profile':
      return 'Confira o nome e o usuário (2 a 32 letras minúsculas, números, ponto ou _).'
    case 'email_unverified':
      return 'O link de acesso não é válido. Peça um novo.'
    case 'last_method':
      return 'Essa é a única forma de entrar na sua conta: vincule outra antes de tirar.'
    case 'unauthenticated':
      return 'Sua sessão expirou. Entre de novo.'
    default:
      return 'Não foi possível entrar. Tente de novo.'
  }
}
