import { Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors } from '../theme'

/** O app foi gerado sem a configuração do Firebase. */
export function SetupScreen() {
  return (
    <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>Falta conectar o Firebase</Text>
      <Text style={{ color: colors.textMuted, fontSize: 15, lineHeight: 22 }}>
        Este app foi gerado sem a variável FIREBASE_CONFIG. No GitHub, confira as variáveis do repositório e gere o app de novo
        (Actions → Gerar app Android).
      </Text>
      <View />
    </SafeAreaView>
  )
}
