import type { Env, ServiceAccount } from './env'
import { serviceAccessToken } from './google'

/**
 * Cliente REST do Realtime Database com a conta de serviço: o backend lê e
 * escreve sem passar pelas regras (que continuam valendo para o site).
 */
export class Db {
  private readonly base: string

  constructor(
    private readonly sa: ServiceAccount,
    env: Env,
  ) {
    this.base = (env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.firebaseio.com`).replace(/\/+$/, '')
  }

  private async url(path: string, params: Record<string, string> = {}): Promise<string> {
    const q = new URLSearchParams({ ...params, access_token: await serviceAccessToken(this.sa) })
    return `${this.base}/${path.replace(/^\/+/, '')}.json?${q}`
  }

  private async call<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const res = await fetch(await this.url(path, params), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Banco recusou ${method} /${path} (${res.status}).`)
    return (await res.json()) as T
  }

  get<T>(path: string): Promise<T | null> {
    return this.call<T | null>('GET', path)
  }

  /** As últimas `n` entradas por chave (ex.: registro de ações, chaves de push em ordem). */
  lastByKey<T>(path: string, n: number): Promise<Record<string, T> | null> {
    return this.call<Record<string, T> | null>('GET', path, undefined, { orderBy: '"$key"', limitToLast: String(n) })
  }

  /** Só as chaves do nó (sem baixar o conteúdo). */
  async keys(path: string): Promise<string[]> {
    const v = await this.call<Record<string, unknown> | null>('GET', path, undefined, { shallow: 'true' })
    return v && typeof v === 'object' ? Object.keys(v) : []
  }

  set(path: string, value: unknown): Promise<unknown> {
    return this.call('PUT', path, value)
  }

  /** Atualização em vários caminhos de uma vez (chaves relativas a `path`; null apaga). */
  update(path: string, patch: Record<string, unknown>): Promise<unknown> {
    return this.call('PATCH', path, patch)
  }

  remove(path: string): Promise<unknown> {
    return this.call('DELETE', path)
  }

  async push(path: string, value: unknown): Promise<string> {
    const res = await this.call<{ name: string }>('POST', path, value)
    return res.name
  }
}

/** Executa tarefas com no máximo `limit` ao mesmo tempo. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}
