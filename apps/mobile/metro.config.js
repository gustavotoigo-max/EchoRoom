// Metro (empacotador do React Native) configurado para reaproveitar o código do site.
// (Os "paths" do tsconfig.json valem só para a checagem de tipos: app.json desliga
// experiments.tsconfigPaths e a resolução real fica toda aqui.)
//
// O app importa direto de apps/web/src (regras da sala, sincronização, Firebase)
// com "@web/...". As poucas partes que dependem do navegador (localStorage,
// import.meta.env, WebCrypto, DOM) são trocadas aqui pelas versões do celular
// em src/platform, sem mudar o código do site.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const ROOT = __dirname
const WEB = path.resolve(ROOT, '../web/src')
const SHARED = path.resolve(ROOT, '../../packages/shared/src')
const PLATFORM = path.resolve(ROOT, 'src/platform')

/** Módulo do site (sem extensão) → versão do celular. */
const OVERRIDES = {
  'utils/storage': 'storage.ts',
  'utils/format': 'format.ts',
  'config/firebase': 'firebaseConfig.ts',
  'services/firebase/app': 'firebaseApp.ts',
  'services/firebase/roomCrypto': 'roomCrypto.ts',
  'services/firebase/usage': 'usage.ts',
  'services/externalAdd': 'externalAdd.ts',
  'services/discordAuth': 'discordAuth.ts',
  'services/youtube/playlist': 'ytPlaylist.ts',
}
const overrideFor = new Map(Object.entries(OVERRIDES).map(([web, mobile]) => [path.join(WEB, web), path.join(PLATFORM, mobile)]))

const config = getDefaultConfig(ROOT)

config.watchFolders = [WEB, SHARED]
// Pacotes importados pelo código do site também vêm do node_modules do app.
config.resolver.nodeModulesPaths = [path.resolve(ROOT, 'node_modules')]
const APP_ORIGIN = path.join(ROOT, 'index.ts')
// Firebase JS SDK no React Native (recomendação da Expo).
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs']
config.resolver.unstable_enablePackageExports = false

const stripExt = (p) => p.replace(/\.(tsx?|jsx?)$/, '')

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@echoroom/shared') return { type: 'sourceFile', filePath: path.join(SHARED, 'index.ts') }

  let target = moduleName
  if (moduleName.startsWith('@web/')) target = path.join(WEB, moduleName.slice('@web/'.length))
  else if (moduleName.startsWith('.') && context.originModulePath.startsWith(WEB + path.sep)) {
    target = path.resolve(path.dirname(context.originModulePath), moduleName)
  }
  if (path.isAbsolute(target)) {
    const swap = overrideFor.get(stripExt(target))
    if (swap) return { type: 'sourceFile', filePath: swap }
    return context.resolveRequest(context, target, platform)
  }
  // Pacote (react, firebase…) importado de um arquivo do site: resolve como se
  // fosse importado pelo app, para nunca pegar uma cópia de fora (ex.: React do site).
  if (context.originModulePath.startsWith(WEB + path.sep) || context.originModulePath.startsWith(SHARED + path.sep)) {
    return context.resolveRequest({ ...context, originModulePath: APP_ORIGIN }, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
