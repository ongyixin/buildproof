'use client'

import { useState, useMemo, Fragment } from 'react'
import type { MinerResponse, FundingDecision } from '@/types/models'
import { StrategyBadge } from './ui/StrategyBadge'
import { ScoreBar } from './ui/ScoreBar'
import { ProofStamp } from './ui/ProofStamp'

const TASK_COLORS: Record<string, string> = {
  rubric: 'var(--bp-gold)',
  diligence: 'var(--bp-teal)',
  risk: 'var(--bp-red)',
}

interface ValidatorScoresProps {
  miners: MinerResponse[]
  decision: FundingDecision | null
}

// ── Scoring dimensions ────────────────────────────────────────────────────────

const DIMENSIONS = [
  { key: 'quality',     label: 'Quality',     weight: 0.35, color: 'var(--bp-teal)'  },
  { key: 'calibration', label: 'Calibration', weight: 0.25, color: 'var(--bp-purple)'},
  { key: 'robustness',  label: 'Robustness',  weight: 0.25, color: 'var(--bp-gold)'  },
  { key: 'efficiency',  label: 'Efficiency',  weight: 0.15, color: 'var(--bp-text-muted)' },
] as const

type DimKey = (typeof DIMENSIONS)[number]['key'] | 'composite' | 'miner'
type DimFilter = (typeof DIMENSIONS)[number]['key'] | 'all'
type SortDir = 'asc' | 'desc'

// ── Composite score color ─────────────────────────────────────────────────────

function compositeColor(val: number) {
  if (val >= 80) return 'var(--bp-teal)'
  if (val >= 60) return 'var(--bp-gold)'
  return 'var(--bp-red)'
}

// ── Miner insight generator ───────────────────────────────────────────────────

function minerInsight(m: MinerResponse): string {
  const dims = DIMENSIONS.map((d) => ({
    label: d.label,
    value: m.score[d.key as keyof typeof m.score] as number,
  }))
  const sorted = [...dims].sort((a, b) => b.value - a.value)
  const strongest = sorted[0]
  const weakest = sorted[sorted.length - 1]
  if (strongest.label === weakest.label) return `Uniform across all dimensions at ${(strongest.value * 100).toFixed(0)}`
  return `Strongest on ${strongest.label} (${(strongest.value * 100).toFixed(1)}), weakest on ${weakest.label} (${(weakest.value * 100).toFixed(1)})`
}

// ── Stacked dimension bar per miner ───────────────────────────────────────────

function DimensionStackedBar({ miner, highlight }: { miner: MinerResponse; highlight: DimFilter }) {
  const segments = DIMENSIONS.map((d) => {
    const raw = miner.score[d.key as keyof typeof miner.score] as number
    const contribution = raw * d.weight * 100
    return { ...d, contribution, raw }
  })
  const total = segments.reduce((s, seg) => s + seg.contribution, 0)
  const taskColor = TASK_COLORS[miner.task_type] ?? 'var(--bp-text-muted)'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ minWidth: '96px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '1px', background: taskColor, flexShrink: 0 }} />
          <StrategyBadge strategy={miner.strategy} />
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)' }}>
          uid {miner.uid} · {miner.task_type}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          height: '20px',
          borderRadius: '2px',
          overflow: 'hidden',
          display: 'flex',
          background: 'var(--bp-border)',
        }}
      >
        {segments.map((seg) => {
          const widthPct = total > 0 ? (seg.contribution / 100) * 100 : 0
          const isHighlighted = highlight === 'all' || highlight === seg.key
          return (
            <div
              key={seg.key}
              title={`${seg.label}: ${seg.raw.toFixed(2)} × ${seg.weight} = ${seg.contribution.toFixed(1)}`}
              style={{
                width: `${widthPct}%`,
                height: '100%',
                background: seg.color,
                opacity: isHighlighted ? 1 : 0.25,
                transition: 'opacity 150ms ease-out, width 800ms ease-out',
              }}
            />
          )
        })}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          fontWeight: 600,
          color: compositeColor(total),
          minWidth: '38px',
          textAlign: 'right',
        }}
      >
        {total.toFixed(1)}
      </span>
    </div>
  )
}

// ── Expandable justification panel ────────────────────────────────────────────

function JustificationPanel({ miner }: { miner: MinerResponse }) {
  const insight = minerInsight(miner)
  const flags = miner.risk_assessment?.manipulation_flags ?? []
  const penalties = miner.score.penalties ?? {}
  const hasPenalties = Object.keys(penalties).length > 0

  return (
    <div
      style={{
        padding: '16px 16px 16px 32px',
        borderTop: '1px dashed var(--bp-border)',
        background: 'var(--bp-surface-2)',
        animation: 'expandIn 200ms ease-out',
      }}
    >
      <style>{`
        @keyframes expandIn {
          from { opacity: 0; max-height: 0; }
          to   { opacity: 1; max-height: 600px; }
        }
      `}</style>

      {/* Insight — review annotation style */}
      <div
        className="review-annotation"
        style={{ marginBottom: '12px' }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-teal-dim)', display: 'block', marginBottom: '3px' }}>
          REVIEWER NOTE
        </span>
        {insight}
      </div>

      {/* Anti-gaming penalties or clean badge */}
      <div style={{ marginBottom: '12px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: hasPenalties ? 'var(--bp-red)' : 'var(--bp-teal)', marginBottom: '6px' }}>
          {hasPenalties ? 'Anti-Gaming Penalties' : 'Gaming Checks'}
        </p>
        {hasPenalties ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {Object.entries(penalties).map(([name, cost]) => (
              <span key={name} style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-red)',
                background: 'var(--bp-red-dim)', border: '1px solid rgba(224,82,82,0.3)',
                borderRadius: '2px', padding: '2px 8px',
              }}>
                {name.replace(/_/g, ' ')} −{(cost * 100).toFixed(0)}pts
              </span>
            ))}
          </div>
        ) : (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-teal)',
            background: 'rgba(0,201,167,0.08)', border: '1px solid rgba(0,201,167,0.3)',
            borderRadius: '2px', padding: '2px 10px',
          }}>
            ✓ CLEAN — no penalties triggered
          </span>
        )}
      </div>

      {/* Fraud flags */}
      {flags.length > 0 && (
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-red)', marginBottom: '6px' }}>
            Fraud Flags
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {flags.map((flag, i) => (
              <span key={i} style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-red)',
                background: 'var(--bp-red-dim)', border: '1px solid rgba(224,82,82,0.3)',
                borderRadius: '2px', padding: '2px 8px',
              }}>
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Decision packet ───────────────────────────────────────────────────────────

function DecisionPacket({ decision }: { decision: FundingDecision }) {
  const isFund = decision.recommendation === 'fund' || decision.recommendation === 'fund_with_conditions'
  const isReject = decision.recommendation === 'reject'

  const borderColor = isFund ? 'var(--bp-teal)' : isReject ? 'var(--bp-red)' : 'var(--bp-gold)'
  const bg = isFund
    ? 'rgba(0,201,167,0.05)'
    : isReject
    ? 'var(--bp-red-dim)'
    : 'rgba(245,166,35,0.05)'

  const recLabel = {
    fund:                'FUND',
    fund_with_conditions:'FUND WITH CONDITIONS',
    reject:              'REJECT',
    escalate:            'ESCALATE',
  }[decision.recommendation] ?? decision.recommendation.toUpperCase()

  const recClass = `rec-${decision.recommendation}`

  return (
    <div
      id="decision"
      style={{
        border: `1px solid ${borderColor}`,
        background: bg,
        borderRadius: '4px',
        padding: '24px',
        marginTop: '32px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
        <div style={{ flexShrink: 0 }}>
          {isFund ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="var(--bp-teal)" strokeWidth="1.5" />
              <path d="M6 10l3 3 5-5" stroke="var(--bp-teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : isReject ? (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="9" stroke="var(--bp-red)" strokeWidth="1.5" />
              <path d="M7 7l6 6M13 7l-6 6" stroke="var(--bp-red)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 3l7 14H3L10 3z" stroke="var(--bp-gold)" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M10 9v3M10 14v.5" stroke="var(--bp-gold)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
              flexWrap: 'wrap',
            }}
          >
            <p className="section-label">Decision Packet</p>
            <span className={`badge ${recClass}`}>{recLabel}</span>
            {decision.recommended_amount != null && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--bp-text-primary)',
                }}
              >
                ${decision.recommended_amount.toLocaleString()}
              </span>
            )}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-muted)',
                marginLeft: 'auto',
              }}
            >
              confidence {(decision.consensus_confidence * 100).toFixed(0)}%
            </span>
          </div>

          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              color: 'var(--bp-text-primary)',
              lineHeight: 1.65,
              marginBottom: '12px',
            }}
          >
            {decision.rationale}
          </p>

          {/* Disagreement alert */}
          {(decision.disagreement_score ?? 0) > 0.15 && (
            <div style={{
              background: 'rgba(245,166,35,0.06)',
              border: '1px solid rgba(245,166,35,0.3)',
              borderLeft: '3px solid var(--bp-gold)',
              borderRadius: '3px',
              padding: '10px 14px',
              marginBottom: '12px',
            }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-gold)', marginBottom: '4px' }}>
                ⚡ High Miner Disagreement — {((decision.disagreement_score ?? 0) * 100).toFixed(0)}% variance
              </p>
              {decision.disagreement_reason && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', lineHeight: 1.5 }}>
                  {decision.disagreement_reason}
                </p>
              )}
            </div>
          )}

          {decision.dissenting_views.length > 0 && (
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-muted)',
                  marginBottom: '6px',
                }}
              >
                Dissenting Views
              </p>
              {decision.dissenting_views.map((v, i) => (
                <p
                  key={i}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--bp-text-muted)',
                    marginBottom: '4px',
                  }}
                >
                  — {v}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Filter tabs ───────────────────────────────────────────────────────────────

const FILTER_TABS: { key: DimFilter; label: string }[] = [
  { key: 'all',         label: 'ALL' },
  { key: 'quality',     label: 'QUALITY' },
  { key: 'robustness',  label: 'ROBUSTNESS' },
  { key: 'calibration', label: 'CALIBRATION' },
  { key: 'efficiency',  label: 'EFFICIENCY' },
]

// ── Main export ───────────────────────────────────────────────────────────────

export function ValidatorScores({ miners, decision }: ValidatorScoresProps) {
  const [sortKey, setSortKey] = useState<DimKey>('composite')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [dimFilter, setDimFilter] = useState<DimFilter>('all')
  const [expandedUid, setExpandedUid] = useState<number | null>(null)

  if (!miners.length) return (
    <section id="scores" style={{ padding: '64px 32px', borderTop: '1px solid var(--bp-border)' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '10px' }}>03 — SCORING</p>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--bp-text-primary)', marginBottom: '32px', lineHeight: 1.1 }}>
          Validator <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Scores</span>
        </h2>
        <div className="panel" style={{ padding: '48px', borderLeft: '2px solid var(--bp-gold)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-gold-dim)', marginBottom: '12px' }}>AWAITING EVALUATION</p>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--bp-text-muted)', marginBottom: '16px', lineHeight: 1.6 }}>
            Submit a proposal to see how validators score miners across quality, robustness, calibration, and efficiency.
          </p>
          <a href="#submit" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--bp-gold)', textDecoration: 'none', letterSpacing: '0.04em' }}>→ Submit a proposal</a>
        </div>
      </div>
    </section>
  )

  const handleSort = (key: DimKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedMiners = useMemo(() => {
    return [...miners].sort((a, b) => {
      let av = 0
      let bv = 0
      if (sortKey === 'composite') {
        av = a.score.composite
        bv = b.score.composite
      } else if (sortKey === 'miner') {
        av = a.uid
        bv = b.uid
      } else {
        av = a.score[sortKey as keyof typeof a.score] as number
        bv = b.score[sortKey as keyof typeof b.score] as number
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [miners, sortKey, sortDir])

  const sortIndicator = (key: DimKey) => {
    if (sortKey !== key) return null
    return (
      <span style={{ marginLeft: '4px', fontSize: '9px' }}>
        {sortDir === 'desc' ? '▼' : '▲'}
      </span>
    )
  }

  const dimColorMap: Record<string, string> = {}
  for (const d of DIMENSIONS) dimColorMap[d.key] = d.color

  const thStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 500,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    color: 'var(--bp-text-dim)',
    padding: '8px 16px',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    background: 'var(--bp-surface-2)',
    borderBottom: '1px solid var(--bp-border)',
    textAlign: 'left' as const,
  }

  return (
    <section
      id="scores"
      style={{
        padding: '64px 32px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '10px' }}>03 — EVALUATION</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--bp-text-primary)',
            marginBottom: '32px',
            lineHeight: 1.1,
          }}
        >
          Score <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Breakdown</span>
        </h2>

        {/* Dimension weight cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
            marginBottom: '24px',
          }}
          className="sm:grid-cols-2"
        >
          {DIMENSIONS.map((d) => {
            const isActive = dimFilter === d.key
            return (
              <div
                key={d.key}
                className="panel"
                onClick={() => setDimFilter(isActive ? 'all' : d.key)}
                style={{
                  padding: '16px',
                  cursor: 'pointer',
                  borderColor: isActive ? d.color : undefined,
                  background: isActive ? `color-mix(in srgb, ${d.color} 8%, var(--bp-surface))` : undefined,
                  transition: 'border-color 150ms ease-out, background 150ms ease-out',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: isActive ? d.color : 'var(--bp-text-primary)',
                      transition: 'color 150ms ease-out',
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--bp-text-dim)',
                    }}
                  >
                    w={d.weight}
                  </span>
                </div>
                <ScoreBar
                  value={d.weight * 100}
                  color={d.color}
                  animate={true}
                  height={4}
                />
              </div>
            )
          })}
        </div>

        {/* Dimension filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            marginBottom: '24px',
            flexWrap: 'wrap',
          }}
        >
          {FILTER_TABS.map((tab) => {
            const isActive = dimFilter === tab.key
            const tabColor = tab.key === 'all'
              ? 'var(--bp-gold)'
              : dimColorMap[tab.key] ?? 'var(--bp-text-muted)'
            return (
              <button
                key={tab.key}
                onClick={() => setDimFilter(tab.key)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  fontWeight: 500,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  padding: '6px 14px',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  border: `1px solid ${isActive ? tabColor : 'var(--bp-border)'}`,
                  background: isActive ? tabColor : 'transparent',
                  color: isActive ? '#0D0F14' : 'var(--bp-text-muted)',
                  transition: 'all 150ms ease-out',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Horizontal stacked bars per miner */}
        <div
          className="panel"
          style={{
            padding: '20px 24px',
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 500,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--bp-text-dim)',
              marginBottom: '4px',
            }}
          >
            Dimension Contributions
          </p>
          {sortedMiners.map((m) => (
            <DimensionStackedBar key={m.uid} miner={m} highlight={dimFilter} />
          ))}
          {/* Legend */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', flexWrap: 'wrap' }}>
            {DIMENSIONS.map((d) => (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '1px', background: d.color }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-muted)' }}>
                  {d.label} w={d.weight}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Score table */}
        <div
          style={{
            background: 'var(--bp-surface)',
            border: '1px solid var(--bp-border)',
            borderRadius: '4px',
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {[
                    { key: 'miner' as DimKey,      label: 'MINER'       },
                    { key: 'quality' as DimKey,     label: 'QUALITY'     },
                    { key: 'calibration' as DimKey, label: 'CALIBRATION' },
                    { key: 'robustness' as DimKey,  label: 'ROBUSTNESS'  },
                    { key: 'efficiency' as DimKey,  label: 'EFFICIENCY'  },
                    { key: 'composite' as DimKey,   label: 'COMPOSITE'   },
                  ].map(({ key, label }) => {
                    const isHighlightedDim = dimFilter !== 'all' && key === dimFilter
                    const highlightColor = dimColorMap[key]
                    return (
                      <th
                        key={key}
                        style={{
                          ...thStyle,
                          color: sortKey === key
                            ? 'var(--bp-gold)'
                            : isHighlightedDim
                            ? highlightColor
                            : 'var(--bp-text-dim)',
                          background: isHighlightedDim
                            ? `color-mix(in srgb, ${highlightColor} 6%, var(--bp-surface-2))`
                            : 'var(--bp-surface-2)',
                          transition: 'color 150ms ease-out, background 150ms ease-out',
                        }}
                        onClick={() => handleSort(key)}
                      >
                        {label}{sortIndicator(key)}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedMiners.map((m) => {
                  const s = m.score
                  const compositeVal = s.composite * 100
                  const isExpanded = expandedUid === m.uid
                  return (
                    <Fragment key={m.uid}>
                      <tr
                        style={{
                          transition: 'background 150ms ease-out',
                          cursor: 'pointer',
                        }}
                        onClick={() => setExpandedUid(isExpanded ? null : m.uid)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bp-gold-glow)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        {/* Miner */}
                        <td
                          style={{
                            padding: '12px 16px',
                            borderTop: '1px solid var(--bp-border)',
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <StrategyBadge strategy={m.strategy} />
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '10px',
                                  color: 'var(--bp-text-dim)',
                                  transition: 'transform 150ms ease-out',
                                  display: 'inline-block',
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                }}
                              >
                                ▸
                              </span>
                            </div>
                            <span
                              style={{
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                color: 'var(--bp-text-dim)',
                              }}
                            >
                              {m.hotkey}
                            </span>
                          </div>
                        </td>

                        {/* Dimension cells */}
                        {DIMENSIONS.map((d) => {
                          const val = s[d.key as keyof typeof s] as number
                          const pct = val * 100
                          const isHighlightedDim = dimFilter === d.key
                          const highlightBg = isHighlightedDim
                            ? `color-mix(in srgb, ${d.color} 6%, transparent)`
                            : undefined
                          return (
                            <td
                              key={d.key}
                              style={{
                                padding: '12px 16px',
                                borderTop: '1px solid var(--bp-border)',
                                background: highlightBg,
                                transition: 'background 150ms ease-out',
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                <span
                                  style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: isHighlightedDim ? '14px' : '13px',
                                    fontWeight: isHighlightedDim ? 600 : 500,
                                    color: d.color,
                                    transition: 'font-size 150ms ease-out',
                                  }}
                                >
                                  {pct.toFixed(1)}
                                </span>
                                <div
                                  style={{
                                    width: isHighlightedDim ? '64px' : '48px',
                                    height: isHighlightedDim ? '3px' : '2px',
                                    borderRadius: '1px',
                                    background: 'var(--bp-border)',
                                    transition: 'width 150ms ease-out, height 150ms ease-out',
                                  }}
                                >
                                  <div
                                    style={{
                                      width: `${pct}%`,
                                      height: '100%',
                                      borderRadius: '1px',
                                      background: d.color,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>
                          )
                        })}

                        {/* Composite */}
                        <td
                          style={{
                            padding: '12px 16px',
                            borderTop: '1px solid var(--bp-border)',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '16px',
                              fontWeight: 600,
                              color: compositeColor(compositeVal),
                            }}
                          >
                            {compositeVal.toFixed(1)}
                          </span>
                        </td>
                      </tr>

                      {/* Expandable justification row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ padding: 0 }}>
                            <JustificationPanel miner={m} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Decision packet */}
        {decision && (
          <>
            <DecisionPacket decision={decision} />
            {(decision.recommendation === 'fund' || decision.recommendation === 'fund_with_conditions') && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginTop: '16px',
                  padding: '16px',
                  background: 'rgba(0,201,167,0.04)',
                  border: '1px solid rgba(0,201,167,0.15)',
                  borderRadius: '4px',
                }}
              >
                <ProofStamp
                  variant={decision.recommendation === 'fund' ? 'verified' : 'sealed'}
                  hash={`bp${Date.now().toString(16)}`}
                  animate={true}
                  size="md"
                />
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-teal)', marginBottom: '4px' }}>
                    Consensus Formed
                  </p>
                  <p style={{ fontFamily: 'var(--font-sans)', fontSize: '12px', color: 'var(--bp-text-muted)', lineHeight: 1.5 }}>
                    Validator consensus reached at {(decision.consensus_confidence * 100).toFixed(0)}% confidence.
                    Weights written to chain.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
