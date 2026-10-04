import { createElement } from 'react'
import { registerRootComponent } from 'expo'
import { CrashBoundary, CrashView, installCrashHandler } from './src/CrashScreen'

// Primeiro o tratamento de erros; depois o resto do app (carregado com require
// para que um erro ao carregar qualquer módulo também apareça na tela).
installCrashHandler()

let Root: () => ReturnType<typeof createElement>
try {
  require('./src/platform/polyfills')
  const App = require('./src/App').default
  Root = () => createElement(CrashBoundary, null, createElement(App))
} catch (err) {
  Root = () => createElement(CrashView, { error: err })
}

registerRootComponent(Root)
