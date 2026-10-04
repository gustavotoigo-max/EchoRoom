import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRoomSession } from '@web/services/RoomSessionContext'
import { useStore } from '@web/stores/createStore'
import { roomStore, selectIsOwner } from '@web/stores/roomStore'
import { showToast } from '@web/stores/toastStore'
import { parseYouTubeLink } from '@web/utils/youtubeUrlParser'
import { colors, radius, space } from '../../theme'
import { IconButton } from '../ui'

/** Campo fixo embaixo: colar um link do YouTube (vídeo ou playlist) e adicionar. */
export function AddBar() {
  const session = useRoomSession()
  const locked = useStore(roomStore, (s) => s.settings.adding === 'owner' && !selectIsOwner(s))
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function add(url: string) {
    const link = parseYouTubeLink(url)
    if (link.kind === 'invalid') return showToast('Isso não parece um link do YouTube.', 'error', 3500)
    setBusy('Adicionando…')
    try {
      const res = await session.addTrack(url, { onProgress: (text) => setBusy(text) })
      setValue('')
      const extra = [res.repeated ? `${res.repeated} já estavam na fila` : '', res.skipped ? `${res.skipped} ficaram de fora` : ''].filter(Boolean).join('; ')
      showToast(
        res.added > 1 ? `${res.added} músicas adicionadas${extra ? ` (${extra})` : ''}.` : `"${res.title}" adicionada à fila.`,
        'ok',
        3500,
      )
    } catch (err) {
      showToast((err as Error).message || 'Não foi possível adicionar.', 'error', 4500)
    } finally {
      setBusy(null)
    }
  }

  async function paste() {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim()
    if (!text) return showToast('A área de transferência está vazia. Copie um link no YouTube.', 'info', 3500)
    setValue(text)
    if (parseYouTubeLink(text).kind !== 'invalid') void add(text)
  }

  if (locked) {
    return (
      <View style={s.bar}>
        <Text style={s.locked}>Nesta sala, só o dono adiciona músicas.</Text>
      </View>
    )
  }

  return (
    <View style={s.bar}>
      <IconButton icon="clipboard-outline" label="Colar link e adicionar" color={colors.accentHi} onPress={() => void paste()} disabled={!!busy} />
      <TextInput
        value={value}
        onChangeText={setValue}
        placeholder={busy ?? 'Cole um link do YouTube'}
        placeholderTextColor={busy ? colors.live : colors.textFaint}
        style={s.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="send"
        editable={!busy}
        onSubmitEditing={() => value.trim() && void add(value.trim())}
      />
      {busy ? (
        <View style={s.send}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <IconButton icon="add" label="Adicionar à fila" color="#fff" style={s.send} disabled={!value.trim()} onPress={() => void add(value.trim())} />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    backgroundColor: colors.bgDeeper,
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    color: colors.text,
    fontSize: 15,
  },
  send: { backgroundColor: colors.accent, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  locked: { flex: 1, color: colors.textMuted, fontSize: 14, textAlign: 'center', paddingVertical: space.sm },
})
