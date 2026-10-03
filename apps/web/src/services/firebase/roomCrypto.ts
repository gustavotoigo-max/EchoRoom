/**
 * Senha da sala sem servidor próprio.
 *
 * A chave da sala = PBKDF2(senha, sal = código da sala). Os dados ficam
 * em /rooms/{chave}; as regras do Firebase proíbem listar /rooms, então
 * só quem sabe código + senha consegue calcular o caminho e entrar.
 * As iterações do PBKDF2 deixam cada tentativa de senha lenta.
 */

const ITERATIONS = 150_000

export async function deriveRoomKey(roomId: string, password: string): Promise<string> {
  const enc = new TextEncoder()
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`echoroom:${roomId.toUpperCase()}`), iterations: ITERATIONS },
    material,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
