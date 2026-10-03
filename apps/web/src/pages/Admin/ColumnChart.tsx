import { useState } from 'react'

export interface ColumnPoint {
  label: string
  value: number
}

/** Teto "redondo" para o eixo: 0, 1, 2, 5, 10, 20, 50… */
function niceMax(max: number): number {
  if (max <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(max))
  return [1, 2, 5, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p
}

const shortDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/**
 * Colunas de uma série por dia (30 dias). Uma cor só (sem legenda: o título diz
 * o que é), colunas finas com ponta arredondada, valor no hover e tabela.
 */
export function ColumnChart({ title, points, unit }: { title: string; points: ColumnPoint[]; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const W = 520
  const H = 160
  const pad = { l: 34, r: 8, t: 12, b: 22 }
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)))
  const slot = (W - pad.l - pad.r) / Math.max(1, points.length)
  const bw = Math.max(3, Math.min(24, slot - 2)) // 2px de ar entre colunas
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const base = H - pad.b
  const total = points.reduce((a, p) => a + p.value, 0)
  const last = points.at(-1)

  return (
    <figure className="adm-chart">
      <figcaption>
        <span>{title}</span>
        <small>
          {total.toLocaleString('pt-BR')} em 30 dias{last ? ` · hoje ${last.value.toLocaleString('pt-BR')}` : ''}
        </small>
        <button type="button" className="link-btn" onClick={() => setTable((t) => !t)}>
          {table ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </figcaption>
      {table ? (
        <div className="adm-table-wrap">
          <table className="adm-table compact">
            <thead>
              <tr>
                <th>Dia</th>
                <th className="num">{unit}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.label}>
                  <td>{shortDate(p.label)}</td>
                  <td className="num">{p.value.toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="adm-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${total} em 30 dias`} onMouseLeave={() => setHover(null)}>
            {(max >= 4 ? [0, 0.5, 1] : [0, 1]).map((f) => (
              <g key={f}>
                <line x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
                <text x={pad.l - 6} y={y(max * f) + 4} className="tick" textAnchor="end">
                  {Math.round(max * f).toLocaleString('pt-BR')}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = pad.l + i * slot + (slot - bw) / 2
              const h = base - y(p.value)
              const r = Math.min(4, bw / 2, h)
              return (
                <g key={p.label} onMouseEnter={() => setHover(i)}>
                  {/* alvo de hover maior que a coluna */}
                  <rect x={pad.l + i * slot} y={pad.t} width={slot} height={base - pad.t} fill="transparent" />
                  {p.value > 0 && (
                    <path
                      className={`bar ${hover === i ? 'on' : ''}`}
                      d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + bw - r} Q${x + bw},${base - h} ${x + bw},${base - h + r} V${base} Z`}
                    />
                  )}
                </g>
              )
            })}
            {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) =>
              points[i] ? (
                <text key={i} x={pad.l + i * slot + slot / 2} y={H - 6} className="tick" textAnchor="middle">
                  {shortDate(points[i].label)}
                </text>
              ) : null,
            )}
          </svg>
          {hover !== null && points[hover] && (
            <div className="adm-tip" style={{ left: `${((pad.l + hover * slot + slot / 2) / W) * 100}%` }}>
              <span className="adm-tip-value">
                <strong>{points[hover].value.toLocaleString('pt-BR')}</strong> {unit}
              </span>
              <span>{shortDate(points[hover].label)}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}
