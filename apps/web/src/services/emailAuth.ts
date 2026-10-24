import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  inMemoryPersistence,
  initializeAuth,
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type Auth,
} from 'firebase/auth'
import { firebaseConfig } from '../config/firebase'
import { appPath, navigate } from '../router'
import { createStore } from '../stores/createStore'
import { showToast } from '../stores/toastStore'
import { accountChanged, AUTH_URL, completeLogin, loginErrorMessage } from './discordAuth'
import { currentUser, isAccountUid } from './firebase/app'

/**
 * Login por e-mail, sem senha: o Firebase manda um link de acesso.
 *
 * 1. A pessoa digita o e-mail; o Firebase envia o link.
 * 2. O link abre o site; o site entra com ele num app secundário do Firebase
 *    (só para provar o e-mail, sem trocar a sessão atual).
 * 3. O token desse usuário de e-mail vai para o serviço de login, que devolve o
 *    token da conta EchoRoom (ou pede nome e usuário, na primeira vez).
 * Para vincular um e-mail à conta logada, o passo 3 é POST /link/email.
 */

const PENDING_KEY = 'echoroom.emailLink'
const LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId', 'emailLink']

type Purpose = 'login' | 'link'

export const emailStore = createStore<{
  /** sent: link enviado · askEmail: link aberto em outro aparelho · profile: conta nova pede nome e usuário. */
  step: 'idle' | 'sent' | 'askEmail' | 'working' | 'profile'
  email: string
  error: string | null
}>({ step: 'idle', email: '', error: null })

let app: FirebaseApp | null = null
let auth: Auth | null = null
/** Token do usuário de e-mail enquanto a conta nova escolhe nome e usuário. */
let pendingToken: string | null = null

function emailAuth(): Auth {
  if (!firebaseConfig) throw new Error('O Firebase não está configurado neste site.')
  if (!auth) {
    app = initializeApp(firebaseConfig, 'email-link')
    auth = initializeAuth(app, { persistence: inMemoryPersistence })
  }
  return auth
}

interface Pending {
  email: string
  purpose: Purpose
  returnTo: string
}

function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') as Pending | null
    return p?.email ? p : null
  } catch {
    return null
  }
}

function savePending(p: Pending | null): void {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* sem localStorage: o link pede o e-mail de novo */
  }
}

const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

/** Manda o link de acesso. `link`: vincular o e-mail à conta logada. */
export async function sendEmailLink(email: string, purpose: Purpose = 'login'): Promise<void> {
  const clean = email.trim().toLowerCase()
  if (!validEmail(clean)) {
    emailStore.set({ error: 'Digite um e-mail válido.' })
    return
  }
  emailStore.set({ step: 'working', error: null })
  try {
    await sendSignInLinkToEmail(emailAuth(), clean, {
      url: `${window.location.origin}${appPath('/')}?emailLink=1`,
      handleCodeInApp: true,
    })
    savePending({ email: clean, purpose, returnTo: window.location.pathname.replace(appPath('/'), '/') + window.location.hash })
    emailStore.set({ step: 'sent', email: clean })
  } catch (err) {
    emailStore.set({ step: 'idle', error: firebaseError(err) })
  }
}

/** Ao abrir o site: termina o login se a página veio do link do e-mail. */
export function initEmailAuth(): void {
  if (!firebaseConfig || !/^https:\/\//.test(AUTH_URL)) return
  const href = window.location.href
  if (!isSignInWithEmailLink(emailAuth(), href)) return
  const pending = readPending()
  if (pending) void finishEmailLink(pending.email, href, pending)
  else emailStore.set({ step: 'askEmail', error: null })
}

/** Link aberto em outro navegador: a pessoa confirma o e-mail. */
export function confirmEmail(email: string): Promise<void> {
  return finishEmailLink(email.trim().toLowerCase(), window.location.href, null)
}

async function finishEmailLink(email: string, href: string, pending: Pending | null): Promise<void> {
  emailStore.set({ step: 'working', email, error: null })
  cleanUrl(pending?.returnTo)
  try {
    const cred = await signInWithEmailLink(emailAuth(), email, href)
    const idToken = await cred.user.getIdToken()
    savePending(null)
    if (pending?.purpose === 'link') await linkToAccount(idToken)
    else await loginWith(idToken)
  } catch (err) {
    emailStore.set({ step: 'idle', error: describe(err) })
  } finally {
    void signOut(emailAuth()).catch(() => {})
  }
}

async function loginWith(idToken: string, extra: { name?: string; username?: string } = {}): Promise<void> {
  const res = await fetch(`${AUTH_URL}/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...extra }),
  })
  const data = (await res.json().catch(() => ({}))) as { firebaseToken?: string; error?: string }
  if (['needs_profile', 'username_taken', 'bad_profile'].includes(data.error ?? '')) {
    pendingToken = idToken
    emailStore.set({ step: 'profile', error: data.error === 'needs_profile' ? null : loginErrorMessage(data.error) })
    return
  }
  if (!res.ok || !data.firebaseToken) throw new Error(loginErrorMessage(data.error))
  pendingToken = null
  const profile = await completeLogin(data.firebaseToken)
  emailStore.set({ step: 'idle', error: null })
  showToast(`Bem-vindo, ${profile.name}!`, 'ok', 3000)
}

/** Conta nova: nome e usuário escolhidos. */
export async function submitNewAccount(name: string, username: string): Promise<void> {
  if (!pendingToken) return emailStore.set({ step: 'idle', error: 'O link expirou. Peça um novo.' })
  emailStore.set({ step: 'working', error: null })
  try {
    await loginWith(pendingToken, { name, username })
  } catch (err) {
    emailStore.set({ step: 'profile', error: describe(err) })
  }
}

async function linkToAccount(emailToken: string): Promise<void> {
  const user = await currentUser()
  if (!user || !isAccountUid(user.uid)) throw new Error('Entre na sua conta antes de vincular o e-mail.')
  const res = await fetch(`${AUTH_URL}/link/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ idToken: emailToken }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(loginErrorMessage(data.error))
  emailStore.set({ step: 'idle', error: null })
  showToast('E-mail vinculado à sua conta.', 'ok', 4000)
  accountChanged()
}

export const cancelEmail = () => {
  pendingToken = null
  emailStore.set({ step: 'idle', error: null })
}

/** Tira os parâmetros do link da barra de endereços e volta para a página de origem. */
function cleanUrl(returnTo?: string): void {
  const params = new URLSearchParams(window.location.search)
  for (const k of LINK_PARAMS) params.delete(k)
  const rest = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''))
  if (returnTo && returnTo !== '/') {
    const [path, hash] = returnTo.split('#')
    navigate(path, true)
    if (hash) window.history.replaceState(null, '', window.location.pathname + '#' + hash)
  }
}

/** Erros do Firebase viram texto; os do serviço de login já vêm prontos. */
const describe = (err: unknown) =>
  String((err as { code?: string })?.code ?? '').startsWith('auth/') ? firebaseError(err) : (err as Error)?.message || firebaseError(err)

function firebaseError(err: unknown): string {
  const code = String((err as { code?: string })?.code ?? '')
  if (code === 'auth/operation-not-allowed') return 'O login por e-mail não está ativado no Firebase (Authentication → Método de login → E-mail/senha → Link do e-mail).'
  if (code === 'auth/unauthorized-continue-uri' || code === 'auth/unauthorized-domain') return 'Este site não está nos domínios autorizados do Firebase (Authentication → Configurações).'
  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') return 'O link de acesso expirou ou já foi usado. Peça um novo.'
  if (code === 'auth/invalid-email') return 'Esse e-mail não confere com o do link. Digite o mesmo e-mail.'
  if (code === 'auth/network-request-failed') return 'Sem conexão com a internet.'
  if (code === 'auth/too-many-requests') return 'Muitas tentativas. Espere um pouco e tente de novo.'
  return 'Não foi possível entrar com o e-mail. Tente de novo.'
}
