import { Ionicons } from '@expo/vector-icons'
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { useStore } from '@web/stores/createStore'
import { dismissToast, toastStore } from '@web/stores/toastStore'
import { colors, radius, space } from '../theme'

export type IconName = ComponentProps<typeof Ionicons>['name']

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />
}

type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'discord'

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  busy,
  style,
  small,
}: {
  title: string
  onPress?: () => void
  kind?: ButtonKind
  icon?: IconName
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
  small?: boolean
}) {
  const bg =
    kind === 'primary' ? colors.accent : kind === 'discord' ? colors.discord : kind === 'danger' ? colors.red : kind === 'secondary' ? colors.surface2 : 'transparent'
  const fg = kind === 'secondary' || kind === 'ghost' ? colors.text : '#fff'
  const off = disabled || busy
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, borderColor: kind === 'secondary' ? colors.line : bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={small ? 16 : 19} color={fg} /> : null}
      <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }]} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  )
}

export function IconButton({
  icon,
  onPress,
  label,
  size = 22,
  color = colors.textMuted,
  disabled,
  active,
  style,
}: {
  icon: IconName
  onPress?: () => void
  label: string
  size?: number
  color?: string
  disabled?: boolean
  active?: boolean
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconBtn,
        active && { backgroundColor: colors.accentTint },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={active ? colors.live : color} />
    </Pressable>
  )
}

export function Field({ label, style, ...props }: TextInputProps & { label?: string; style?: StyleProp<TextStyle> }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.textFaint} selectionColor={colors.accent} style={[styles.input, style]} {...props} />
    </View>
  )
}

export function Avatar({ uri, name, size = 36 }: { uri?: string | null; name: string; size?: number }) {
  const s = { width: size, height: size, borderRadius: size / 2 }
  if (uri) return <Image source={{ uri }} style={[s, { backgroundColor: colors.surface3 }]} />
  return (
    <View style={[s, styles.avatarFallback]}>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: size * 0.42 }}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  )
}

export function Eyebrow({ children, color = colors.textMuted, style }: { children: ReactNode; color?: string; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.eyebrow, { color }, style]}>{children}</Text>
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null
  return <Text style={styles.error}>{children}</Text>
}

/** Barrinhas animadas (como no site) quando a sala está tocando. */
export function Equalizer({ on, color = colors.live }: { on: boolean; color?: string }) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current
  useEffect(() => {
    if (!on) {
      bars.forEach((b) => b.setValue(0.35))
      return
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 320 + i * 90, useNativeDriver: true }),
          Animated.timing(b, { toValue: 0.25, duration: 300 + i * 70, useNativeDriver: true }),
        ]),
      ),
    )
    loops.forEach((l) => l.start())
    return () => loops.forEach((l) => l.stop())
  }, [on, bars])
  return (
    <View style={styles.eq}>
      {bars.map((b, i) => (
        <Animated.View key={i} style={[styles.eqBar, { backgroundColor: color, transform: [{ scaleY: b }] }]} />
      ))}
    </View>
  )
}

/** Avisos curtos (mesma fila de avisos do site). */
export function Toasts({ bottom = 24 }: { bottom?: number }) {
  const toasts = useStore(toastStore, (s) => s.toasts)
  if (!toasts.length) return null
  return (
    <View pointerEvents="box-none" style={[styles.toasts, { bottom }]}>
      {toasts.map((t) => (
        <Pressable
          key={t.id}
          onPress={() => dismissToast(t.id)}
          style={[styles.toast, { borderLeftColor: t.kind === 'error' ? colors.red : t.kind === 'ok' ? colors.live : colors.accent }]}
        >
          <Text style={styles.toastText}>{t.text}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  btnSmall: { minHeight: 36, paddingHorizontal: space.md },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  input: {
    height: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bgDeep,
    color: colors.text,
    fontSize: 16,
  },
  avatarFallback: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    padding: space.lg,
    gap: space.md,
  },
  error: { color: colors.red, fontSize: 14, fontWeight: '600' },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 },
  eqBar: { width: 3, height: 12, borderRadius: 1 },
  toasts: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm },
  toast: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  toastText: { color: colors.text, fontSize: 14, lineHeight: 20 },
})
