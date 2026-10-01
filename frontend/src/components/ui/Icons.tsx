import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = { width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': true } as const

export const PlayIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
  </svg>
)
export const PauseIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 4.5h4.5v15H6zM13.5 4.5H18v15h-4.5z" fill="currentColor" />
  </svg>
)
export const NextIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 5v14l10-7zM16 5h3.5v14H16z" fill="currentColor" />
  </svg>
)
export const RestartIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 5H8v14H4.5zM19.5 5v14l-10-7z" fill="currentColor" />
  </svg>
)
export const MoreIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10.5 4.5h3v3h-3zM10.5 10.5h3v3h-3zM10.5 16.5h3v3h-3z" fill="currentColor" />
  </svg>
)
export const LinkIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </svg>
)
export const PlusIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10.75 4h2.5v6.75H20v2.5h-6.75V20h-2.5v-6.75H4v-2.5h6.75z" fill="currentColor" />
  </svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)

/** Marca: dois quadrados deslocados — o som e o seu eco, no mesmo tempo. */
export const BrandMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="5" y="9" width="14" height="14" fill="none" stroke="var(--blue-deep)" strokeWidth="2.5" />
    <rect x="11" y="9" width="14" height="14" fill="var(--green)" />
  </svg>
)
