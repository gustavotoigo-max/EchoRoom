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
export const VolumeIcon = ({ level = 2, ...p }: P & { level?: 0 | 1 | 2 }) => (
  <svg {...base} {...p}>
    <path d="M3 9.5h4l5-4.5v14l-5-4.5H3z" fill="currentColor" />
    {level >= 1 && <path d="M15 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="2" />}
    {level >= 2 && <path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8" fill="none" stroke="currentColor" strokeWidth="2" />}
  </svg>
)
export const MutedIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 9.5h4l5-4.5v14l-5-4.5H3z" fill="currentColor" />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
)
export const ShrinkIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
  </svg>
)
export const ExpandIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
)
export const PaletteIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H17a4 4 0 0 0 4-4c0-4.5-4-8.2-9-8.2z" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)
/** Marca do Discord (botão "Entrar com Discord"). */
export const DiscordIcon = (p: P) => (
  <svg {...base} viewBox="0 0 24 24" {...p}>
    <path
      fill="currentColor"
      d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.85a13.7 13.7 0 0 0-.63 1.3 18.4 18.4 0 0 0-5.53 0 13.6 13.6 0 0 0-.64-1.3 19.7 19.7 0 0 0-4.93 1.52C.53 9.05-.32 13.6.1 18.1a19.9 19.9 0 0 0 6.04 3.05c.49-.66.92-1.36 1.3-2.1a12.9 12.9 0 0 1-2.04-.98l.5-.39a14.2 14.2 0 0 0 12.2 0l.5.39c-.65.38-1.33.71-2.05.98.38.74.81 1.44 1.3 2.1a19.8 19.8 0 0 0 6.05-3.05c.5-5.22-.84-9.73-3.58-13.73ZM8.02 15.33c-1.18 0-2.16-1.09-2.16-2.42s.95-2.42 2.16-2.42c1.2 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.42-2.16 2.42Zm7.97 0c-1.19 0-2.16-1.09-2.16-2.42s.95-2.42 2.16-2.42c1.21 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.42-2.16 2.42Z"
    />
  </svg>
)
export const CheckIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
)

/** Sair da sala. */
export const LeaveIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
  </svg>
)
/** Ondas de som (cabeçalho da sala, no lugar do "#" do Discord). */
export const WaveIcon = (p: P) => (
  <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth="2.2">
    <path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4" />
  </svg>
)

/**
 * Marca: um ponto (a música) e duas ondas (o eco nos outros navegadores),
 * sobre o gradiente da identidade.
 */
export const BrandMark = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id="er-brand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8b5cff" />
        <stop offset="0.55" stopColor="#4c8dff" />
        <stop offset="1" stopColor="#2fe0c4" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" fill="url(#er-brand)" />
    <circle cx="9" cy="16" r="3.2" fill="#fff" />
    <path d="M14 10a7 7 0 0 1 0 12" fill="none" stroke="#fff" strokeWidth="2.6" />
    <path d="M18.5 6a12 12 0 0 1 0 20" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="2.6" />
  </svg>
)
