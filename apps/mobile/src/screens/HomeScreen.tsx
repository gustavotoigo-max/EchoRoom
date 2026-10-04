import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { createRoom, joinRoom } from '@web/services/firebase/roomsApi'
import { acceptInvite, declineInvite, expiresIn, inviteStore, leaveRoom, subscribeMyRooms, type Invite, type MyRoom } from '@web/services/firebase/social'
import { useStore } from '@web/stores/createStore'
import { parseRoomInput } from '@web/utils/format'
import { storage } from '@web/utils/storage'
import { Avatar, Button, Card, ErrorText, Eyebrow, Field, Icon, IconButton, Toasts, type IconName } from '../components/ui'
import { authStore, logoutDiscord } from '../platform/discordAuth'
import { addRecentRoom, getRecentRooms } from '../platform/storage'
import { colors, radius, space } from '../theme'

interface Props {
  onOpenRoom: (roomId: string, roomKey: string, displayName: string) => void
  onSignedOut: () => void
}

/** Início: entrar com convite (link ou código) e senha; salas recentes. */
export function HomeScreen({ onOpenRoom, onSignedOut }: Props) {
  const profile = useStore(authStore, (s) => s.profile)
  const invites = useStore(inviteStore, (s) => s.invites)
  const [rooms, setRooms] = useState<MyRoom[] | null>(null)
  const [roomsError, setRoomsError] = useState(false)
  const [creating, setCreating] = useState(false)
  const displayName = profile?.name || storage.getName() || 'Convidado'

  useEffect(() => {
    if (!profile) return
    setRooms(null)
    return subscribeMyRooms(profile.uid, setRooms, () => setRoomsError(true))
  }, [profile])

  function open(roomId: string, key: string) {
    storage.setRoomKey(roomId, key)
    addRecentRoom(roomId)
    onOpenRoom(roomId, key, displayName)
  }

  function signOut() {
    Alert.alert(profile ? 'Sair' : 'Trocar de nome', profile ? 'Sair da conta do Discord neste aparelho?' : 'Voltar para a tela do nome?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: profile ? 'Sair' : 'Trocar',
        style: 'destructive',
        onPress: async () => {
          if (profile) await logoutDiscord()
          onSignedOut()
        },
      },
    ])
  }

  const recent = getRecentRooms().filter((r) => storage.getRoomKey(r.roomId))

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={s.top}>
          <Avatar uri={profile?.avatarUrl} name={displayName} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={s.hello} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={s.sub}>{profile ? `@${profile.username} · Discord` : 'Ouvindo como convidado'}</Text>
          </View>
          <IconButton icon={profile ? 'log-out-outline' : 'create-outline'} label={profile ? 'Sair' : 'Trocar de nome'} onPress={signOut} />
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

          <View style={{ gap: space.sm }}>
            <Eyebrow>Entrar numa sala</Eyebrow>
            <JoinForm onJoined={open} />
          </View>

          {recent.length > 0 && (
            <View style={{ gap: space.sm }}>
              <Eyebrow>Salas recentes</Eyebrow>
              {recent.map((r) => (
                <RoomRow key={r.roomId} name={r.name || `Sala ${r.roomId}`} meta={r.roomId} icon="time-outline" onPress={() => open(r.roomId, storage.getRoomKey(r.roomId)!)} />
              ))}
            </View>
          )}

          {/* Contas do Discord já conectadas antes continuam funcionando no app. */}
          {profile && (
            <View style={{ gap: space.sm }}>
              <Eyebrow>Minhas salas{rooms ? ` · ${rooms.length}` : ''}</Eyebrow>
              {roomsError ? (
                <Text style={s.empty}>Não foi possível carregar suas salas.</Text>
              ) : rooms === null ? (
                <View style={[s.roomCard, { height: 72, opacity: 0.4 }]} />
              ) : (
                rooms.map((r) => (
                  <RoomRow
                    key={r.roomId}
                    name={r.name}
                    meta={`${r.roomId} · ${r.role === 'owner' ? 'dono' : 'membro'}`}
                    icon={r.role === 'owner' ? 'star' : 'musical-notes'}
                    owner={r.role === 'owner'}
                    onPress={() => open(r.roomId, r.key)}
                    onLongPress={() =>
                      r.role !== 'owner' &&
                      Alert.alert(r.name, 'Tirar esta sala da sua lista?', [
                        { text: 'Cancelar', style: 'cancel' },
                        { text: 'Sair da sala', style: 'destructive', onPress: () => void leaveRoom(r).catch(() => {}) },
                      ])
                    }
                  />
                ))
              )}
              <Button kind="secondary" icon="add" title={creating ? 'Fechar' : 'Criar sala'} onPress={() => setCreating(!creating)} />
              {creating && <CreateForm ownerName={profile.name} onCreated={open} />}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Toasts />
    </SafeAreaView>
  )
}

function RoomRow({
  name,
  meta,
  icon,
  owner,
  onPress,
  onLongPress,
}: {
  name: string
  meta: string
  icon: IconName
  owner?: boolean
  onPress: () => void
  onLongPress?: () => void
}) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={({ pressed }) => [s.roomCard, pressed && { backgroundColor: colors.surface2 }]}>
      <View style={[s.roomIcon, owner && { backgroundColor: 'rgba(240,181,74,0.14)' }]}>
        <Icon name={icon} size={18} color={owner ? colors.amber : colors.accentHi} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.roomName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.roomMeta}>{meta}</Text>
      </View>
      <Icon name="chevron-forward" size={18} color={colors.textFaint} />
    </Pressable>
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

  async function pasteInvite() {
    const text = await Clipboard.getStringAsync().catch(() => '')
    const id = parseRoomInput(text)
    if (!id) return setError('Não achei um convite do EchoRoom na área de transferência. Copie o link que te mandaram.')
    setCode(id)
    setError(null)
  }

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
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Convite ou código da sala"
            value={code}
            onChangeText={(v) => {
              // Colou o link (ou a mensagem inteira do convite): fica só o código.
              const id = v.length > 12 ? parseRoomInput(v) : null
              setCode(id ?? v)
              setError(null)
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Ex.: ABX72"
          />
        </View>
        <Button kind="secondary" icon="clipboard-outline" title="Colar" style={{ minHeight: 48 }} onPress={() => void pasteInvite()} />
      </View>
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
