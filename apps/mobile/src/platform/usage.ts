import { dayKey, type UsageCounter } from '@echoroom/shared'
import { increment, ref, set } from 'firebase/database'
import { ensureSignedIn, getDb } from './firebaseApp'
import { read, write } from './storage'

/** Versão do celular de services/firebase/usage (mesmas estatísticas, sem localStorage). */

const ACTIVE_KEY = 'echoroom.activeDay'

export async function markActive(): Promise<void> {
  try {
    const uid = await ensureSignedIn()
    const day = dayKey()
    const mark = `${uid}:${day}`
    if (read(ACTIVE_KEY) === mark) return
    await set(ref(getDb(), `activity/${day}/${uid}`), true)
    write(ACTIVE_KEY, mark)
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
