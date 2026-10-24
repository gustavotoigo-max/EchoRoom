import { AUTH_URL, accountChanged, loginErrorMessage } from './discordAuth'
import { accountLogin, emailStore } from './emailAuth'
import { currentUser, isAccountUid } from './firebase/app'
import { showToast } from '../stores/toastStore'

/**
 * Login com Google ("Fazer login com o Google", Google Identity Services).
 *
 * O botão do Google devolve um ID token (só nome, foto e o ID da conta Google);
 * o serviço de login confere e devolve o token da conta EchoRoom. O acesso ao
 * YouTube não entra aqui: é pedido à parte, só na hora de importar playlists
 * (services/youtube/account.ts).
 */

export const GOOGLE_CLIENT_ID = ((import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '').trim()
export const googleEnabled = /^[\w-]+\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID) && /^https:\/\//.test(AUTH_URL)

interface GsiButtonOptions {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'large' | 'medium' | 'small'
  text?: 'signin_with' | 'continue_with' | 'signin'
  shape?: 'rectangular' | 'pill'
  width?: number
  locale?: string
}

export interface GoogleApi {
  accounts: {
    id: {
      initialize(opts: { client_id: string; callback: (r: { credential?: string }) => void; auto_select?: boolean; ux_mode?: 'popup' }): void
      renderButton(el: HTMLElement, opts: GsiButtonOptions): void
    }
    oauth2: {
      initTokenClient(opts: {
        client_id: string
        scope: string
        callback: (r: { access_token?: string; error?: string }) => void
        error_callback?: (e: { type?: string }) => void
      }): { requestAccessToken(opts?: { prompt?: string }): void }
    }
  }
}

let loading: Promise<GoogleApi> | null = null

/** Carrega o script do Google uma vez. */
export function loadGoogle(): Promise<GoogleApi> {
  const w = window as unknown as { google?: GoogleApi }
  if (w.google?.accounts?.id) return Promise.resolve(w.google)
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.async = true
      s.onload = () => (w.google?.accounts ? resolve(w.google) : reject(new Error('O Google não carregou.')))
      s.onerror = () => {
        loading = null
        reject(new Error('Não foi possível carregar o login do Google.'))
      }
      document.head.appendChild(s)
    })
  }
  return loading
}

/** O que o próximo clique no botão do Google faz (só há um botão na tela por vez). */
let purpose: 'login' | 'link' = 'login'
let initialized = false

/** Desenha o botão oficial do Google em `el`. */
export async function renderGoogleButton(el: HTMLElement, mode: 'login' | 'link', width: number): Promise<void> {
  const google = await loadGoogle()
  if (!initialized) {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (r) => void onCredential(r.credential), auto_select: false, ux_mode: 'popup' })
    initialized = true
  }
  purpose = mode
  el.replaceChildren()
  google.accounts.id.renderButton(el, {
    type: 'standard',
    theme: 'filled_black',
    size: 'large',
    text: mode === 'link' ? 'continue_with' : 'signin_with',
    shape: 'rectangular',
    width: Math.max(200, Math.min(400, Math.round(width))),
    locale: 'pt-BR',
  })
}

/** Nome e e-mail do token (só para mostrar; quem confere o token é o serviço de login). */
function peek(credential: string): { name: string; email: string } {
  try {
    const p = JSON.parse(atob(credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { name?: string; email?: string }
    return { name: p.name ?? '', email: p.email ?? '' }
  } catch {
    return { name: '', email: '' }
  }
}

async function onCredential(credential?: string): Promise<void> {
  if (!credential) return
  try {
    if (purpose === 'link') await linkGoogle(credential)
    else {
      emailStore.set({ error: null })
      const who = peek(credential)
      await accountLogin('/google', { credential }, who.email || who.name, { suggestName: who.name })
    }
  } catch (err) {
    const msg = (err as Error).message || loginErrorMessage()
    emailStore.set({ step: 'idle', error: purpose === 'login' ? msg : null })
    showToast(msg, 'error')
  }
}

async function linkGoogle(credential: string): Promise<void> {
  const user = await currentUser()
  if (!user || !isAccountUid(user.uid)) throw new Error('Entre na sua conta antes de vincular o Google.')
  const res = await fetch(`${AUTH_URL}/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify({ credential, link: true }),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(loginErrorMessage(data.error))
  showToast('Conta Google vinculada.', 'ok', 4000)
  accountChanged()
}
