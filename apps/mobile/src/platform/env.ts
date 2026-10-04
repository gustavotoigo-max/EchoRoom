/**
 * Configuração do app, gravada no build (GitHub Actions → variáveis do
 * repositório FIREBASE_CONFIG, DISCORD_CLIENT_ID e AUTH_URL, as mesmas do site).
 */
export const FIREBASE_CONFIG_RAW = process.env.EXPO_PUBLIC_FIREBASE_CONFIG ?? ''
export const DISCORD_CLIENT_ID = (process.env.EXPO_PUBLIC_DISCORD_CLIENT_ID ?? '').trim()
export const AUTH_URL = (process.env.EXPO_PUBLIC_AUTH_URL ?? '').trim().replace(/\/+$/, '')
/** Site no GitHub Pages: hospeda o player do YouTube usado pelo app. */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://gustavotoigo-max.github.io/EchoRoom').replace(/\/+$/, '')
