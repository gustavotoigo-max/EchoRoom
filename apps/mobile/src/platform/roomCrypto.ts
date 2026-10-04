import { pbkdf2Async } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha256'

/**
 * Versão do celular de services/firebase/roomCrypto: mesma chave da sala
 * (PBKDF2-SHA256, 150 mil iterações, sal = código da sala), calculada em
 * JavaScript puro porque o React Native não tem WebCrypto.
 */

const ITERATIONS = 150_000

export async function deriveRoomKey(roomId: string, password: string): Promise<string> {
  const enc = new TextEncoder()
  const bits = await pbkdf2Async(sha256, enc.encode(password), enc.encode(`echoroom:${roomId.toUpperCase()}`), {
    c: ITERATIONS,
    dkLen: 32,
    asyncTick: 20,
  })
  return [...bits].map((b) => b.toString(16).padStart(2, '0')).join('')
}
