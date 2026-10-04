import { useState } from 'react'
import { Image, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useStore } from '@web/stores/createStore'
import { storage } from '@web/utils/storage'
import { Button, ErrorText, Field } from '../components/ui'
import { authStore, discordEnabled, startDiscordLogin } from '../platform/discordAuth'
import { colors, space } from '../theme'

/** Entrada: Discord (recomendado) ou convidado com um nome. */
export function LoginScreen({ onGuest }: { onGuest: () => void }) {
  const { busy, error } = useStore(authStore, (s) => s)
  const [asGuest, setAsGuest] = useState(false)
  const [name, setName] = useState(storage.getName())
  const [guestError, setGuestError] = useState<string | null>(null)

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
            {discordEnabled && (
              <Button
                kind="discord"
                icon="logo-discord"
                title={busy ? 'Entrando…' : 'Entrar com Discord'}
                busy={busy}
                onPress={() => void startDiscordLogin()}
              />
            )}
            <Text style={s.small}>O Discord mostra só seu nome e avatar para o EchoRoom.</Text>
            <ErrorText>{error}</ErrorText>

            <View style={s.divider} />

            {asGuest ? (
              <View style={{ gap: space.md }}>
                <Field
                  label="Seu nome na sala"
                  value={name}
                  onChangeText={setName}
                  maxLength={32}
                  autoFocus
                  returnKeyType="done"
                  placeholder="Como os outros vão te ver"
                />
                <ErrorText>{guestError}</ErrorText>
                <Button
                  kind="secondary"
                  title="Continuar como convidado"
                  onPress={() => {
                    if (!name.trim()) return setGuestError('Digite um nome.')
                    storage.setName(name)
                    onGuest()
                  }}
                />
                <Text style={s.small}>Convidados entram em salas com código e senha, mas não criam salas.</Text>
              </View>
            ) : (
              <Button kind="ghost" title="Entrar como convidado" onPress={() => setAsGuest(true)} />
            )}
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
  small: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
  divider: { height: 1, backgroundColor: colors.lineSoft, marginVertical: space.sm },
})
