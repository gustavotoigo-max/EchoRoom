import { useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { createRoom, joinRoom } from '@web/services/firebase/roomsApi'
import { acceptInvite, declineInvite, expiresIn, inviteStore, leaveRoom, subscribeMyRooms, type Invite, type MyRoom } from '@web/services/firebase/social'
import { useStore } from '@web/stores/createStore'
import { parseRoomInput } from '@web/utils/format'
import { storage } from '@web/utils/storage'
import { Avatar, Button, Card, ErrorText, Eyebrow, Field, Icon, IconButton, Toasts } from '../components/ui'
import { authStore, logoutDiscord, startDiscordLogin } from '../platform/discordAuth'
import { colors, radius, space } from '../theme'

interface Props {
  onOpenRoom: (roomId: string, roomKey: string, displayName: string) => void
  onSignedOut: () => void
}

/** Início: convites, minhas salas, entrar com código e criar sala. */
export function HomeScreen({ onOpenRoom, onSignedOut }: Props) {
  const profile = useStore(authStore, (s) => s.profile)
  const invites = useStore(inviteStore, (s) => s.invites)
  const [rooms, setRooms] = useState<MyRoom[] | null>(null)
  const [roomsError, setRoomsError] = useState(false)
  const [panel, setPanel] = useState<'join' | 'create' | null>(null)
  const displayName = profile?.name || storage.getName() || 'Convidado'

  useEffect(() => {
    if (!profile) return
    setRooms(null)
    return subscribeMyRooms(profile.uid, setRooms, () => setRoomsError(true))
  }, [profile])

  function open(roomId: string, key: string) {
    storage.setRoomKey(roomId, key)
    onOpenRoom(roomId, key, displayName)
  }

  function signOut() {
    Alert.alert('Sair', profile ? 'Sair da conta do Discord neste aparelho?' : 'Trocar de nome ou entrar com Discord?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: async () => {
          if (profile) await logoutDiscord()
          onSignedOut()
        },
      },
    ])
  }

  const lastRoom = !profile ? storage.getLastRoom() : null
  const lastKey = lastRoom ? storage.getRoomKey(lastRoom) : null

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={s.top}>
          <Avatar uri={profile?.avatarUrl} name={displayName} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.hello} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={s.sub}>{profile ? `@${profile.username} · Discord` : 'Convidado'}</Text>
          </View>
          <IconButton icon="log-out-outline" label="Sair" onPress={signOut} />
        </View>

        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          {invites.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Eyebrow color={colors.live}>Convites · {invites.length}</Eyebrow>
              {invites.map((inv) => (
                <InviteRow key={inv.id} invite={inv} onOpen={open} />
              ))}
            </View>
          )}

          <View style={s.row}>
            <Button style={{ flex: 1 }} icon="enter-outline" title="Entrar" kind={panel === 'join' ? 'primary' : 'secondary'} onPress={() => setPanel(panel === 'join' ? null : 'join')} />
            <Button style={{ flex: 1 }} icon="add" title="Criar sala" kind={panel === 'create' ? 'primary' : 'secondary'} onPress={() => setPanel(panel === 'create' ? null : 'create')} />
          </View>
          {panel === 'join' && <JoinForm onJoined={open} />}
          {panel === 'create' && (profile ? <CreateForm ownerName={profile.name} onCreated={open} /> : <GuestCreate />)}

          {profile ? (
            <View style={{ gap: space.sm }}>
              <Eyebrow>Minhas salas{rooms ? ` · ${rooms.length}` : ''}</Eyebrow>
              {roomsError ? (
                <Text style={s.empty}>Não foi possível carregar suas salas.</Text>
              ) : rooms === null ? (
                <View style={[s.roomCard, { height: 72, opacity: 0.4 }]} />
              ) : rooms.length === 0 ? (
                <Text style={s.empty}>As salas em que você entrar com Discord aparecem aqui. Crie uma ou entre com um código.</Text>
              ) : (
                rooms.map((r) => (
                  <Pressable
                    key={r.roomId}
                    onPress={() => open(r.roomId, r.key)}
                    onLongPress={() =>
                      r.role !== 'owner' &&
                      Alert.alert(r.name, 'Tirar esta sala da sua lista?', [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Sair da sala', style: 'destructive', onPress: () => void leaveRoom(r).catch(() => {}) },
                      ])
                    }
                    style={({ pressed }) => [s.roomCard, pressed && { backgroundColor: colors.surface2 }]}
                  >
                    <View style={[s.roomIcon, r.role === 'owner' && { backgroundColor: 'rgba(240,181,74,0.14)' }]}>
                      <Icon name={r.role === 'owner' ? 'star' : 'musical-notes'} size={18} color={r.role === 'owner' ? colors.amber : colors.accentHi} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.roomName} numberOfLines={1}>
                        {r.name}
                      </Text>
                      <Text style={s.roomMeta}>
                        {r.roomId} · {r.role === 'owner' ? 'dono' : 'membro'}
                      </Text>
                    </View>
                    <Icon name="chevron-forward" size={18} color={colors.textFaint} />
                  </Pressable>
                ))
              )}
            </View>
          ) : (
            <Card>
              {lastRoom && lastKey ? (
                <Button kind="secondary" icon="play" title={`Voltar à sala ${lastRoom}`} onPress={() => open(lastRoom, lastKey)} />
              ) : null}
              <Text style={s.empty}>Com Discord você cria salas, recebe convites e suas salas ficam salvas.</Text>
              <Button kind="discord" icon="logo-discord" title="Entrar com Discord" onPress={() => void startDiscordLogin()} />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Toasts />
    </SafeAreaView>
  )
}

function InviteRow({ invite, onOpen }: { invite: Invite; onOpen: (roomId: string, key: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card style={{ gap: space.sm }}>
      <View style={s.row}>
        <Avatar uri={invite.fromAvatar} name={invite.fromName} size={32} />
        <Text style={{ flex: 1, color: colors.text, fontSize: 15 }}>
          <Text style={{ fontWeight: '700' }}>{invite.fromName}</Text> te convidou para <Text style={{ fontWeight: '700' }}>{invite.roomName}</Text>
        </Text>
      </View>
      <Text style={s.roomMeta}>{expiresIn(invite)}</Text>
      <ErrorText>{error}</ErrorText>
      <View style={s.row}>
        <Button
          small
          style={{ flex: 1 }}
          title="Aceitar e entrar"
          busy={busy}
          onPress={async () => {
            setBusy(true)
            try {
              await acceptInvite(invite)
              onOpen(invite.roomId, invite.roomKey)
            } catch (err) {
              setError((err as Error).message)
              setBusy(false)
            }
          }}
        />
        <Button small kind="secondary" title="Recusar" onPress={() => void declineInvite(invite).catch(() => {})} />
      </View>
    </Card>
  )
}

function JoinForm({ onJoined }: { onJoined: (roomId: string, key: string) => void }) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const roomId = parseRoomInput(code)
  const savedKey = roomId ? storage.getRoomKey(roomId) : null

  async function submit() {
    if (!roomId) return setError('Digite o código da sala (ou cole o link).')
    if (savedKey) return onJoined(roomId, savedKey)
    if (!password) return setError('Digite a senha da sala.')
    setBusy(true)
    setError(null)
    try {
      const access = await joinRoom(roomId, password)
      onJoined(access.roomId, access.roomKey)
    } catch (err) {
      setError((err as Error).message || 'Não foi possível entrar.')
      setBusy(false)
    }
  }

  return (
    <Card>
      <Field label="Código ou link da sala" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="Ex.: ABX72" />
      {!savedKey && (
        <Field label="Senha da sala" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} returnKeyType="go" />
      )}
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? 'Conferindo a senha…' : 'Entrar e ouvir'} busy={busy} onPress={submit} />
    </Card>
  )
}

function CreateForm({ ownerName, onCreated }: { ownerName: string; onCreated: (roomId: string, key: string) => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const access = await createRoom(name, password, ownerName)
      onCreated(access.roomId, access.roomKey)
    } catch (err) {
      setError((err as Error).message || 'Não foi possível criar a sala.')
      setBusy(false)
    }
  }

  return (
    <Card>
      <Field label="Nome da sala" value={name} onChangeText={setName} maxLength={40} placeholder="Ex.: Noite de sexta" />
      <Field label="Senha (quem entrar vai precisar)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
      <ErrorText>{error}</ErrorText>
      <Button title={busy ? 'Criando…' : 'Criar e entrar'} busy={busy} onPress={submit} />
    </Card>
  )
}

function GuestCreate() {
  return (
    <Card>
      <Text style={s.empty}>Para criar uma sala, entre com Discord: o dono precisa de uma conta fixa para administrar a sala.</Text>
      <Button kind="discord" icon="logo-discord" title="Entrar com Discord" onPress={() => void startDiscordLogin()} />
    </Card>
  )
}

const s = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  hello: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: 13 },
  wrap: { padding: space.lg, gap: space.xl, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.lineSoft,
  },
  roomIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  roomName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  roomMeta: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
})
