import { useEffect, useMemo, useState } from 'react'
import { AppState, BackHandler, KeyboardAvoidingView, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { RoomSession } from '@web/services/roomSession'
import { RoomSessionContext, useRoomSession } from '@web/services/RoomSessionContext'
import { forgetMyRoom } from '@web/services/firebase/social'
import { useStore } from '@web/stores/createStore'
import { playerStore } from '@web/stores/playerStore'
import { resetRoomStore, roomStore } from '@web/stores/roomStore'
import { roomLink } from '@web/utils/format'
import { storage } from '@web/utils/storage'
import { AddBar } from '../components/room/AddBar'
import { PeopleList, QueueList, SuggestionList } from '../components/room/Lists'
import { NowPlaying } from '../components/room/NowPlaying'
import { PlayerView } from '../components/room/PlayerView'
import { Button, Icon, IconButton, Toasts } from '../components/ui'
import { authStore } from '../platform/discordAuth'
import { addRecentRoom, forgetRecentRoom } from '../platform/storage'
import { colors, radius, space } from '../theme'

type Tab = 'queue' | 'suggestions' | 'people'

interface Props {
  roomId: string
  roomKey: string
  name: string
  onLeave: () => void
}

/** Sala: vídeo sincronizado, controles e abas de fila, sugestões e pessoas. */
export function RoomScreen({ roomId, roomKey, name, onLeave }: Props) {
  const session = useMemo(() => new RoomSession(roomId, roomKey, name, authStore.get().profile?.avatarUrl ?? null), [roomId, roomKey, name])
  const fatal = useStore(roomStore, (s) => s.fatalError)
  const removed = useStore(roomStore, (s) => s.removedReason)
  const [ended, setEnded] = useState<string | null>(null)

  useEffect(() => {
    session.start()
    return () => {
      session.stop()
      resetRoomStore()
      playerStore.set({ playerError: null })
    }
  }, [session])

  // Voltou para o app: reconfere relógio, posição e presença.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        session.backend.joinPresence()
        session.engine.wake()
      }
    })
    return () => sub.remove()
  }, [session])

  // Botão "voltar" do Android sai da sala.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onLeave()
      return true
    })
    return () => sub.remove()
  }, [onLeave])

  // Nome da sala na lista de recentes do início.
  const roomName = useStore(roomStore, (s) => s.meta?.name ?? null)
  useEffect(() => {
    if (roomName) addRecentRoom(roomId, roomName)
  }, [roomId, roomName])

  // Removido, bloqueado ou sala apagada: encerra com o motivo.
  useEffect(() => {
    const why = removed ?? (fatal === 'A sala não existe mais.' ? fatal : null)
    if (!why) return
    if (fatal === 'A sala não existe mais.') {
      storage.clearRoomKey(roomId)
      forgetRecentRoom(roomId)
      void forgetMyRoom(roomId).catch(() => {})
    }
    setEnded(why)
  }, [removed, fatal, roomId])

  if (ended) {
    return (
      <SafeAreaView style={[s.fill, { padding: space.xl, justifyContent: 'center', gap: space.lg }]}>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>{ended}</Text>
        <Button title="Voltar ao início" onPress={onLeave} />
      </SafeAreaView>
    )
  }

  return (
    <RoomSessionContext.Provider value={session}>
      <SafeAreaView style={s.fill} edges={['top', 'left', 'right', 'bottom']}>
        {/* Qualquer toque conta como uso da sala (pausa por inatividade). */}
        <KeyboardAvoidingView
          style={s.fill}
          behavior="padding"
          onTouchStart={session.noteActivity}
        >
          <Header roomId={roomId} onLeave={onLeave} />
          {fatal && fatal !== 'A sala não existe mais.' ? <Text style={s.banner}>{fatal}</Text> : null}
          <PlayerView />
          <NowPlaying />
          <Tabs />
          <AddBar />
        </KeyboardAvoidingView>
        <Toasts bottom={76} />
        <IdleModal />
      </SafeAreaView>
    </RoomSessionContext.Provider>
  )
}

function Header({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const roomName = useStore(roomStore, (s) => s.meta?.name ?? `Sala ${roomId}`)
  const conn = useStore(roomStore, (s) => s.connection)
  const sync = useStore(playerStore, (s) => s.sync)
  const tone = conn !== 'connected' ? colors.amber : sync === 'synced' ? colors.live : colors.sky
  const label = conn === 'connected' ? (sync === 'synced' ? 'Sincronizado' : 'Sincronizando…') : conn === 'reconnecting' ? 'Reconectando…' : 'Conectando…'
  return (
    <View style={s.header}>
      <IconButton icon="chevron-back" label="Sair da sala" color={colors.text} onPress={onLeave} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={s.roomName} numberOfLines={1}>
          {roomName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[s.dot, { backgroundColor: tone }]} />
          <Text style={s.status}>
            {roomId} · {label}
          </Text>
        </View>
      </View>
      <IconButton
        icon="share-social-outline"
        label="Convidar"
        color={colors.text}
        onPress={() =>
          void Share.share({
            message: `Vem ouvir comigo no EchoRoom: sala ${roomName} (código ${roomId}).\n${roomLink(roomId)}\nA senha eu te passo.`,
          })
        }
      />
    </View>
  )
}

function Tabs() {
  const [tab, setTab] = useState<Tab>('queue')
  const queueCount = useStore(roomStore, (s) => s.room?.queue.length ?? 0)
  const online = useStore(roomStore, (s) => s.room?.participants.filter((p) => p.connected).length ?? 0)
  const tabs: { id: Tab; label: string }[] = [
    { id: 'queue', label: `Fila${queueCount ? ` · ${queueCount}` : ''}` },
    { id: 'suggestions', label: 'Sugestões' },
    { id: 'people', label: `Pessoas${online ? ` · ${online}` : ''}` },
  ]
  return (
    <View style={s.fill}>
      <View style={s.tabs}>
        {tabs.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[s.tab, tab === t.id && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }}>
            <Text style={[s.tabText, tab === t.id && { color: colors.text }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.fill}>{tab === 'queue' ? <QueueList /> : tab === 'suggestions' ? <SuggestionList /> : <PeopleList />}</View>
    </View>
  )
}

/** Aviso de pausa por inatividade (mesma regra do site). */
function IdleModal() {
  const idle = useStore(roomStore, (s) => s.idle)
  const session = useRoomSession()
  return (
    <Modal visible={idle} transparent animationType="fade" statusBarTranslucent onRequestClose={session.resumeFromIdle}>
      <View style={s.modalBg}>
        <View style={s.modalCard}>
          <View style={s.modalIcon}>
            <Icon name="pause" size={22} />
          </View>
          <Text style={s.modalTitle}>Sala pausada por inatividade</Text>
          <Text style={s.modalText}>Ninguém interagiu com a sala por 1 hora. A música foi pausada e você saiu da lista de quem está ouvindo.</Text>
          <Button title="Voltar à sala" onPress={session.resumeFromIdle} />
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs, paddingVertical: 4, backgroundColor: colors.bgDeep },
  roomName: { color: colors.text, fontSize: 16, fontWeight: '800' },
  status: { color: colors.textMuted, fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  banner: { color: colors.text, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.red, padding: space.md, fontSize: 14 },
  tabs: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.lineSoft, paddingHorizontal: space.sm },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.md, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.accent },
  tabText: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  modalBg: { flex: 1, backgroundColor: 'rgba(6,6,12,0.78)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  modalCard: { width: '100%', maxWidth: 400, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.xl, gap: space.md, alignItems: 'stretch' },
  modalIcon: { alignSelf: 'center', width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center' },
  modalText: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
})
