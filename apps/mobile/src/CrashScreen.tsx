import { Component, type ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

/**
 * Em vez de fechar sozinho quando algo dá errado, o app mostra o erro na tela
 * (com o texto técnico para mandar a quem cuida do app).
 */

type Listener = (err: unknown) => void
let crashListener: Listener | null = null
let pendingCrash: unknown = null

/** Erros fora do React (promessas, timers, carregamento de módulos). */
export function installCrashHandler(): void {
  const eu = (globalThis as unknown as { ErrorUtils?: { getGlobalHandler(): (e: unknown, fatal?: boolean) => void; setGlobalHandler(h: (e: unknown, fatal?: boolean) => void): void } }).ErrorUtils
  if (!eu) return
  const previous = eu.getGlobalHandler()
  eu.setGlobalHandler((err, fatal) => {
    if (!fatal) return previous(err, fatal)
    if (crashListener) crashListener(err)
    else pendingCrash = err
  })
}

export function describeError(err: unknown): string {
  const e = err as { name?: string; message?: string; stack?: string }
  const head = `${e?.name ?? 'Erro'}: ${e?.message ?? String(err)}`
  const stack = (e?.stack ?? '').split('\n').slice(0, 12).join('\n')
  return stack.includes(e?.message ?? '§') ? stack : `${head}\n${stack}`
}

export function CrashView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const text = describeError(error)
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0b11', paddingTop: 56, paddingHorizontal: 20, gap: 14 }}>
      <Text style={{ color: '#ecebf7', fontSize: 22, fontWeight: '800' }}>O EchoRoom encontrou um erro</Text>
      <Text style={{ color: '#a3a4c2', fontSize: 15, lineHeight: 22 }}>
        Tire um print desta tela e mande para quem cuida do app. O texto abaixo diz o que falhou.
      </Text>
      <ScrollView style={{ flex: 1, backgroundColor: '#161724', borderRadius: 10 }} contentContainerStyle={{ padding: 14 }}>
        <Text selectable style={{ color: '#ff8aa0', fontSize: 12, fontFamily: 'monospace' }}>
          {text}
        </Text>
      </ScrollView>
      {onRetry ? (
        <Pressable onPress={onRetry} style={{ backgroundColor: '#7c5cff', borderRadius: 10, padding: 14, marginBottom: 32, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Tentar de novo</Text>
        </Pressable>
      ) : (
        <View style={{ height: 32 }} />
      )}
    </View>
  )
}

/** Envolve o app: erros de tela (React) e erros fatais globais viram a tela acima. */
export class CrashBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: pendingCrash as unknown }
  componentDidMount() {
    crashListener = (error) => this.setState({ error })
  }
  componentWillUnmount() {
    crashListener = null
  }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  render() {
    if (this.state.error) return <CrashView error={this.state.error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
