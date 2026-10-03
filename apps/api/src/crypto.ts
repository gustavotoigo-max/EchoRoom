/** Assinatura e verificação de JWT (RS256) com WebCrypto. */

const enc = new TextEncoder()

export const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const b64urlText = (text: string) => b64url(enc.encode(text))

export function b64urlDecode(s: string): ArrayBuffer {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0)).buffer as ArrayBuffer
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function importPrivateKey(pem: string): Promise<CryptoKey> {
  let p = keyCache.get(pem)
  if (!p) {
    const der = b64urlDecode(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_'))
    p = crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    keyCache.set(pem, p)
  }
  return p
}

export async function signJwt(payload: Record<string, unknown>, privateKeyPem: string): Promise<string> {
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify(payload))}`
  const key = await importPrivateKey(privateKeyPem)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(unsigned))
  return `${unsigned}.${b64url(sig)}`
}

export interface Jwk extends JsonWebKey {
  kid: string
}

/** Confere a assinatura de um JWT RS256 com uma chave pública JWK. */
export async function verifyJwtSignature(token: string, jwk: Jwk): Promise<boolean> {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return false
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(s), enc.encode(`${h}.${p}`))
}

export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = token.split('.')
  const dec = (x: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(x))) as Record<string, unknown>
  return { header: dec(h), payload: dec(p) }
}
