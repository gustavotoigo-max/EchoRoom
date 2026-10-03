import { useEffect, useRef, useState } from 'react'
import { copyText } from '../../utils/format'
import { CheckIcon, LinkIcon } from './Icons'

interface Props {
  text: string
  label?: string
  doneLabel?: string
  variant?: 'primary' | 'secondary'
  className?: string
}

/** Botão de copiar com confirmação visível por 1,8 s. */
export function CopyButton({ text, label = 'Copiar link', doneLabel = 'Link copiado', variant = 'secondary', className = '' }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <button
      type="button"
      className={`btn btn-${variant} ${state === 'done' ? 'is-done' : ''} ${className}`}
      onClick={async () => {
        const ok = await copyText(text)
        setState(ok ? 'done' : 'fail')
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setState('idle'), 1800)
      }}
    >
      {state === 'done' ? <CheckIcon width={16} height={16} /> : <LinkIcon width={16} height={16} />}
      <span>{state === 'done' ? doneLabel : state === 'fail' ? 'Não foi possível copiar' : label}</span>
    </button>
  )
}
