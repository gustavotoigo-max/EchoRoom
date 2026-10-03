/**
 * Contratos compartilhados entre o site (apps/web) e o backend (apps/api).
 */

/** Claims que o backend coloca no token do Firebase (visíveis nas regras como auth.token.*). */
export const CLAIMS = {
  displayName: 'dn',
  username: 'un',
  avatar: 'av',
  admin: 'adm',
} as const

/** Prefixo do uid de quem entra com Discord. */
export const DISCORD_UID_PREFIX = 'discord_'
