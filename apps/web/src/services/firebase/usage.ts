import { dayKey, type UsageCounter } from '@echoroom/shared'
import { increment, ref, set } from 'firebase/database'
import { ensureSignedIn, getDb } from './app'

/**
 * Estatísticas de uso para o painel do admin, sem conteúdo:
 * - /activity/{dia}/{uid}: quem usou o site no dia (uma escrita por dia)
 * - /stats/daily/{dia}/{contador}: totais do dia (só +1)
 * Falhas aqui nunca atrapalham o uso.
 */

const ACTIVE_KEY = 'echoroom.activeDay'

export async function markActive(): Promise<void> {
  try {
    const uid = await ensureSignedIn()
    const day = dayKey()
    const mark = `${uid}:${day}`
    if (localStorage.getItem(ACTIVE_KEY) === mark) return
    await set(ref(getDb(), `activity/${day}/${uid}`), true)
    localStorage.setItem(ACTIVE_KEY, mark)
  } catch {
    /* sem estatística */
  }
}

export async function countUsage(counter: UsageCounter, times = 1): Promise<void> {
  try {
    await ensureSignedIn()
    const r = ref(getDb(), `stats/daily/${dayKey()}/${counter}`)
    for (let i = 0; i < Math.min(times, 50); i++) await set(r, increment(1))
  } catch {
    /* sem estatística */
  }
}
