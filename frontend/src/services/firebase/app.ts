import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'
import { firebaseConfig } from '../../config/firebase'

/** Inicialização única do Firebase e login anônimo. */

let app: FirebaseApp | null = null
let db: Database | null = null
let auth: Auth | null = null
let signIn: Promise<string> | null = null

export class FirebaseSetupError extends Error {}

export function getDb(): Database {
  if (!firebaseConfig) {
    throw new FirebaseSetupError('O Firebase não está configurado neste site (variável FIREBASE_CONFIG ausente).')
  }
  if (!app) {
    app = initializeApp(firebaseConfig)
    db = getDatabase(app)
    auth = getAuth(app)
  }
  return db!
}

/** Garante usuário anônimo autenticado. Retorna o uid. */
export function ensureSignedIn(): Promise<string> {
  getDb()
  if (!signIn) {
    signIn = signInAnonymously(auth!)
      .then((cred) => cred.user.uid)
      .catch((err: { code?: string }) => {
        signIn = null
        if (err?.code === 'auth/operation-not-allowed' || err?.code === 'auth/admin-restricted-operation') {
          throw new FirebaseSetupError(
            'O login anônimo está desativado no Firebase. Ative em Authentication → Sign-in method → Anônimo.',
          )
        }
        if (err?.code === 'auth/network-request-failed') {
          throw new FirebaseSetupError('Sem conexão com a internet.')
        }
        throw new FirebaseSetupError(`Não foi possível entrar no Firebase (${err?.code ?? 'erro desconhecido'}).`)
      })
  }
  return signIn
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
