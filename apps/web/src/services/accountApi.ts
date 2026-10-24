import type { AccountMethods } from '@echoroom/shared'
import { AUTH_URL, loginErrorMessage } from './discordAuth'
import { currentUser, isAccountUid } from './firebase/app'

/** Formas de entrar da conta logada (serviço de login). */

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const user = await currentUser()
  if (!user || !isAccountUid(user.uid)) throw new Error(loginErrorMessage('unauthenticated'))
  const res = await fetch(`${AUTH_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(loginErrorMessage(data.error))
  return data
}

export const fetchMethods = () => call<{ methods: AccountMethods }>('GET', '/account').then((r) => r.methods)

export const unlinkMethod = (provider: 'discord' | 'email') =>
  call<{ methods: AccountMethods }>('POST', '/unlink', { provider }).then((r) => r.methods)
