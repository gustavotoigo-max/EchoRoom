/** Três barrinhas de "tocando agora"; animadas só quando `on`. */
export function Equalizer({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={`eq ${on ? 'is-on' : ''}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <i />
      <i />
      <i />
    </span>
  )
}
