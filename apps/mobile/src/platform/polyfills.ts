/**
 * O que o código do site espera do navegador e o React Native não tem.
 * Importado antes de tudo em index.ts.
 */
import * as ExpoCrypto from 'expo-crypto'

const g = globalThis as unknown as Record<string, any>

// Documentos da sala são JSON puro: cópia por JSON basta.
if (typeof g.structuredClone !== 'function') {
  g.structuredClone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
}

// crypto.getRandomValues (código da sala, convites, "state" do login).
if (!g.crypto) g.crypto = {}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = <T extends ArrayBufferView | null>(arr: T): T => ExpoCrypto.getRandomValues(arr as never) as T
}
if (typeof g.crypto.randomUUID !== 'function') g.crypto.randomUUID = () => ExpoCrypto.randomUUID()
