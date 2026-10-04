import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRoomSession } from '@web/services/RoomSessionContext'
import { kickParticipant, banParticipant } from '@web/services/firebase/roomsApi'
import { subscribeLibrary, type LibraryEntry } from '@web/services/firebase/library'
import { thumbnailUrl } from '@web/services/youtube/metadata'
import { useStore } from '@web/stores/createStore'
import { roomStore, selectIsOwner } from '@web/stores/roomStore'
import { showToast } from '@web/stores/toastStore'
import type { Participant, QueueItem } from '@web/types/room'
import { colors, radius, space } from '../../theme'
import { Avatar, Equalizer, Icon, IconButton } from '../ui'

const fail = (err: unknown) => showToast((err as Error).message || 'Não foi possível.', 'error', 4000)

// ---- Fila --------------------------------------------------------------------------------

export function QueueList() {
  const session = useRoomSession()
  const queue = useStore(roomStore, (s) => s.room?.queue ?? null)
  const current = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')
  const me = useStore(roomStore, (s) => s.participantId)
  const isOwner = useStore(roomStore, selectIsOwner)
  const canMove = useStore(roomStore, (s) => s.settings.controls === 'all' || selectIsOwner(s))

  if (queue === null) return <Loading />

  function menu(item: QueueItem, index: number) {
    const canRemove = isOwner || item.addedByUid === me
    const options: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = []
    if (canMove && index > 0) options.push({ text: 'Tocar a seguir', onPress: () => session.moveToTop(item.id).catch(fail) })
    if (canMove && index < queue!.length - 1)
      options.push({ text: 'Mandar para o fim', onPress: () => session.moveTrack(item.id, queue!.length - 1).catch(fail) })
    if (canRemove) options.push({ text: 'Remover da fila', style: 'destructive', onPress: () => session.removeTrack(item.id).catch(fail) })
    if (!options.length) return showToast('Só o dono da sala ou quem adicionou pode mexer nesta música.', 'info', 3500)
    options.push({ text: 'Cancelar', style: 'cancel' })
    Alert.alert(item.title, `adicionada por ${item.addedBy}`, options)
  }

  return (
    <FlatList
      data={queue}
      keyExtractor={(q) => q.id}
      contentContainerStyle={s.listPad}
      ListHeaderComponent={
        current ? (
          <View style={[s.row, s.nowRow]}>
            <Thumb videoId={current.videoId} />
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {current.title}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Equalizer on={playing} />
                <Text style={[s.rowSub, { color: colors.live }]}>Tocando agora · {current.addedBy}</Text>
              </View>
            </View>
          </View>
        ) : null
      }
      ListEmptyComponent={<Text style={s.empty}>{current ? 'Nada depois desta. Adicione um link abaixo.' : 'A fila está vazia. Cole um link do YouTube abaixo.'}</Text>}
      renderItem={({ item, index }) => (
        <Pressable onPress={() => menu(item, index)} style={({ pressed }) => [s.row, pressed && s.pressed]}>
          <Text style={s.index}>{index + 1}</Text>
          <Thumb videoId={item.videoId} />
          <View style={s.rowText}>
            <Text style={s.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={s.rowSub} numberOfLines={1}>
              {item.addedBy}
            </Text>
          </View>
          <Icon name="ellipsis-vertical" size={18} color={colors.textFaint} />
        </Pressable>
      )}
    />
  )
}

// ---- Sugestões (músicas que já tocaram na sala) -----------------------------------------------

export function SuggestionList() {
  const session = useRoomSession()
  const currentVideo = useStore(roomStore, (s) => s.room?.currentTrack?.videoId ?? null)
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<'top' | 'recent'>('top')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => subscribeLibrary(session.backend.roomKey, setEntries, setError), [session])

  const list = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.kind === 'track')
        .sort((a, b) => (order === 'top' ? b.count - a.count || b.lastAt - a.lastAt : b.lastAt - a.lastAt)),
    [entries, order],
  )

  async function add(e: LibraryEntry) {
    setBusy(e.id)
    try {
      await session.addTrack(`https://www.youtube.com/watch?v=${e.id}`, { title: e.title })
      showToast(`"${e.title}" adicionada à fila.`, 'ok', 3000)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  if (error) return <Text style={s.empty}>{error}</Text>
  if (entries === null) return <Loading />
  return (
    <FlatList
      data={list}
      keyExtractor={(e) => e.id}
      contentContainerStyle={s.listPad}
      ListHeaderComponent={
        <View style={s.seg}>
          {(['top', 'recent'] as const).map((o) => (
            <Pressable key={o} onPress={() => setOrder(o)} style={[s.segBtn, order === o && s.segOn]}>
              <Text style={[s.segText, order === o && { color: colors.live }]}>{o === 'top' ? 'Mais tocadas' : 'Recentes'}</Text>
            </Pressable>
          ))}
        </View>
      }
      ListEmptyComponent={<Text style={s.empty}>As músicas que tocarem nesta sala aparecem aqui para tocar de novo com um toque.</Text>}
      renderItem={({ item }) => {
        const isCurrent = item.id === currentVideo
        return (
          <Pressable onPress={() => void add(item)} disabled={busy === item.id} style={({ pressed }) => [s.row, isCurrent && s.nowRow, pressed && s.pressed]}>
            <Thumb videoId={item.id} />
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={[s.rowSub, isCurrent && { color: colors.live }]} numberOfLines={1}>
                {isCurrent ? 'Tocando agora' : item.kind === 'track' && item.author ? item.author : `${item.count}× na sala`}
              </Text>
            </View>
            {busy === item.id ? <ActivityIndicator color={colors.accent} /> : <Icon name="add-circle-outline" size={22} color={colors.accentHi} />}
          </Pressable>
        )
      }}
    />
  )
}

// ---- Pessoas ------------------------------------------------------------------------------

export function PeopleList() {
  const session = useRoomSession()
  const people = useStore(roomStore, (s) => s.room?.participants ?? null)
  const me = useStore(roomStore, (s) => s.participantId)
  const ownerUid = useStore(roomStore, (s) => s.meta?.ownerUid ?? null)
  const iAmOwner = useStore(roomStore, selectIsOwner)
  const playing = useStore(roomStore, (s) => s.room?.playbackState === 'playing')
  if (people === null) return <Loading />

  const online = people.filter((p) => p.connected)
  const away = people.filter((p) => !p.connected)
  const sections: (Participant | string)[] = [`Ouvindo · ${online.length}`, ...online, ...(away.length ? [`Desconectados · ${away.length}`, ...away] : [])]

  function moderate(p: Participant) {
    Alert.alert(p.name, 'O que fazer com esta pessoa?', [
      { text: 'Remover da sala', onPress: () => kickParticipant(session.backend.roomKey, p.id).then(() => showToast(`${p.name} foi removido.`, 'info', 3000), fail) },
      { text: 'Bloquear', style: 'destructive', onPress: () => banParticipant(session.backend.roomKey, p.id, p.name).then(() => showToast(`${p.name} foi bloqueado.`, 'info', 3000), fail) },
      { text: 'Cancelar', style: 'cancel' },
    ])
  }

  return (
    <FlatList
      data={sections}
      keyExtractor={(x) => (typeof x === 'string' ? x : x.id)}
      contentContainerStyle={s.listPad}
      renderItem={({ item }) =>
        typeof item === 'string' ? (
          <Text style={s.section}>{item}</Text>
        ) : (
          <View style={[s.row, !item.connected && { opacity: 0.5 }]}>
            <View>
              <Avatar uri={item.avatar} name={item.name} size={36} />
              <View style={[s.dot, { backgroundColor: item.connected ? colors.live : colors.textFaint }]} />
            </View>
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {item.name}
                {item.id === ownerUid ? '  👑' : ''}
              </Text>
              <Text style={s.rowSub}>{item.id === me ? 'você' : item.guest ? 'convidado' : 'Discord'}</Text>
            </View>
            {item.connected && <Equalizer on={playing} />}
            {iAmOwner && item.id !== me ? <IconButton icon="ellipsis-vertical" label={`Opções para ${item.name}`} size={18} onPress={() => moderate(item)} /> : null}
          </View>
        )
      }
    />
  )
}

// ---- partes ------------------------------------------------------------------------------

function Thumb({ videoId }: { videoId: string }) {
  return <Image source={{ uri: thumbnailUrl(videoId) }} style={s.thumb} />
}

function Loading() {
  return (
    <View style={{ padding: space.xl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  )
}

const s = StyleSheet.create({
  listPad: { paddingVertical: space.sm, paddingBottom: space.xl },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8 },
  nowRow: { backgroundColor: colors.accentTint, borderLeftWidth: 2, borderLeftColor: colors.live },
  pressed: { backgroundColor: colors.surface2 },
  index: { width: 18, color: colors.textFaint, fontSize: 13, textAlign: 'center' },
  thumb: { width: 64, height: 36, borderRadius: 4, backgroundColor: colors.surface3 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: colors.textFaint, fontSize: 12 },
  empty: { color: colors.textMuted, fontSize: 14, lineHeight: 21, padding: space.lg },
  section: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: 4 },
  dot: { position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bg },
  seg: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  segBtn: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  segOn: { backgroundColor: colors.liveTint },
  segText: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
})
