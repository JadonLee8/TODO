import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { burndown, totals, type DayPoint } from '@shared/stats'
import { useAppState } from '../state/AppStateContext'
import { ListSelect } from './ListSelect'

const RANGES = [14, 30, 90] as const

/** Burndown and throughput, from each task's created and completed dates. */
export function StatsView({ header }: { header: (summary: string) => ReactNode }) {
  const { tasks } = useAppState()
  const [days, setDays] = useState<(typeof RANGES)[number]>(30)
  const [listId, setListId] = useState('')

  const scoped = useMemo(() => (listId ? tasks.filter((t) => t.listId === listId) : tasks), [tasks, listId])
  const points = useMemo(() => burndown(scoped, days), [scoped, days])
  const t = useMemo(() => totals(scoped), [scoped])
  const net = points.length ? points[points.length - 1].open - points[0].open : 0

  return (
    <>
      {header(`${t.open} open · ${net === 0 ? 'no change' : `${net > 0 ? '+' : '−'}${Math.abs(net)}`} over ${days} days`)}
      <div className="task-scroll stats">
        <div className="stats-controls">
          <div className="segmented" role="tablist" aria-label="Range">
            {RANGES.map((r) => (
              <button key={r} role="tab" aria-selected={days === r} className={days === r ? 'on' : ''} onClick={() => setDays(r)}>
                {r} days
              </button>
            ))}
          </div>
          <ListSelect value={listId} onChange={setListId} allLabel="All lists" />
        </div>

        <div className="stat-tiles">
          <Tile label="Open" value={t.open} />
          <Tile label="Overdue" value={t.overdue} />
          <Tile label="Added, last 7 days" value={t.createdLast7} />
          <Tile label="Completed, last 7 days" value={t.completedLast7} />
        </div>

        <section className="chart-block">
          <h2 className="chart-title">Open tasks</h2>
          <p className="hint">Tasks still open at the end of each day. Deleted tasks aren’t counted.</p>
          <LineChart points={points} />
        </section>

        <section className="chart-block">
          <h2 className="chart-title">Completed per day</h2>
          <ColumnChart points={points} />
        </section>

        <details className="chart-table">
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Open</th>
                <th>Added</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.day}>
                  <td>{formatDay(p.day, true)}</td>
                  <td>{p.open}</td>
                  <td>{p.created}</td>
                  <td>{p.completed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value.toLocaleString()}</span>
    </div>
  )
}

// ---- Charts: plain SVG, sized to their container ----

const HEIGHT = 170
const PAD = { top: 14, right: 40, bottom: 22, left: 34 }

function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Clean ticks from 0 to at least max. */
function ticks(max: number): number[] {
  const top = Math.max(max, 1)
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find((s) => top / s <= 4) ?? Math.ceil(top / 4)
  const out: number[] = []
  for (let v = 0; v <= top + step - 1 && out.length < 6; v += step) out.push(v)
  return out
}

function Axes({ width, yTicks, y, points, x }: { width: number; yTicks: number[]; y: (v: number) => number; points: DayPoint[]; x: (i: number) => number }) {
  // Label about five days along the bottom, always including the last.
  const every = Math.max(1, Math.ceil(points.length / 5))
  return (
    <g className="chart-axes">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
          <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        (points.length - 1 - i) % every === 0 ? (
          <text key={p.day} x={x(i)} y={HEIGHT - 6} textAnchor="middle">
            {formatDay(p.day)}
          </text>
        ) : null
      )}
    </g>
  )
}

function LineChart({ points }: { points: DayPoint[] }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const yTicks = ticks(Math.max(...points.map((p) => p.open)))
  const yMax = yTicks[yTicks.length - 1]
  const x = (i: number) => PAD.left + (i * (width - PAD.left - PAD.right)) / Math.max(points.length - 1, 1)
  const y = (v: number) => PAD.top + (1 - v / yMax) * (HEIGHT - PAD.top - PAD.bottom)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.open)}`).join('')
  const area = `${line}L${x(points.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const last = points.length - 1

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - box.left) / box.width) * last)
    setHover(Math.min(last, Math.max(0, i)))
  }

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Open tasks per day; ${points[last].open} today`}>
        <Axes width={width} yTicks={yTicks} y={y} points={points} x={x} />
        <path className="chart-area" d={area} />
        <path className="chart-line" d={line} />
        <circle className="chart-dot" cx={x(last)} cy={y(points[last].open)} r={4} />
        <text className="chart-end-label" x={x(last) + 8} y={y(points[last].open)} dy="0.32em">
          {points[last].open}
        </text>
        {hover !== null && (
          <>
            <line className="chart-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <circle className="chart-dot" cx={x(hover)} cy={y(points[hover].open)} r={4} />
          </>
        )}
        <rect
          className="chart-hit"
          x={PAD.left}
          y={0}
          width={width - PAD.left - PAD.right}
          height={HEIGHT}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <ChartTip x={x(hover)} width={width}>
          <strong>{points[hover].open}</strong> open
          <span>{formatDay(points[hover].day, true)}</span>
        </ChartTip>
      )}
    </div>
  )
}

function ColumnChart({ points }: { points: DayPoint[] }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const yTicks = ticks(Math.max(...points.map((p) => p.completed)))
  const yMax = yTicks[yTicks.length - 1]
  const slot = (width - PAD.left - PAD.right) / points.length
  const barWidth = Math.max(2, Math.min(24, slot - 2))
  const x = (i: number) => PAD.left + slot * (i + 0.5)
  const y = (v: number) => PAD.top + (1 - v / yMax) * (HEIGHT - PAD.top - PAD.bottom)

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={HEIGHT} role="img" aria-label="Tasks completed per day">
        <Axes width={width} yTicks={yTicks} y={y} points={points} x={x} />
        {points.map((p, i) => {
          if (!p.completed) return null
          const top = y(p.completed)
          const h = y(0) - top
          const r = Math.min(4, h, barWidth / 2)
          const l = x(i) - barWidth / 2
          // Rounded at the data end, square on the baseline.
          const d = `M${l},${y(0)}V${top + r}Q${l},${top} ${l + r},${top}H${l + barWidth - r}Q${l + barWidth},${top} ${l + barWidth},${top + r}V${y(0)}Z`
          return <path key={p.day} className={`chart-bar${hover === i ? ' hover' : ''}`} d={d} />
        })}
        {points.map((p, i) => (
          <rect
            key={p.day}
            className="chart-hit"
            x={PAD.left + slot * i}
            y={0}
            width={slot}
            height={HEIGHT}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <ChartTip x={x(hover)} width={width}>
          <strong>{points[hover].completed}</strong> completed
          <span>{formatDay(points[hover].day, true)}</span>
        </ChartTip>
      )}
    </div>
  )
}

function ChartTip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the tooltip inside the chart: flip to the left of the crosshair near the right edge.
  const flip = x > width - 140
  return (
    <div className="chart-tip" style={flip ? { right: width - x + 8 } : { left: x + 8 }}>
      {children}
    </div>
  )
}

function formatDay(day: string, long = false): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' })
}
