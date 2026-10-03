import { type ReactNode } from 'react'

/** Peças de formulário dos painéis (seção, chave liga/desliga, escolha). */
export function Section({ title, children, danger }: { title: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={`drawer-section ${danger ? 'is-danger' : ''}`}>
      <h3>{title}</h3>
      {children}
    </section>
  )
}

export function Toggle(props: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div>
        <strong>{props.label}</strong>
        {props.hint && <span>{props.hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        className={`switch ${props.checked ? 'on' : ''}`}
        disabled={props.disabled}
        onClick={() => props.onChange(!props.checked)}
      >
        <i />
      </button>
    </div>
  )
}

export function Choice(props: {
  label: string
  value: string
  options: [string, string][]
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className="field">
      <span>{props.label}</span>
      <div className="seg seg-full" role="radiogroup" aria-label={props.label}>
        {props.options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={props.value === v}
            className={props.value === v ? 'on' : ''}
            disabled={props.disabled}
            onClick={() => props.value !== v && props.onChange(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
