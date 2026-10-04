import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useStore } from '@web/stores/createStore'
import { watchInvites } from '@web/services/firebase/social'
import { authStore, initDiscordAuth } from './platform/discordAuth'
import { firebaseConfig } from './platform/firebaseConfig'
import { hydrateStorage, read, write } from './platform/storage'
import { HomeScreen } from './screens/HomeScreen'
import { LoginScreen } from './screens/LoginScreen'
import { RoomScreen } from './screens/RoomScreen'
import { SetupScreen } from './screens/SetupScreen'
import { colors } from './theme'

export type Route = { name: 'home' } | { name: 'room'; roomId: string; roomKey: string; displayName: string }

const GUEST_KEY = 'echoroom.guestOk'

/** Navegação simples: entrada (login) → início → sala. */
export default function App() {
  const [hydrated, setHydrated] = useState(false)
  const [route, setRoute] = useState<Route>({ name: 'home' })
  const [guest, setGuest] = useState(false)
  const { profile, ready } = useStore(authStore, (s) => s)

  useEffect(() => {
    void hydrateStorage().then(() => {
      setGuest(read(GUEST_KEY) === '1')
      setHydrated(true)
      initDiscordAuth()
    })
  }, [])

  useEffect(() => {
    if (hydrated) watchInvites(profile?.uid ?? null)
  }, [hydrated, profile?.uid])

  let screen
  if (!hydrated || (!ready && !profile)) {
    screen = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDeep }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  } else if (!firebaseConfig) {
    screen = <SetupScreen />
  } else if (!profile && !guest) {
    screen = (
      <LoginScreen
        onGuest={() => {
          write(GUEST_KEY, '1')
          setGuest(true)
        }}
      />
    )
  } else if (route.name === 'room') {
    screen = (
      <RoomScreen
        key={route.roomId}
        roomId={route.roomId}
        roomKey={route.roomKey}
        name={route.displayName}
        onLeave={() => setRoute({ name: 'home' })}
      />
    )
  } else {
    screen = (
      <HomeScreen
        onOpenRoom={(roomId, roomKey, displayName) => setRoute({ name: 'room', roomId, roomKey, displayName })}
        onSignedOut={() => {
          write(GUEST_KEY, null)
          setGuest(false)
        }}
      />
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: colors.bgDeep }}>{screen}</View>
    </SafeAreaProvider>
  )
}
