import { createStore } from '../stores/createStore'
import { appPath, navigate } from '../router'

/**
 * Login com Discord (OAuth2 "implicit grant", escopo `identify`).
 *
 * - Pede só o escopo `identify`: nome de usuário, nome de exibição e avatar.
 *   Nada de e-mail, servidores ou mensagens.
 * - O token do Discord é usado uma única vez para ler o perfil e é
 *   descartado; só nome, id e avatar ficam salvos neste navegador.
 * - Funciona sem servidor próprio (GitHub Pages). Limitação: como não há
 *   servidor validando, o perfil é confiável só entre amigos — para um
 *   produto comercial, a troca do token deve passar por um backend.
 */

export interface DiscordProfile {
  id: string
  name: string
  username: string
  avatarUrl: string
}

const PROFILE_KEY = 'echoroom.discord'
const STATE_KEY = 'echoroom.discordState'
const RETURN_KEY = 'echoroom.discordReturn'

export const DISCORD_CLIENT_ID = ((import.meta.env?.VITE_DISCORD_CLIENT_ID as string | undefined) ?? '').trim()
export const discordEnabled = /^\d{15,25}$/.test(DISCORD_CLIENT_ID)

function readProfile(): DiscordProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? (JSON.parse(raw) as DiscordProfile) : null
  } catch {
    return null
  }
}

export const authStore = createStore<{ profile: DiscordProfile | null; error: string | null; busy: boolean }>({
  profile: typeof window !== 'undefined' ? readProfile() : null,
  error: null,
  busy: false,
})

/** Endereço de retorno cadastrado no Discord: a raiz do site. */
export function discordRedirectUri(): string {
  return `${window.location.origin}${appPath('/')}`
}

/** Avatar do Discord (ou o avatar padrão quando a pessoa não tem um). */
export function avatarUrlFor(user: { id: string; avatar: string | null; discriminator?: string }): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
  }
  let index = 0
  try {
    index =
      user.discriminator && user.discriminator !== '0'
        ? Number(user.discriminator) % 5
        : Number((BigInt(user.id) >> 22n) % 6n)
  } catch {
    index = 0
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

export function startDiscordLogin(): void {
  if (!discordEnabled) return
  const state = crypto.getRandomValues(new Uint32Array(4)).join('-')
  try {
    sessionStorage.setItem(STATE_KEY, state)
    // Volta para a mesma página (ex.: a sala) depois do login.
    sessionStorage.setItem(RETURN_KEY, window.location.pathname.replace(appPath('/'), '/'))
  } catch {
    /* sem sessionStorage: volta para o início */
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    response_type: 'token',
    redirect_uri: discordRedirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  })
  window.location.assign(`https://discord.com/oauth2/authorize?${params}`)
}

export function logoutDiscord(): void {
  try {
    localStorage.removeItem(PROFILE_KEY)
  } catch {
    /* ignora */
  }
  authStore.set({ profile: null, error: null })
}

/** Chamado ao abrir o site: trata o retorno do Discord (#access_token=…). */
export function initDiscordAuth(): void {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const token = hash.get('access_token')
  const error = hash.get('error')
  if (!token && !error) return

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
  // Limpa o token da barra de endereços na hora.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  if (returnPath !== '/') navigate(returnPath, true)

  if (error) {
    authStore.set({
      error: error === 'access_denied' ? 'Login com Discord cancelado.' : 'O Discord não autorizou o login. Tente de novo.',
    })
    return
  }
  if (!expected || hash.get('state') !== expected) {
    authStore.set({ error: 'Login com Discord inválido. Tente de novo.' })
    return
  }

  authStore.set({ busy: true, error: null })
  fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `${hash.get('token_type') || 'Bearer'} ${token}` },
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(String(res.status))
      const u = (await res.json()) as {
        id: string
        username: string
        global_name?: string | null
        avatar: string | null
        discriminator?: string
      }
      const profile: DiscordProfile = {
        id: u.id,
        name: (u.global_name || u.username).slice(0, 32),
        username: u.username,
        avatarUrl: avatarUrlFor(u),
      }
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
      } catch {
        /* vale só nesta visita */
      }
      authStore.set({ profile, busy: false })
    })
    .catch(() => authStore.set({ busy: false, error: 'Não foi possível ler seu perfil do Discord. Tente de novo.' }))
}
