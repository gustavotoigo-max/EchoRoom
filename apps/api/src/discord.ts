import type { Env } from './env'
import { HttpError } from './http'

const DISCORD_API = 'https://discord.com/api/v10'

export interface DiscordUser {
  id: string
  name: string
  username: string
  avatarUrl: string
}

function avatarUrlFor(user: { id: string; avatar: string | null; discriminator?: string }): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png'
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`
  }
  let index = 0
  try {
    index = user.discriminator && user.discriminator !== '0' ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n)
  } catch {
    index = 0
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

/** Troca o `code` pelo perfil (escopo identify). O token do Discord é usado e descartado. */
export async function discordProfileFromCode(env: Env, code: string, redirectUri: string): Promise<DiscordUser> {
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })
  if (!tokenRes.ok) throw new HttpError(401, 'discord_rejected')
  const token = (await tokenRes.json()) as { access_token: string; token_type?: string }
  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `${token.token_type || 'Bearer'} ${token.access_token}` },
  })
  if (!meRes.ok) throw new HttpError(502, 'discord_profile')
  const me = (await meRes.json()) as { id: string; username: string; global_name?: string | null; avatar: string | null; discriminator?: string }
  return {
    id: String(me.id),
    name: String(me.global_name || me.username).slice(0, 32),
    username: String(me.username).slice(0, 32),
    avatarUrl: avatarUrlFor(me),
  }
}
