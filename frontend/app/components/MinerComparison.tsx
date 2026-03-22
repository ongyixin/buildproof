'use client'

import { useState } from 'react'
import type { MinerResponse } from '@/types/models'
import { deriveRecommendation, deriveConfidence } from '@/types/models'
import { StrategyBadge, strategyColor } from './ui/StrategyBadge'
import { AddressDisplay } from './ui/AddressDisplay'
import { MetricCell } from './ui/MetricCell'
import { ScoreBar } from './ui/ScoreBar'

interface MinerComparisonProps {
  miners: MinerResponse[]
}

const TASK_TAGLINES: Record<string, string> = {
  rubric:            'Dimension scorer — feasibility, impact, novelty, budget',
  diligence:         'Gap analyst — missing evidence, milestones, questions',
  risk:              'Adversarial detector — fraud flags, manipulation detection',
  rubric_scorer:     'Dimension scorer — feasibility, impact, novelty, budget',
  diligence_generator: 'Gap analyst — missing evidence, milestones, questions',
  risk_detector:     'Adversarial detector — fraud flags, manipulation detection',
}

const TASK_COLORS: Record<string, string> = {
  rubric: 'var(--bp-gold)',
  diligence: 'var(--bp-teal)',
  risk: 'var(--bp-red)',
}

// ── Mini sparkline (custom SVG) ───────────────────────────────────────────────

function Sparkline({
  scores,
  color,
  width = 200,
  height = 40,
}: {
  scores: number[]
  color: string
  width?: number
  height?: number
}) {
  if (scores.length < 2) return null

  const min = 0
  const max = 100
  const xStep = width / (scores.length - 1)
  const points = scores.map((v, i) => {
    const x = i * xStep
    const y = height - ((v - min) / (max - min)) * height
    return `${x},${y}`
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {scores.map((v, i) => (
        <circle
          key={i}
          cx={i * xStep}
          cy={height - ((v - min) / (max - min)) * height}
          r="2.5"
          fill={color}
        />
      ))}
    </svg>
  )
}

// ── Rec badge ─────────────────────────────────────────────────────────────────

function RecBadge({ rec }: { rec: string }) {
  const cls: Record<string, string> = {
    fund:                'rec-fund',
    fund_with_conditions:'rec-fund_with_conditions',
    reject:              'rec-reject',
    escalate:            'rec-escalate',
  }
  const labels: Record<string, string> = {
    fund:                'Fund',
    fund_with_conditions:'Fund w/ Conditions',
    reject:              'Reject',
    escalate:            'Escalate',
  }
  return <span className={`badge ${cls[rec] ?? 'badge'}`}>{labels[rec] ?? rec}</span>
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ latency }: { latency: number }) {
  const isOnline = latency > 0 && latency < 30000
  return (
    <span
      style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: isOnline ? '#22C55E' : 'var(--bp-text-dim)',
        display: 'inline-block',
        flexShrink: 0,
      }}
    />
  )
}

// ── Miner card ────────────────────────────────────────────────────────────────

function MinerCard({ miner }: { miner: MinerResponse }) {
  const [expanded, setExpanded] = useState(false)
  const taskColor = TASK_COLORS[miner.task_type] ?? strategyColor(miner.strategy)
  const recommendation = deriveRecommendation(miner)
  const confidence = deriveConfidence(miner)
  const rewardShare = miner.score.composite * 100

  const mockHistory = [
    Math.max(0, rewardShare - 8),
    Math.max(0, rewardShare - 12),
    Math.max(0, rewardShare - 3),
    Math.max(0, rewardShare - 6),
    rewardShare,
  ]

  const sv = miner.score_vector
  const dq = miner.diligence_questions
  const ra = miner.risk_assessment

  return (
    <div
      className="panel"
      style={{
        transition: 'border-color 150ms ease-out',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border)' }}
    >
      {/* Task type badge strip */}
      <div style={{
        height: '3px',
        background: taskColor,
        opacity: 0.6,
      }} />

      {/* Card header */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusDot latency={miner.latency_ms} />
              <AddressDisplay address={miner.hotkey} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StrategyBadge strategy={miner.strategy} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-muted)', fontStyle: 'italic' }}>
                {TASK_TAGLINES[miner.task_type] ?? TASK_TAGLINES[miner.strategy] ?? ''}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <RecBadge rec={recommendation} />
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.08em',
              color: taskColor,
              background: `${taskColor}15`,
              border: `1px solid ${taskColor}30`,
              borderRadius: '2px',
              padding: '2px 6px',
            }}>
              {(confidence * 100).toFixed(0)}% conf
            </span>
          </div>
        </div>

        {/* 2×2 metric grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginBottom: '16px' }}>
          <MetricCell label="Composite" value={(miner.score.composite * 100).toFixed(1)} unit="%" />
          <MetricCell label="Latency" value={miner.latency_ms.toFixed(0)} unit="ms" />
          <MetricCell label="Quality" value={(miner.score.quality * 100).toFixed(1)} unit="%" />
          <MetricCell label="Robustness" value={(miner.score.robustness * 100).toFixed(1)} unit="%" />
        </div>

        {/* Task-specific summary blurb */}
        {sv && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.5, color: 'var(--bp-text-muted)', padding: '0 0 16px', margin: 0 }}>
            Scored {Object.entries({
              feasibility: sv.feasibility,
              impact: sv.impact,
              clarity: sv.clarity,
            }).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')}
          </p>
        )}
        {dq && dq.questions.length > 0 && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.5, color: 'var(--bp-text-muted)', padding: '0 0 16px', margin: 0 }}>
            {dq.questions[0].length > 80 ? dq.questions[0].slice(0, 80) + '…' : dq.questions[0]}
          </p>
        )}
        {ra && (
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.5, color: ra.fraud_risk > 0.5 ? 'var(--bp-red)' : 'var(--bp-text-muted)', padding: '0 0 16px', margin: 0 }}>
            Fraud risk {(ra.fraud_risk * 100).toFixed(0)}%{ra.manipulation_flags.length > 0 ? ` · ${ra.manipulation_flags.length} flag${ra.manipulation_flags.length > 1 ? 's' : ''}` : ' · clean'}
          </p>
        )}
      </div>

      {/* Footer: progress bar */}
      <ScoreBar value={rewardShare} color={taskColor} animate={true} height={4} className="rounded-none" />

      {/* Expand toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '10px 20px', background: 'none', border: 'none',
          borderTop: '1px solid var(--bp-border)', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--bp-text-muted)', transition: 'color 150ms ease-out',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-muted)' }}
      >
        <span>Details</span>
        <span style={{ fontSize: '10px' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded detail */}
      <div style={{ maxHeight: expanded ? '600px' : '0', overflow: 'hidden', transition: 'max-height 250ms ease-out' }}>
        <div style={{ padding: '16px 20px 20px', borderTop: '1px solid var(--bp-border)', background: 'var(--bp-surface-2)', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Sparkline */}
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', marginBottom: '8px' }}>Last 5 Composite Scores</p>
            <Sparkline scores={mockHistory} color={taskColor} width={200} height={40} />
          </div>

          {/* Score vector dimensions */}
          {sv && (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', marginBottom: '10px' }}>Dimension Scores</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(['feasibility', 'impact', 'novelty', 'budget_reasonableness', 'clarity', 'mandate_alignment'] as const).map((dim) => {
                  const val = sv[dim]
                  return (
                    <div key={dim}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', textTransform: 'capitalize' }}>
                          {dim.replace('_', ' ')}
                        </span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: taskColor }}>
                          {(val * 100).toFixed(0)}
                        </span>
                      </div>
                      <ScoreBar value={val * 100} color={taskColor} animate={expanded} height={2} />
                      {sv.confidence_by_dimension?.[dim] != null && (
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)', marginTop: '2px' }}>
                          conf {((sv.confidence_by_dimension[dim] ?? 0) * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Diligence questions */}
          {dq && dq.questions.length > 0 && (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', marginBottom: '8px' }}>
                Diligence Questions ({dq.questions.length})
              </p>
              <ol style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '0', listStyle: 'none' }}>
                {dq.questions.slice(0, 4).map((q, i) => (
                  <li key={i} style={{ display: 'flex', gap: '8px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', lineHeight: 1.5 }}>
                    <span style={{ color: taskColor, flexShrink: 0, fontWeight: 700 }}>{i + 1}.</span>
                    {q}
                  </li>
                ))}
              </ol>
              {dq.missing_evidence.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-gold-dim)', marginBottom: '4px' }}>Missing Evidence</p>
                  {dq.missing_evidence.slice(0, 2).map((e, i) => (
                    <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-gold)', marginBottom: '2px' }}>→ {e}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Risk assessment */}
          {ra && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: ra.fraud_risk > 0.5 ? 'var(--bp-red)' : 'var(--bp-text-dim)', margin: 0 }}>
                  Risk Assessment
                </p>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: ra.fraud_risk > 0.5 ? 'var(--bp-red)' : 'var(--bp-teal)', fontWeight: 700 }}>
                  {(ra.fraud_risk * 100).toFixed(0)}% risk
                </span>
              </div>
              {ra.manipulation_flags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {ra.manipulation_flags.map((f, i) => (
                    <span key={i} style={{
                      fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-red)',
                      background: 'var(--bp-red-dim)', border: '1px solid rgba(224,82,82,0.3)',
                      borderRadius: '2px', padding: '2px 8px',
                    }}>⚑ {f}</span>
                  ))}
                </div>
              )}
              {ra.reasoning && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', lineHeight: 1.6, marginTop: '8px' }}>
                  {ra.reasoning.slice(0, 200)}{ra.reasoning.length > 200 ? '…' : ''}
                </p>
              )}
            </div>
          )}

          {/* Anti-gaming penalties */}
          {miner.score.penalties && Object.keys(miner.score.penalties).length > 0 && (
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-red)', marginBottom: '6px' }}>
                Anti-Gaming Penalties
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {Object.entries(miner.score.penalties).map(([name, cost]) => (
                  <span key={name} style={{
                    fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-red)',
                    background: 'var(--bp-red-dim)', border: '1px solid rgba(224,82,82,0.3)',
                    borderRadius: '2px', padding: '2px 8px',
                  }}>
                    {name.replace(/_/g, ' ')} −{(cost * 100).toFixed(0)}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Backend provenance */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>Backend</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-primary)' }}>{miner.backend}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>Task</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: taskColor }}>{miner.task_type}</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>Cost</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)' }}>${miner.estimated_cost_usd.toFixed(5)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Diff comparison table ─────────────────────────────────────────────────────

type DiffDim = 'fraud_risk' | 'mandate_alignment' | 'recommendation' | 'confidence' | 'robustness' | 'quality'

const DIFF_ROWS: { key: DiffDim; label: string }[] = [
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'confidence',     label: 'Confidence' },
  { key: 'quality',        label: 'Quality' },
  { key: 'robustness',     label: 'Robustness' },
  { key: 'fraud_risk',     label: 'Fraud Risk' },
  { key: 'mandate_alignment', label: 'Mandate Alignment' },
]

function getCellValue(miner: MinerResponse, key: DiffDim): string | number {
  if (key === 'recommendation') return deriveRecommendation(miner)
  if (key === 'confidence') return deriveConfidence(miner)
  if (key === 'quality') return miner.score.quality
  if (key === 'robustness') return miner.score.robustness
  if (key === 'fraud_risk') return miner.risk_assessment?.fraud_risk ?? 0
  if (key === 'mandate_alignment') return miner.score_vector?.mandate_alignment ?? 0
  return 0
}

function formatCellValue(val: string | number, key: DiffDim): string {
  if (key === 'recommendation') return String(val).replace(/_/g, ' ')
  if (typeof val === 'number') return (val * 100).toFixed(1) + '%'
  return String(val)
}

function hasSignificantDiff(miners: MinerResponse[], key: DiffDim): boolean {
  if (key === 'recommendation') {
    const vals = miners.map((m) => deriveRecommendation(m))
    return new Set(vals).size > 1
  }
  const nums = miners.map((m) => Number(getCellValue(m, key)))
  return Math.max(...nums) - Math.min(...nums) > 0.2
}

function DiffTable({ miners }: { miners: MinerResponse[] }) {
  const cellStyle = (highlight: boolean, color: string): React.CSSProperties => ({
    fontFamily: 'var(--font-mono)', fontSize: '13px', padding: '10px 14px',
    color: highlight ? 'var(--bp-text-primary)' : color,
    background: highlight ? 'rgba(224, 82, 82, 0.08)' : 'transparent',
    borderTop: '1px solid var(--bp-border)', textAlign: 'center',
  })

  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr>
            <th style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', padding: '12px 14px', textAlign: 'left', background: 'var(--bp-surface-2)' }}>
              Dimension
            </th>
            {miners.map((m) => (
              <th key={m.uid} style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: TASK_COLORS[m.task_type] ?? strategyColor(m.strategy), padding: '12px 14px', textAlign: 'center', background: 'var(--bp-surface-2)' }}>
                <AddressDisplay address={m.hotkey} />
                <div style={{ marginTop: '2px', fontSize: '9px', opacity: 0.7 }}>{m.task_type}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DIFF_ROWS.map((row) => {
            const highlight = hasSignificantDiff(miners, row.key)
            return (
              <tr key={row.key}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--bp-text-muted)', padding: '10px 14px', borderTop: '1px solid var(--bp-border)', whiteSpace: 'nowrap' }}>
                  {row.label}
                  {highlight && (
                    <span style={{ marginLeft: '6px', fontSize: '9px', color: 'var(--bp-red)', verticalAlign: 'super' }}>⚑ divergent</span>
                  )}
                </td>
                {miners.map((m) => {
                  const val = getCellValue(m, row.key)
                  const color = TASK_COLORS[m.task_type] ?? strategyColor(m.strategy)
                  return (
                    <td key={m.uid} style={cellStyle(highlight, color)}>
                      {formatCellValue(val, row.key)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

export function MinerComparison({ miners }: MinerComparisonProps) {
  const [diffMode, setDiffMode] = useState(false)

  if (!miners.length) return null

  return (
    <section
      id="miners"
      style={{ padding: '64px 32px', borderTop: '1px solid var(--bp-border)' }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '10px' }}>02 — NODES</p>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 5vw, 56px)',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--bp-text-primary)',
            marginBottom: '8px',
            lineHeight: 1.1,
          }}
        >
          Active <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Miners</span>
        </h2>
        <p style={{ fontFamily: 'var(--font-sans)', fontSize: '15px', color: 'var(--bp-text-muted)', marginBottom: '24px', lineHeight: 1.6 }}>
          {miners.length} task-specialised axons queried this epoch · Each produces a different evaluation commodity
        </p>

        {miners.length > 1 && (
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={() => setDiffMode((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: '11px',
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color: diffMode ? '#0D0F14' : 'var(--bp-text-muted)',
                background: diffMode ? 'var(--bp-gold)' : 'transparent',
                border: `1px solid ${diffMode ? 'var(--bp-gold)' : 'var(--bp-border)'}`,
                borderRadius: '2px', cursor: 'pointer', transition: 'all 150ms ease-out',
              }}
            >
              <span style={{ fontSize: '13px' }}>⇄</span>
              Diff Miner Outputs
            </button>
          </div>
        )}

        {diffMode ? (
          <DiffTable miners={miners} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(miners.length, 3)}, 1fr)`,
              gap: '16px',
            }}
          >
            {miners.map((m) => (
              <MinerCard key={m.uid} miner={m} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
