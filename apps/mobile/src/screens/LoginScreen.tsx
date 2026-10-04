import { useState } from 'react'
import { Image, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { storage } from '@web/utils/storage'
import { Button, ErrorText, Field } from '../components/ui'
import { colors, space } from '../theme'

/**
 * Entrada do app: só um nome. Para entrar numa sala basta o convite (ou o
 * código) e a senha. O login com Discord fica só no site.
 */
export function LoginScreen({ onGuest }: { onGuest: () => void }) {
  const [name, setName] = useState(storage.getName())
  const [error, setError] = useState<string | null>(null)

  function go() {
    if (!name.trim()) return setError('Digite um nome.')
    storage.setName(name)
    onGuest()
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <Image source={require('../../assets/icon.png')} style={s.logo} />
            <Text style={s.brand}>EchoRoom</Text>
            <Text style={s.tag}>Ouça músicas do YouTube junto com os amigos, no mesmo segundo.</Text>
          </View>

          <View style={s.actions}>
            <Field
              label="Como você quer aparecer na sala?"
              value={name}
              onChangeText={(v) => {
                setName(v)
                setError(null)
              }}
              maxLength={32}
              returnKeyType="go"
              onSubmitEditing={go}
              placeholder="Seu nome"
              autoCapitalize="words"
            />
            <ErrorText>{error}</ErrorText>
            <Button title="Continuar" onPress={go} />
            <Text style={s.small}>Depois é só colar o convite (ou digitar o código) e a senha da sala.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: 40 },
  hero: { alignItems: 'center', gap: space.md },
  logo: { width: 84, height: 84, borderRadius: 20 },
  brand: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  tag: { color: colors.textMuted, fontSize: 16, textAlign: 'center', lineHeight: 23, maxWidth: 300 },
  actions: { gap: space.md },
  small: { color: colors.textFaint, fontSize: 13, textAlign: 'center', lineHeight: 19 },
})
