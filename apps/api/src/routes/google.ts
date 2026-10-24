import { accountFor, caller, defaultUid, enterAccount } from '../accounts'
import { Db } from '../db'
import { readServiceAccount, type Env } from '../env'
import { verifyGoogleIdToken } from '../google'
import { HttpError, json, readJson } from '../http'
import { checkOrigin } from './email'

/**
 * POST /google { credential, name?, username?, link? } — login com Google.
 *
 * O site recebe do Google um ID token ("credential") e manda para cá. A conta
 * é a vinculada a essa conta Google, ou uma nova "acct_g_<sub>". Só pede o
 * login básico (nome e foto): o acesso ao YouTube é pedido à parte, no site,
 * só na hora de importar playlists, e nunca passa por aqui.
 * Com `link: true` (e o token de quem está logado), vincula o Google à conta.
 */
export async function googleLogin(request: Request, env: Env): Promise<Response> {
  checkOrigin(request, env)
  const sa = readServiceAccount(env)
  if (!sa || !env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'not_configured')
  const body = await readJson<{ credential?: unknown; name?: unknown; username?: unknown; link?: unknown }>(request)
  const google = typeof body.credential === 'string' ? await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID) : null
  if (!google) throw new HttpError(401, 'google_rejected')
  const db = new Db(sa, env)

  if (body.link === true) {
    const { uid } = await caller(request, env)
    const own = defaultUid('google', google.sub)
    const mapped = await db.get<string | false>(`admin/identities/google/${google.sub}`)
    if (typeof mapped === 'string' && mapped !== uid) throw new HttpError(409, 'google_in_use')
    // Essa conta Google já tem a própria conta EchoRoom: não dá para levar para outra.
    if (own !== uid && (await db.get(`admin/users/${own}`))) throw new HttpError(409, 'google_in_use')
    await db.update('', {
      [`admin/identities/google/${google.sub}`]: own === uid ? null : uid,
      [`admin/users/${uid}/links/google`]: own === uid ? null : { sub: google.sub, name: google.name || 'Google' },
    })
    return json({ linked: 'google', name: google.name })
  }

  const uid = (await accountFor(db, 'google', google.sub)) ?? defaultUid('google', google.sub)
  return enterAccount(db, env, sa, uid, body, { name: google.name, avatar: google.picture })
}
