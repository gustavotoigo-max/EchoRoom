import { initializeApp, type FirebaseApp } from 'firebase/app'
import * as FirebaseAuth from 'firebase/auth'
import {
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCustomToken,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { firebaseConfig } from './firebaseConfig'

// No React Native a sessão é guardada no AsyncStorage (o pacote do Firebase
// para React Native exporta getReactNativePersistence; os tipos não mostram).
const getReactNativePersistence = (FirebaseAuth as unknown as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => FirebaseAuth.Persistence
}).getReactNativePersistence

/**
 * Versão do celular de services/firebase/app (igual, exceto a sessão salva no aparelho).
 *
 * Inicialização única do Firebase e sessão do usuário.
 *
 * - Quem entra com Discord recebe um token do serviço de login (Cloudflare)
 *   e vira o usuário "discord_<id>" — o mesmo em qualquer computador.
 * - Quem não entra com Discord usa login anônimo (convidado, vale só neste aparelho).
 */

let app: FirebaseApp | null = null
let db: Database | null = null
let auth: Auth | null = null
let firstUser: Promise<User | null> | null = null
let signIn: Promise<string> | null = null

export class FirebaseSetupError extends Error {}

export function getDb(): Database {
  if (!firebaseConfig) {
    throw new FirebaseSetupError('O Firebase não está configurado neste app (variável FIREBASE_CONFIG ausente no build).')
  }
  if (!app) {
    app = initializeApp(firebaseConfig)
    db = getDatabase(app)
    auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
    // O Firebase restaura a sessão salva de forma assíncrona: espera a primeira resposta.
    firstUser = new Promise((resolve) => {
      const off = onAuthStateChanged(auth!, (u) => {
        off()
        resolve(u)
      })
    })
  }
  return db!
}

export function getFirebaseAuth(): Auth {
  getDb()
  return auth!
}

/** true para usuários que entraram com Discord (uid "discord_…"). */
export const isDiscordUid = (uid: string | null | undefined) => !!uid && uid.startsWith('discord_')

/** Garante um usuário autenticado (Discord salvo ou convidado anônimo). Retorna o uid. */
export function ensureSignedIn(): Promise<string> {
  getDb()
  if (auth!.currentUser) return Promise.resolve(auth!.currentUser.uid)
  if (!signIn) {
    signIn = firstUser!
      .then((u) => u ?? signInAnonymously(auth!).then((cred) => cred.user))
      .then((u) => u.uid)
      .catch((err: { code?: string }) => {
        signIn = null
        throw toSetupError(err)
      })
  }
  return signIn
}

/** Usuário atual já restaurado (ou null), sem criar convidado. */
export async function currentUser(): Promise<User | null> {
  getDb()
  return auth!.currentUser ?? (await firstUser!)
}

/** Entra com o token devolvido pelo serviço de login. */
export async function signInWithServerToken(token: string): Promise<string> {
  getDb()
  try {
    const cred = await signInWithCustomToken(auth!, token)
    signIn = null
    return cred.user.uid
  } catch (err) {
    throw toSetupError(err as { code?: string })
  }
}

/** Sai da conta (o próximo acesso ao banco entra como convidado). */
export async function signOutUser(): Promise<void> {
  getDb()
  signIn = null
  await signOut(auth!)
}

function toSetupError(err: { code?: string }): FirebaseSetupError {
  if (err?.code === 'auth/operation-not-allowed' || err?.code === 'auth/admin-restricted-operation') {
    return new FirebaseSetupError(
      'O login anônimo está desativado no Firebase. Ative em Authentication → Sign-in method → Anônimo.',
    )
  }
  if (err?.code === 'auth/network-request-failed') return new FirebaseSetupError('Sem conexão com a internet.')
  if (err?.code === 'auth/invalid-custom-token' || err?.code === 'auth/custom-token-mismatch') {
    return new FirebaseSetupError(
      'O serviço de login está com a conta de serviço errada. Confira FIREBASE_SERVICE_ACCOUNT no Cloudflare.',
    )
  }
  return new FirebaseSetupError(`Não foi possível entrar no Firebase (${err?.code ?? 'erro desconhecido'}).`)
}

/** Mensagem legível para erros do banco. */
export function describeDbError(err: unknown): string {
  if (err instanceof FirebaseSetupError) return err.message
  const code = String((err as { code?: string })?.code ?? (err as Error)?.message ?? '')
  if (/permission[_-]denied/i.test(code)) {
    return 'O Firebase recusou o acesso. Confira se as regras do banco foram publicadas.'
  }
  return (err as Error)?.message || 'Erro ao falar com o Firebase.'
}

export const isPermissionDenied = (err: unknown) =>
  /permission[_-]denied/i.test(String((err as { code?: string })?.code ?? (err as Error)?.message ?? ''))
