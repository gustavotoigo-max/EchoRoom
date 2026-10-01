import { useSyncExternalStore } from 'react'

/** Store mínima (sem dependências). Componentes assinam só o pedaço que usam. */
export interface Store<T> {
  get(): T
  set(partial: Partial<T> | ((s: T) => Partial<T>)): void
  subscribe(fn: () => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(partial) {
      const patch = typeof partial === 'function' ? partial(state) : partial
      let changed = false
      for (const k in patch) {
        if (!Object.is(state[k as keyof T], patch[k as keyof T])) {
          changed = true
          break
        }
      }
      if (!changed) return
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}

export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  )
}
