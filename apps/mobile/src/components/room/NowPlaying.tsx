import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { usePlayback } from '@web/hooks/usePlayback'
import { useRoomSession } from '@web/services/RoomSessionContext'
import { useStore } from '@web/stores/createStore'
import { roomStore, selectIsOwner, validVotes, votesNeeded } from '@web/stores/roomStore'
import { showToast } from '@web/stores/toastStore'
import { formatTime } from '@web/utils/format'
import { colors, radius, space } from '../../theme'
import { Button, Equalizer, Icon, IconButton } from '../ui'

/** Barra de tempo (tocar para pular para um ponto), música atual e controles. */
export function NowPlaying() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const playback = useStore(roomStore, (s) => s.room?.playbackState ?? 'stopped')
  const connected = useStore(roomStore, (s) => s.connection === 'connected')
  const isOwner = useStore(roomStore, selectIsOwner)
  const settings = useStore(roomStore, (s) => s.settings)
  const voteCount = useStore(roomStore, (s) => validVotes(s).length)
  const voted = useStore(roomStore, (s) => validVotes(s).includes(s.participantId))
  const needed = useStore(roomStore, votesNeeded)
  const voterNames = useStore(roomStore, (s) => {
    const votes = new Set(validVotes(s))
    return (s.room?.participants ?? []).filter((p) => votes.has(p.id) && p.id !== s.participantId).map((p) => p.name).join(', ')
  })
  const shuffle = useStore(roomStore, (s) => s.room?.shuffle ?? false)
  const repeat = useStore(roomStore, (s) => s.room?.repeat ?? 'off')
  const pb = usePlayback()

  const locked = settings.controls === 'owner' && !isOwner
  const voting = settings.voteSkip && !isOwner
  const modesAllowed = settings.modes === 'all' || (settings.modes === 'owner' && isOwner)
  const disabled = !track || !connected

  const run = (action: () => Promise<unknown>) => {
    action().catch((err: Error) => showToast(err.message || 'Não foi possível.', 'error', 4000))
  }

  return (
    <View style={s.wrap}>
      <Progress />

      <View style={s.meta}>
        <View style={s.eyebrowRow}>
          <Equalizer on={playback === 'playing'} />
          <Text style={s.eyebrow}>{track ? (playback === 'playing' ? 'Tocando para a sala' : 'Pausado para a sala') : 'Sala em silêncio'}</Text>
        </View>
        <Text style={s.title} numberOfLines={2}>
          {track ? track.title : 'Nenhuma música tocando'}
        </Text>
        <Text style={s.sub} numberOfLines={1}>
          {track ? [track.author, `adicionada por ${track.addedBy}`].filter(Boolean).join(' · ') : 'A fila está vazia.'}
        </Text>
      </View>

      {settings.voteSkip && track && voteCount > 0 && (
        <View style={s.vote}>
          <Text style={s.voteText}>
            {voted ? 'Você votou para pular' : `${voterNames || 'Alguém'} quer pular.${isOwner ? '' : ' Pular?'}`}{' '}
            <Text style={{ color: colors.live, fontWeight: '800' }}>
              {voteCount}/{needed}
            </Text>
          </Text>
          {voted ? (
            <Button small kind="ghost" title="Desfazer" onPress={() => run(session.toggleVoteSkip)} />
          ) : isOwner ? (
            <Button small title="Pular agora" onPress={() => run(session.skip)} />
          ) : (
            <Button small title="Sim, pular" onPress={() => run(session.toggleVoteSkip)} />
          )}
        </View>
      )}

      <View style={s.controls}>
        {settings.modes !== 'off' ? (
          <IconButton
            icon="shuffle"
            label="Aleatório"
            active={shuffle}
            disabled={!connected || !modesAllowed}
            onPress={() => run(() => session.setModes({ shuffle: !shuffle }))}
          />
        ) : (
          <View style={{ width: 44 }} />
        )}
        <IconButton icon="play-skip-back" label="Voltar ao início" size={24} color={colors.text} disabled={disabled || locked} onPress={() => run(session.restart)} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pb.isPlaying ? 'Pausar' : 'Tocar'}
          disabled={pb.disabled}
          onPress={() => void pb.toggle((m) => showToast(m, 'error', 4000))}
          style={({ pressed }) => [s.play, { opacity: pb.disabled ? 0.4 : pressed ? 0.85 : 1 }, pb.pending && { backgroundColor: colors.surface3 }]}
        >
          <Icon name={pb.isPlaying ? 'pause' : 'play'} size={30} color={pb.pending ? colors.text : colors.bgDeep} />
        </Pressable>
        {voting ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={voted ? 'Tirar meu voto para pular' : 'Votar para pular'}
            disabled={disabled}
            onPress={() => run(session.toggleVoteSkip)}
            style={[s.voteBtn, voted && { backgroundColor: colors.accentTint, borderColor: colors.accent }, disabled && { opacity: 0.4 }]}
          >
            <Icon name="play-skip-forward" size={18} color={voted ? colors.live : colors.text} />
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 12 }}>
              {voteCount}/{needed}
            </Text>
          </Pressable>
        ) : (
          <IconButton icon="play-skip-forward" label="Próxima" size={24} color={colors.text} disabled={disabled || locked} onPress={() => run(session.skip)} />
        )}
        {settings.modes !== 'off' ? (
          <IconButton
            icon="repeat"
            label={repeat === 'one' ? 'Repetindo esta música' : repeat === 'all' ? 'Ciclando a fila' : 'Ciclar ou repetir'}
            active={repeat !== 'off'}
            disabled={!connected || !modesAllowed}
            onPress={() => run(() => session.setModes({ repeat: repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off' }))}
          />
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>
      {repeat === 'one' && settings.modes !== 'off' ? <Text style={s.repeatOne}>Repetindo esta música</Text> : null}
    </View>
  )
}

function Progress() {
  const session = useRoomSession()
  const track = useStore(roomStore, (s) => s.room?.currentTrack ?? null)
  const locked = useStore(roomStore, (s) => s.settings.controls === 'owner' && !selectIsOwner(s))
  const [pos, setPos] = useState(0)
  const [width, setWidth] = useState(1)
  const duration = track?.duration ?? 0

  useEffect(() => {
    const t = setInterval(() => setPos(session.getDisplayPosition()), 250)
    return () => clearInterval(t)
  }, [session])

  const frac = duration > 0 ? Math.max(0, Math.min(1, pos / duration)) : 0
  return (
    <View style={{ gap: 4 }}>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Posição da música"
        disabled={!track || !duration || locked}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)}
        onPress={(e) => {
          const target = (e.nativeEvent.locationX / width) * duration
          session.seek(target).catch((err: Error) => showToast(err.message, 'error', 4000))
        }}
        style={s.barHit}
      >
        <View style={s.bar}>
          <View style={[s.barFill, { width: `${frac * 100}%` }]} />
          <View style={[s.knob, { left: `${frac * 100}%` }]} />
        </View>
      </Pressable>
      <View style={s.times}>
        <Text style={s.time}>{formatTime(pos)}</Text>
        <Text style={s.time}>{duration ? formatTime(duration) : '–:––'}</Text>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: space.md, backgroundColor: colors.surface },
  meta: { gap: 3 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { color: colors.live, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', lineHeight: 23 },
  sub: { color: colors.textMuted, fontSize: 13 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.sm },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  voteBtn: {
    height: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  vote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    paddingLeft: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgDeeper,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  voteText: { flex: 1, color: colors.text, fontSize: 14 },
  repeatOne: { color: colors.live, fontSize: 12, textAlign: 'right', marginTop: -6, paddingRight: space.sm },
  barHit: { paddingVertical: 10 },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.surface3 },
  barFill: { height: 4, borderRadius: 2, backgroundColor: colors.accentHi },
  knob: { position: 'absolute', top: -4, width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: '#fff' },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  time: { color: colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
})
