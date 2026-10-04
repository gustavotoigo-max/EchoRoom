import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { usePlayback } from '@web/hooks/usePlayback'
import { useRoomSession } from '@web/services/RoomSessionContext'
import { useStore } from '@web/stores/createStore'
import { playerStore } from '@web/stores/playerStore'
import { roomStore } from '@web/stores/roomStore'
import { SITE_URL } from '../../platform/env'
import { WebViewPlayer, type PlayerCommand, type PlayerMessage } from '../../platform/webViewPlayer'
import { colors } from '../../theme'
import { Icon } from '../ui'

const PLAYER_URL = `${SITE_URL}/player.html`

/**
 * Vídeo da sala. O player do YouTube roda numa WebView (página player.html
 * do site) e é controlado pelo SyncEngine, igual ao site. Tocar no vídeo
 * dá play/pausa para a sala.
 */
export function PlayerView() {
  const videoOff = useStore(roomStore, (s) => s.settings.videoOff)
  const hasTrack = useStore(roomStore, (s) => !!s.room?.currentTrack)
  const error = useStore(playerStore, (s) => s.playerError)
  const ready = useStore(playerStore, (s) => s.playerReady)
  const needsGesture = useStore(playerStore, (s) => s.needsGesture)
  const session = useRoomSession()
  const pb = usePlayback()
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  return (
    <View style={s.frame}>
      <PlayerWebView />
      {/* Capa por cima: bloqueia os links do YouTube e vira o botão de play/pausa. */}
      <Pressable
        style={[StyleSheet.absoluteFill, videoOff && s.videoOff]}
        accessibilityRole="button"
        accessibilityLabel={pb.isPlaying ? 'Pausar' : 'Tocar'}
        disabled={pb.disabled}
        onPress={() => {
          setFlash(pb.isPlaying ? 'pause' : 'play')
          clearTimeout(flashTimer.current)
          flashTimer.current = setTimeout(() => setFlash(null), 700)
          void pb.toggle()
        }}
      >
        <View style={s.center}>
          {!hasTrack ? (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Icon name="musical-notes-outline" size={34} color={colors.textFaint} />
              <Text style={s.hint}>Adicione uma música para começar</Text>
            </View>
          ) : !ready ? (
            <ActivityIndicator color={colors.accent} />
          ) : videoOff ? (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Icon name="eye-off-outline" size={28} color={colors.textFaint} />
              <Text style={s.hint}>Vídeo desligado pelo dono · só áudio</Text>
            </View>
          ) : flash || !pb.isPlaying ? (
            <View style={s.bigBtn}>
              <Icon name={(flash ?? (pb.isPlaying ? 'pause' : 'play')) === 'pause' ? 'pause' : 'play'} size={30} color="#fff" />
            </View>
          ) : null}
        </View>
      </Pressable>
      {needsGesture ? (
        <Pressable style={[StyleSheet.absoluteFill, s.center, { backgroundColor: 'rgba(10,11,17,0.6)' }]} onPress={session.unlockAudio}>
          <View style={s.bigBtn}>
            <Icon name="volume-high" size={28} color="#fff" />
          </View>
          <Text style={[s.hint, { marginTop: 8 }]}>Toque para ouvir</Text>
        </Pressable>
      ) : null}
            {error ? (
        <View style={s.error} pointerEvents="none">
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** A WebView nunca re-renderiza: o vídeo é trocado por comandos. */
const PlayerWebView = memo(function PlayerWebView() {
  const session = useRoomSession()
  const web = useRef<WebView>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const player = useMemo(
    () =>
      new WebViewPlayer((cmd: PlayerCommand) => {
        web.current?.injectJavaScript(`window.__er && window.__er.run(${JSON.stringify(cmd)}); true;`)
      }),
    // Um player novo a cada recarga da página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reloadKey],
  )

  useEffect(() => () => session.detachPlayer(), [session, player])

  function onMessage(e: WebViewMessageEvent) {
    let msg: PlayerMessage
    try {
      msg = JSON.parse(e.nativeEvent.data) as PlayerMessage
    } catch {
      return
    }
    const out = player.receive(msg)
    if (msg.t === 'ready') session.attachPlayer(player)
    if (out.state) session.handlePlayerState(out.state)
    if (out.error !== undefined) {
      if (out.error === -1) playerStore.set({ playerError: 'Não foi possível carregar o player do YouTube. Confira a internet.' })
      else session.handlePlayerError(out.error)
    }
  }

  const reload = () => {
    session.detachPlayer()
    setReloadKey((k) => k + 1)
  }

  return (
    <WebView
      key={reloadKey}
      ref={web}
      source={{ uri: PLAYER_URL }}
      style={s.web}
      containerStyle={s.web}
      originWhitelist={['https://*']}
      javaScriptEnabled
      domStorageEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo={false}
      scrollEnabled={false}
      overScrollMode="never"
      setSupportMultipleWindows={false}
      onMessage={onMessage}
      // A página principal fica sempre no player: links do YouTube não abrem dentro do app.
      onShouldStartLoadWithRequest={(req) => req.isTopFrame === false || req.url.startsWith(SITE_URL) || req.url === 'about:blank'}
      onRenderProcessGone={reload}
      onContentProcessDidTerminate={reload}
      onError={() => playerStore.set({ playerError: 'Sem conexão para carregar o player. Tentando de novo…' })}
      onHttpError={(e) => {
        playerStore.set({
          playerError:
            e.nativeEvent.statusCode === 404
              ? 'O player do app ainda não foi publicado no site (player.html).'
              : 'O site do EchoRoom não respondeu. Tentando de novo…',
        })
        setTimeout(reload, 10_000)
      }}
    />
  )
})

const s = StyleSheet.create({
  frame: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  web: { flex: 1, backgroundColor: '#000' },
  videoOff: { backgroundColor: colors.bgDeeper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bigBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(10,11,17,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { color: colors.textMuted, fontSize: 14 },
  error: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(10,11,17,0.85)' },
  errorText: { color: colors.text, fontSize: 13 },
})
