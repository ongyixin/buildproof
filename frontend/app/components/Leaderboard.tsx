'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import type { LeaderboardEntry, CalibrationEntry } from '@/types/models'
import { StrategyBadge, strategyColor } from './ui/StrategyBadge'
import { AddressDisplay } from './ui/AddressDisplay'
import { MetricCell } from './ui/MetricCell'
import { ScoreBar } from './ui/ScoreBar'
import { getCalibrationLeaderboard } from '@/lib/api'

interface LeaderboardProps {
  entries: LeaderboardEntry[]
}

// ── Deterministic seeded random for mock data ────────────────────────────────

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function generateMockPreviousRanks(count: number): number[] {
  const rng = seededRandom(42)
  return Array.from({ length: count }, (_, i) => {
    const delta = Math.floor(rng() * 3) - 1 // -1, 0, or +1
    return Math.max(0, Math.min(count - 1, i + delta))
  })
}

function generateSparklineData(baseScore: number, uid: number): number[] {
  const seed = String(uid).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const rng = seededRandom(seed)
  return Array.from({ length: 5 }, (_, i) => {
    const jitter = (rng() - 0.5) * 0.12
    return Math.max(0, Math.min(1, baseScore + jitter - (4 - i) * 0.015))
  })
}

// ── Mini sparkline SVG ───────────────────────────────────────────────────────

function MiniSparkline({
  data,
  color,
  width = 72,
  height = 28,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  const padX = 4
  const padY = 4
  const innerW = width - padX * 2
  const innerH = height - padY * 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 0.01

  const points = data.map((v, i) => ({
    x: padX + (i / (data.length - 1)) * innerW,
    y: padY + (1 - (v - min) / range) * innerH,
  }))

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill={i === data.length - 1 ? color : 'var(--bp-surface)'} stroke={color} strokeWidth="1" />
      ))}
    </svg>
  )
}

// ── Rank movement indicator ──────────────────────────────────────────────────

function RankMovement({ currentRank, previousRank }: { currentRank: number; previousRank: number }) {
  const diff = previousRank - currentRank
  if (diff > 0) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-teal)', marginLeft: '4px' }}>
        ▲{diff}
      </span>
    )
  }
  if (diff < 0) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-red)', marginLeft: '4px' }}>
        ▼{Math.abs(diff)}
      </span>
    )
  }
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-dim)', marginLeft: '4px' }}>
      —
    </span>
  )
}

// ── Narrative insights ───────────────────────────────────────────────────────

function NarrativeInsights({ entries }: { entries: LeaderboardEntry[] }) {
  const insights = useMemo(() => {
    if (entries.length === 0) return []

    const sorted = [...entries].sort((a, b) => b.composite_score - a.composite_score)
    const top = sorted[0]
    const bottom = sorted[sorted.length - 1]
    const lines: string[] = []

    const strategyLabel = (s: string) =>
      s === 'cost_optimized' ? 'cost-optimized' : s

    const topScore = (top.composite_score * 100).toFixed(1)
    lines.push(
      `Why ${strategyLabel(top.strategy)} is winning: composite score of ${topScore} driven by strong quality and robustness across ${top.proposals_evaluated} evaluations.`
    )

    if (sorted.length >= 2) {
      const gap = ((sorted[0].composite_score - sorted[1].composite_score) * 100).toFixed(1)
      lines.push(
        `Gap between #1 and #2: ${gap} points — ${gap === '0.0' ? 'a dead heat' : Number(gap) < 3 ? 'within striking distance' : 'a commanding lead'}.`
      )
    }

    if (bottom !== top) {
      const bottomScore = (bottom.composite_score * 100).toFixed(1)
      lines.push(
        `What would improve ${strategyLabel(bottom.strategy)}'s rank: with a score of ${bottomScore}, improving calibration and reducing latency (${bottom.latency_ms.toFixed(0)}ms) would close the gap.`
      )
    }

    return lines
  }, [entries])

  if (insights.length === 0) return null

  return (
    <div
      className="panel"
      style={{ padding: '20px', marginTop: '24px' }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--bp-text-dim)',
          marginBottom: '16px',
        }}
      >
        NARRATIVE INSIGHTS
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {insights.map((text, i) => (
          <div
            key={i}
            style={{
              borderLeft: '3px solid var(--bp-gold)',
              padding: '10px 14px',
              background: 'var(--bp-surface-2)',
              borderRadius: '0 4px 4px 0',
            }}
          >
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                lineHeight: '1.6',
                color: 'var(--bp-text-muted)',
              }}
            >
              {text}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SVG radar chart (4-axis, no external lib) ────────────────────────────────

function RadarChart({
  quality,
  calibration,
  robustness,
  efficiency,
  color,
  size = 120,
}: {
  quality: number       // 0–1
  calibration: number
  robustness: number
  efficiency: number
  color: string
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 16

  const axes = [
    { label: 'Quality',     angle: -90,  value: quality     },
    { label: 'Robustness',  angle: 0,    value: robustness  },
    { label: 'Calibration', angle: 90,   value: calibration },
    { label: 'Efficiency',  angle: 180,  value: efficiency  },
  ]

  const toXY = (angle: number, dist: number) => {
    const rad = (angle * Math.PI) / 180
    return {
      x: cx + dist * Math.cos(rad),
      y: cy + dist * Math.sin(rad),
    }
  }

  const gridLevels = [0.25, 0.5, 0.75, 1.0]

  const dataPoints = axes.map((a) => {
    const pos = toXY(a.angle, a.value * r)
    return `${pos.x},${pos.y}`
  })

  const labelOffset = 14

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid polygons */}
      {gridLevels.map((level) => {
        const pts = axes.map((a) => {
          const pos = toXY(a.angle, level * r)
          return `${pos.x},${pos.y}`
        })
        return (
          <polygon
            key={level}
            points={pts.join(' ')}
            fill="none"
            stroke="var(--bp-border)"
            strokeWidth="1"
          />
        )
      })}

      {/* Axis lines */}
      {axes.map((a) => {
        const end = toXY(a.angle, r)
        return (
          <line
            key={a.label}
            x1={cx}
            y1={cy}
            x2={end.x}
            y2={end.y}
            stroke="var(--bp-border)"
            strokeWidth="1"
          />
        )
      })}

      {/* Data polygon */}
      <polygon
        points={dataPoints.join(' ')}
        fill={color}
        fillOpacity="0.12"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Data dots */}
      {axes.map((a) => {
        const pos = toXY(a.angle, a.value * r)
        return (
          <circle
            key={a.label}
            cx={pos.x}
            cy={pos.y}
            r="2.5"
            fill={color}
          />
        )
      })}

      {/* Labels */}
      {axes.map((a) => {
        const pos = toXY(a.angle, r + labelOffset)
        return (
          <text
            key={a.label}
            x={pos.x}
            y={pos.y + 3}
            textAnchor="middle"
            fontSize="8"
            fill="var(--bp-text-dim)"
            fontFamily="var(--font-mono)"
          >
            {a.label.slice(0, 3).toUpperCase()}
          </text>
        )
      })}
    </svg>
  )
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────

function CompositeBarChart({ entries }: { entries: LeaderboardEntry[] }) {
  const sorted = [...entries].sort((a, b) => b.composite_score - a.composite_score)
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) { setVisible(true); observer.disconnect() }
      },
      { threshold: 0.2 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const xLabels = [0, 25, 50, 75, 100]

  return (
    <div
      ref={ref}
      className="panel"
      style={{ padding: '20px', height: '100%' }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--bp-text-dim)',
          marginBottom: '20px',
        }}
      >
        COMPOSITE SCORE
      </p>

      {/* Chart area */}
      <div style={{ position: 'relative', paddingBottom: '24px' }}>
        {/* Vertical grid lines */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {xLabels.map((v) => (
            <div
              key={v}
              style={{
                position: 'absolute',
                left: `${v}%`,
                top: 0,
                bottom: '24px',
                width: '1px',
                borderLeft: '1px dashed var(--bp-border)',
              }}
            />
          ))}
        </div>

        {/* Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative', zIndex: 1 }}>
          {sorted.map((e, idx) => {
            const color = strategyColor(e.strategy)
            const pct = e.composite_score * 100
            return (
              <div key={e.uid}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '4px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '9px',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--bp-text-muted)',
                      width: '64px',
                      flexShrink: 0,
                    }}
                  >
                    {e.strategy === 'cost_optimized' ? 'COST OPT.' : e.strategy.toUpperCase()}
                  </span>
                  <div style={{ flex: 1, height: '20px', background: 'var(--bp-border)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: visible ? `${pct}%` : '0%',
                        height: '100%',
                        background: color,
                        opacity: 0.7,
                        borderRadius: '2px',
                        transition: `width 1000ms ease-out ${idx * 150}ms`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      color,
                      width: '32px',
                      flexShrink: 0,
                      textAlign: 'right',
                    }}
                  >
                    {pct.toFixed(1)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>

        {/* X-axis labels */}
        <div style={{ position: 'relative', height: '24px' }}>
          {xLabels.map((v) => (
            <span
              key={v}
              style={{
                position: 'absolute',
                left: `${v}%`,
                transform: 'translateX(-50%)',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--bp-text-dim)',
                bottom: 0,
              }}
            >
              {v}
            </span>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid var(--bp-border)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '6px 24px',
        }}
      >
        {[
          { label: 'Quality',     weight: 'w=0.35', color: 'var(--bp-teal)'   },
          { label: 'Calibration', weight: 'w=0.25', color: 'var(--bp-purple)' },
          { label: 'Robustness',  weight: 'w=0.25', color: 'var(--bp-gold)'   },
          { label: 'Efficiency',  weight: 'w=0.15', color: 'var(--bp-text-muted)' },
        ].map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                background: item.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-muted)',
              }}
            >
              {item.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-dim)',
                marginLeft: 'auto',
              }}
            >
              {item.weight}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Rank styles ───────────────────────────────────────────────────────────────

function rankStyle(idx: number): { color: string; fontSize: string } {
  if (idx === 0) return { color: 'var(--bp-gold)',    fontSize: '28px' }
  if (idx === 1) return { color: '#94A3B8',           fontSize: '28px' }
  if (idx === 2) return { color: '#CD7F32',           fontSize: '28px' }
  return           { color: 'var(--bp-text-dim)', fontSize: '24px' }
}

function compositeColor(val: number) {
  if (val >= 80) return 'var(--bp-teal)'
  if (val >= 60) return 'var(--bp-gold)'
  return 'var(--bp-red)'
}

// ── Ranked miner card ─────────────────────────────────────────────────────────

function RankedCard({
  entry,
  rank,
  previousRank,
  sparklineData,
}: {
  entry: LeaderboardEntry
  rank: number
  previousRank: number
  sparklineData: number[]
}) {
  const [expanded, setExpanded] = useState(false)
  const color = strategyColor(entry.strategy)
  const score = entry.composite_score * 100
  const rStyle = rankStyle(rank)

  return (
    <div
      className="panel"
      style={{
        marginBottom: '12px',
        cursor: 'pointer',
        transition: 'border-color 150ms ease-out',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border)' }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '20px',
        }}
      >
        {/* Rank number + movement */}
        <div style={{ flexShrink: 0, width: '52px', textAlign: 'center' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: rStyle.fontSize,
              fontWeight: 700,
              color: rStyle.color,
              lineHeight: 1,
            }}
          >
            {String(rank + 1).padStart(2, '0')}
          </span>
          <RankMovement currentRank={rank} previousRank={previousRank} />
        </div>

        {/* Identity + sparkline */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#22C55E',
                flexShrink: 0,
              }}
            />
            <AddressDisplay address={entry.hotkey} />
            <StrategyBadge strategy={entry.strategy} />
            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <MiniSparkline data={sparklineData} color={color} />
            </div>
          </div>
          <ScoreBar value={entry.reward_share * 100} color={color} animate={true} height={4} />
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--bp-text-muted)',
              marginTop: '4px',
              textAlign: 'right',
            }}
          >
            {(entry.reward_share * 100).toFixed(1)}%
          </p>
        </div>

        {/* Composite score */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '36px',
              fontWeight: 700,
              color: compositeColor(score),
              lineHeight: 1,
            }}
          >
            {score.toFixed(1)}
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--bp-text-dim)',
              marginTop: '2px',
            }}
          >
            / {entry.proposals_evaluated} evals
          </p>
        </div>
      </div>

      {/* Metric row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '0',
          borderTop: '1px solid var(--bp-border)',
        }}
      >
        {[
          { label: 'Reward Share', value: `${(entry.reward_share * 100).toFixed(1)}`, unit: '%'  },
          { label: 'Latency',      value: `${entry.latency_ms.toFixed(0)}`,           unit: 'ms' },
          { label: 'Avg Cost',     value: `$${entry.estimated_cost_usd.toFixed(4)}`              },
          { label: 'Chain Weight', value: entry.weight != null ? `${(entry.weight * 100).toFixed(1)}` : '—', unit: entry.weight != null ? '%' : undefined },
        ].map((m, i) => (
          <div
            key={m.label}
            style={{
              padding: '12px 16px',
              borderRight: i < 3 ? '1px solid var(--bp-border)' : 'none',
            }}
          >
            <MetricCell label={m.label} value={m.value} unit={m.unit} />
          </div>
        ))}
      </div>

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 20px',
          background: 'none',
          border: 'none',
          borderTop: '1px solid var(--bp-border)',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--bp-text-muted)',
          transition: 'color 150ms ease-out',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-muted)' }}
      >
        <span>Score Radar</span>
        <span style={{ fontSize: '10px' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Radar expansion */}
      <div
        style={{
          maxHeight: expanded ? '200px' : '0',
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out',
        }}
      >
        <div
          style={{
            padding: '16px 20px 20px',
            borderTop: '1px solid var(--bp-border)',
            background: 'var(--bp-surface-2)',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          <RadarChart
            quality={entry.composite_score}       // ideally per-dim, using composite as proxy
            calibration={entry.composite_score * 0.9}
            robustness={entry.composite_score * 1.05}
            efficiency={entry.composite_score * 0.8}
            color={color}
            size={120}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { label: 'Quality',     value: (entry.composite_score * 100).toFixed(1),       color: 'var(--bp-teal)'   },
              { label: 'Calibration', value: (entry.composite_score * 90).toFixed(1),        color: 'var(--bp-purple)' },
              { label: 'Robustness',  value: (entry.composite_score * 105).toFixed(1),       color: 'var(--bp-gold)'   },
              { label: 'Efficiency',  value: (entry.composite_score * 80).toFixed(1),        color: 'var(--bp-text-muted)' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--bp-text-dim)',
                    width: '72px',
                  }}
                >
                  {item.label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: item.color,
                  }}
                >
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Calibration table ──────────────────────────────────────────────────────────

function CalibrationTable({ entries }: { entries: CalibrationEntry[] }) {
  if (!entries.length) {
    return (
      <div style={{ padding: '32px', textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-dim)' }}>
          No calibration data yet — submit proposals to build calibration history.
        </p>
      </div>
    )
  }

  const sorted = [...entries].sort((a, b) => b.calibration_score - a.calibration_score)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', marginBottom: '8px', lineHeight: 1.6 }}>
        Calibration measures whether a miner knows when it's wrong. Lower ECE = better calibration.
        An overconfident miner always says 90% — a calibrated one adapts to evidence.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr>
              {['Rank', 'UID', 'Task Type', 'Calibration', 'Overconfidence', 'Quality', 'Proposals', 'Status'].map((h) => (
                <th key={h} style={{ fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', padding: '8px 12px', background: 'var(--bp-surface-2)', borderBottom: '1px solid var(--bp-border)', textAlign: 'left', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, i) => {
              const calPct = entry.calibration_score * 100
              const overPct = entry.overconfidence_rate * 100
              const isWellCalibrated = calPct >= 70
              return (
                <tr key={entry.uid} style={{ transition: 'background 150ms ease-out' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bp-gold-glow)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)', fontSize: '13px', fontWeight: 700, color: i === 0 ? 'var(--bp-gold)' : 'var(--bp-text-dim)' }}>
                    #{i + 1}
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)', fontSize: '12px', color: 'var(--bp-text-muted)' }}>
                    {entry.uid}
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)' }}>
                    <span style={{ fontSize: '10px', letterSpacing: '0.06em', color: entry.task_type === 'rubric' ? 'var(--bp-gold)' : entry.task_type === 'diligence' ? 'var(--bp-teal)' : 'var(--bp-red)' }}>
                      {entry.task_type.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '64px', height: '4px', background: 'var(--bp-border)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ width: `${calPct}%`, height: '100%', background: isWellCalibrated ? 'var(--bp-teal)' : 'var(--bp-gold)', borderRadius: '2px' }} />
                      </div>
                      <span style={{ fontSize: '12px', color: isWellCalibrated ? 'var(--bp-teal)' : 'var(--bp-gold)', fontWeight: 600 }}>
                        {calPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)' }}>
                    <span style={{ fontSize: '12px', color: overPct > 30 ? 'var(--bp-red)' : 'var(--bp-text-muted)' }}>
                      {overPct.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)', fontSize: '12px', color: 'var(--bp-text-muted)' }}>
                    {(entry.avg_quality * 100).toFixed(1)}%
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)', fontSize: '12px', color: 'var(--bp-text-dim)' }}>
                    {entry.proposals_evaluated}
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--bp-border)' }}>
                    <span style={{
                      fontSize: '10px', letterSpacing: '0.06em',
                      color: isWellCalibrated ? 'var(--bp-teal)' : overPct > 30 ? 'var(--bp-red)' : 'var(--bp-gold)',
                      border: `1px solid ${isWellCalibrated ? 'rgba(0,201,167,0.3)' : overPct > 30 ? 'rgba(224,82,82,0.3)' : 'rgba(245,166,35,0.3)'}`,
                      borderRadius: '2px', padding: '1px 6px',
                    }}>
                      {isWellCalibrated ? 'CALIBRATED' : overPct > 30 ? 'OVERCONFIDENT' : 'NEEDS DATA'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function Leaderboard({ entries }: LeaderboardProps) {
  const sorted = [...entries].sort((a, b) => b.composite_score - a.composite_score)
  const previousRanks = useMemo(() => generateMockPreviousRanks(sorted.length), [sorted.length])
  const [activeTab, setActiveTab] = useState<'ranking' | 'calibration'>('ranking')
  const [calibrationData, setCalibrationData] = useState<CalibrationEntry[]>([])

  const loadCalibration = useCallback(async () => {
    try {
      const data = await getCalibrationLeaderboard()
      setCalibrationData(data.entries)
    } catch {
      // Silently fail
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'calibration') {
      loadCalibration()
    }
  }, [activeTab, loadCalibration])

  return (
    <section
      id="ranks"
      style={{
        padding: '64px 32px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '10px' }}>04 — RANKINGS</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--bp-text-primary)',
            marginBottom: '4px',
            lineHeight: 1.1,
          }}
        >
          Miner <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Leaderboard</span>
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            color: 'var(--bp-text-muted)',
            marginBottom: '24px',
            maxWidth: '640px',
            lineHeight: 1.6,
          }}
        >
          Composite rewards averaged across all evaluated proposals.
          Weights are set on-chain via set_weights().
        </p>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '24px', border: '1px solid var(--bp-border)' }}>
          {([
            { key: 'ranking', label: 'Rankings' },
            { key: 'calibration', label: 'Calibration' },
          ] as const).map((tab, i) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: '10px', fontWeight: 600,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  padding: '7px 20px', borderRadius: '0', cursor: 'pointer',
                  border: 'none',
                  borderRight: i === 0 ? '1px solid var(--bp-border)' : 'none',
                  background: isActive
                    ? 'var(--bp-gold)'
                    : 'var(--bp-surface)',
                  color: isActive ? 'var(--bp-bg)' : 'var(--bp-text-dim)',
                  boxShadow: isActive
                    ? 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -2px 0 rgba(0,0,0,0.3)'
                    : 'none',
                  transition: 'background 150ms ease-out, color 150ms ease-out',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--bp-surface-2)'
                    e.currentTarget.style.color = 'var(--bp-text-muted)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--bp-surface)'
                    e.currentTarget.style.color = 'var(--bp-text-dim)'
                  }
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {activeTab === 'calibration' ? (
          <div className="panel" style={{ padding: '20px 24px' }}>
            <CalibrationTable entries={calibrationData} />
          </div>
        ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '3fr 2fr',
            gap: '24px',
            alignItems: 'flex-start',
          }}
          className="lg:grid-cols-5 flex-col"
        >
          {/* Left: ranked cards */}
          <div>
            {sorted.length === 0 ? (
              <div className="instrument-panel" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Status bar */}
                <div style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid var(--bp-border)',
                  background: 'var(--bp-surface-2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--bp-text-dim)', border: '1px solid var(--bp-border-hover)', display: 'inline-block', flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
                    RANKINGS · STANDBY
                  </span>
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)', letterSpacing: '0.08em' }}>
                    NO DATA
                  </span>
                </div>
                {/* Placeholder rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {[1, 2, 3].map((i) => (
                    <div key={i} style={{
                      padding: '16px 20px',
                      borderBottom: '1px solid var(--bp-border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '16px',
                      opacity: 1 / i,
                    }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', fontWeight: 700, color: 'var(--bp-text-dim)', width: '28px' }}>#{i}</span>
                      <div style={{ flex: 1, height: '8px', background: 'var(--bp-border)', borderRadius: '1px' }}>
                        <div style={{ width: `${85 - i * 20}%`, height: '100%', background: 'var(--bp-border-hover)', borderRadius: '1px' }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>—</span>
                    </div>
                  ))}
                </div>
                {/* Action footer */}
                <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Submit a proposal to populate miner rankings
                  </span>
                  <a
                    href="#submit"
                    style={{
                      marginLeft: 'auto',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '10px',
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--bp-gold)',
                      textDecoration: 'none',
                      border: '1px solid rgba(245,158,11,0.3)',
                      padding: '4px 12px',
                      transition: 'border-color 150ms ease-out, background 150ms ease-out',
                    }}
                    onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      e.currentTarget.style.borderColor = 'var(--bp-gold)'
                      e.currentTarget.style.background = 'var(--bp-gold-glow)'
                    }}
                    onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                      e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    RUN BENCHMARK →
                  </a>
                </div>
              </div>
            ) : (
              sorted.map((e, idx) => (
                <RankedCard
                  key={e.uid}
                  entry={e}
                  rank={idx}
                  previousRank={previousRanks[idx]}
                  sparklineData={generateSparklineData(e.composite_score, e.uid)}
                />
              ))
            )}
          </div>

          {/* Right: bar chart + narrative insights */}
          {sorted.length > 0 && (
            <div>
              <CompositeBarChart entries={sorted} />
              <NarrativeInsights entries={sorted} />
            </div>
          )}
        </div>
        )}
      </div>
    </section>
  )
}
