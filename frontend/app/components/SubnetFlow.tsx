'use client'

import { useMemo } from 'react'
import type { EvaluationEvent } from '@/types/models'

// ── Node state ────────────────────────────────────────────────────────────────

export type NodeState = 'idle' | 'running' | 'done' | 'failed' | 'timeout'

export interface RewardScore {
  uid: number
  taskType: string
  quality: number
  calibration: number
  robustness: number
  efficiency: number
  composite: number
}

export interface MinerNodeData {
  uid: number
  taskType: string
  latencyMs?: number
  backend?: string
  state: NodeState
}

export interface SubnetFlowState {
  proposal: NodeState
  validator: NodeState
  miners: MinerNodeData[]
  rewardEngine: NodeState
  chain: NodeState
  decision: NodeState
  rewardScores?: RewardScore[]
}

// ── Derive flow state from events ─────────────────────────────────────────────

export function deriveFlowState(events: EvaluationEvent[]): SubnetFlowState {
  const state: SubnetFlowState = {
    proposal: 'idle',
    validator: 'idle',
    miners: [],
    rewardEngine: 'idle',
    chain: 'idle',
    decision: 'idle',
  }

  const minerMap = new Map<number, MinerNodeData>()

  for (const ev of events) {
    switch (ev.event_type) {
      case 'proposal_queued':
        state.proposal = 'running'
        break

      case 'proposal_claimed':
        state.proposal = 'done'
        state.validator = 'running'
        break

      case 'synapse_built': {
        const p = ev.payload as { miner_uids?: number[]; task_types?: string[] }
        const uids = p.miner_uids ?? []
        const types = p.task_types ?? []
        uids.forEach((uid, i) => {
          if (!minerMap.has(uid)) {
            minerMap.set(uid, { uid, taskType: types[i] ?? 'unknown', state: 'idle' })
          }
        })
        break
      }

      case 'miner_query_sent': {
        const p = ev.payload as { uid?: number; task_type?: string }
        const uid = p.uid ?? 0
        const existing = minerMap.get(uid)
        minerMap.set(uid, {
          uid,
          taskType: p.task_type ?? existing?.taskType ?? 'unknown',
          state: 'running',
          latencyMs: existing?.latencyMs,
          backend: existing?.backend,
        })
        break
      }

      case 'miner_response_received': {
        const p = ev.payload as { uid?: number; latency_ms?: number; backend?: string }
        const uid = p.uid ?? 0
        const existing = minerMap.get(uid)
        minerMap.set(uid, {
          ...(existing ?? { uid, taskType: 'unknown' }),
          uid,
          state: 'done',
          latencyMs: p.latency_ms,
          backend: p.backend,
        })
        break
      }

      case 'miner_timeout': {
        const p = ev.payload as { uid?: number; latency_ms?: number }
        const uid = p.uid ?? 0
        const existing = minerMap.get(uid)
        minerMap.set(uid, {
          ...(existing ?? { uid, taskType: 'unknown' }),
          uid,
          state: 'timeout',
          latencyMs: p.latency_ms,
        })
        break
      }

      case 'reward_scored': {
        const p = ev.payload as { scores?: SubnetFlowState['rewardScores'] }
        state.rewardEngine = 'running'
        if (p.scores) state.rewardScores = p.scores
        break
      }

      case 'ema_updated':
        state.rewardEngine = 'done'
        state.chain = 'running'
        break

      case 'weights_submitted':
        state.chain = 'done'
        break

      case 'decision_packet_ready':
        state.validator = 'done'
        state.chain = 'done'
        state.decision = 'done'
        if (state.rewardEngine !== 'done') state.rewardEngine = 'done'
        break
    }
  }

  state.miners = Array.from(minerMap.values())

  // Inference pass: fill in upstream states that may be absent when the
  // direct-eval path is used or events arrive out of order.

  // Any miner activity implies the proposal was claimed and the validator is active.
  if (state.miners.length > 0 && state.proposal !== 'done') {
    state.proposal = 'done'
  }
  if (state.miners.length > 0 && state.validator === 'idle') {
    state.validator = 'running'
  }

  // All miners finished → reward engine should be at least running.
  if (
    state.miners.length > 0 &&
    state.miners.every((m) => m.state === 'done' || m.state === 'timeout') &&
    state.rewardEngine === 'idle'
  ) {
    state.rewardEngine = 'running'
  }

  return state
}

// ── Color tokens ──────────────────────────────────────────────────────────────

const STATE_COLORS: Record<NodeState, { border: string; dot: string; label: string; glow: string }> = {
  idle:    { border: 'var(--bp-border)',       dot: 'var(--bp-border)',    label: 'var(--bp-text-dim)',     glow: 'transparent' },
  running: { border: 'var(--bp-gold)',          dot: 'var(--bp-gold)',      label: 'var(--bp-gold)',         glow: 'rgba(245,166,35,0.08)' },
  done:    { border: 'var(--bp-teal)',          dot: 'var(--bp-teal)',      label: 'var(--bp-teal)',         glow: 'rgba(0,201,167,0.06)' },
  failed:  { border: 'var(--bp-red)',           dot: 'var(--bp-red)',       label: 'var(--bp-red)',          glow: 'rgba(224,82,82,0.08)' },
  timeout: { border: 'var(--bp-text-muted)',   dot: 'var(--bp-text-muted)', label: 'var(--bp-text-muted)', glow: 'transparent' },
}

const STATE_BADGE: Record<NodeState, string> = {
  idle:    'IDLE',
  running: 'ACTIVE',
  done:    'DONE',
  failed:  'FAILED',
  timeout: 'TIMEOUT',
}

const TASK_COLORS: Record<string, string> = {
  rubric:    'var(--bp-gold)',
  diligence: 'var(--bp-teal)',
  risk:      'var(--bp-red)',
}

const TASK_LABELS: Record<string, string> = {
  rubric:    'RUBRIC',
  diligence: 'DILIGENCE',
  risk:      'RISK',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PipelineNode({
  label,
  sublabel,
  state,
  detail,
  wide,
}: {
  label: string
  sublabel?: string
  state: NodeState
  detail?: React.ReactNode
  wide?: boolean
}) {
  const c = STATE_COLORS[state]

  return (
    <div
      style={{
        position: 'relative',
        width: wide ? '100px' : '84px',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          border: `1px solid ${c.border}`,
          borderRadius: '4px',
          padding: '10px 8px 8px',
          background: c.glow,
          transition: 'border-color 200ms ease-out, background 200ms ease-out',
        }}
      >
        {/* State dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: c.dot,
              flexShrink: 0,
              animation: state === 'running' ? 'pulseGold 1.2s ease-in-out infinite' : undefined,
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              letterSpacing: '0.08em',
              color: c.label,
              fontWeight: 600,
            }}
          >
            {STATE_BADGE[state]}
          </span>
        </div>

        {/* Node label */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            fontWeight: 700,
            color: state === 'idle' ? 'var(--bp-text-dim)' : 'var(--bp-text-primary)',
            letterSpacing: '0.04em',
            lineHeight: 1.2,
            marginBottom: sublabel ? '3px' : 0,
          }}
        >
          {label}
        </div>

        {sublabel && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '9px',
              color: 'var(--bp-text-muted)',
              letterSpacing: '0.04em',
            }}
          >
            {sublabel}
          </div>
        )}

        {detail && (
          <div style={{ marginTop: '6px' }}>
            {detail}
          </div>
        )}
      </div>
    </div>
  )
}

function EdgeArrow({ active, vertical }: { active: boolean; vertical?: boolean }) {
  if (vertical) {
    return (
      <div
        style={{
          width: '1px',
          height: '12px',
          background: active ? 'var(--bp-border-hover)' : 'var(--bp-border)',
          margin: '0 auto',
          position: 'relative',
          transition: 'background 300ms',
        }}
      >
        {active && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '-2px',
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: 'var(--bp-gold)',
              animation: 'slideDown 1.2s ease-in-out infinite',
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        flexShrink: 0,
        position: 'relative',
        width: '28px',
      }}
    >
      <div
        style={{
          height: '1px',
          width: '100%',
          background: active ? 'var(--bp-border-hover)' : 'var(--bp-border)',
          transition: 'background 300ms',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {active && (
          <div
            style={{
              position: 'absolute',
              top: '-2px',
              left: 0,
              width: '6px',
              height: '5px',
              borderRadius: '50%',
              background: 'var(--bp-gold)',
              animation: 'slideRight 1s ease-in-out infinite',
            }}
          />
        )}
      </div>
      <div
        style={{
          width: 0,
          height: 0,
          borderTop: '3px solid transparent',
          borderBottom: '3px solid transparent',
          borderLeft: `4px solid ${active ? 'var(--bp-border-hover)' : 'var(--bp-border)'}`,
          flexShrink: 0,
          transition: 'border-left-color 300ms',
        }}
      />
    </div>
  )
}

function MinerNode({ miner, score }: {
  miner: MinerNodeData
  score?: RewardScore
}) {
  const c = STATE_COLORS[miner.state]
  const taskColor = TASK_COLORS[miner.taskType] ?? 'var(--bp-text-dim)'
  const taskLabel = TASK_LABELS[miner.taskType] ?? miner.taskType.toUpperCase()

  return (
    <div
      style={{
        border: `1px solid ${c.border}`,
        borderRadius: '4px',
        padding: '8px',
        background: c.glow,
        transition: 'border-color 200ms ease-out, background 200ms ease-out',
        width: '100px',
        flexShrink: 0,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px' }}>
        <div
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: c.dot,
            flexShrink: 0,
            animation: miner.state === 'running' ? 'pulseGold 1.2s ease-in-out infinite' : undefined,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            color: miner.state === 'idle' ? 'var(--bp-text-dim)' : 'var(--bp-text-primary)',
            letterSpacing: '0.04em',
          }}
        >
          MINER {miner.uid}
        </span>
      </div>

      {/* Task badge */}
      <div
        style={{
          display: 'inline-block',
          fontFamily: 'var(--font-mono)',
          fontSize: '8px',
          letterSpacing: '0.06em',
          color: taskColor,
          border: `1px solid ${taskColor}`,
          padding: '1px 4px',
          borderRadius: '2px',
          marginBottom: '4px',
          opacity: miner.state === 'idle' ? 0.4 : 1,
        }}
      >
        {taskLabel}
      </div>

      {/* Latency */}
      {miner.latencyMs != null && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--bp-text-muted)',
            marginTop: '3px',
          }}
        >
          {(miner.latencyMs / 1000).toFixed(1)}s
        </div>
      )}

      {/* Composite score */}
      {score && (
        <div
          style={{
            marginTop: '4px',
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            color: 'var(--bp-teal)',
          }}
        >
          {(score.composite * 100).toFixed(0)}% composite
        </div>
      )}

      {/* Status */}
      <div
        style={{
          marginTop: '3px',
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          letterSpacing: '0.06em',
          color: c.label,
        }}
      >
        {STATE_BADGE[miner.state]}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface SubnetFlowProps {
  events: EvaluationEvent[]
}

export function SubnetFlow({ events }: SubnetFlowProps) {
  const flow = useMemo(() => deriveFlowState(events), [events])

  const scoreByUid = useMemo(() => {
    const m = new Map<number, RewardScore>()
    for (const s of flow.rewardScores ?? []) m.set(s.uid, s)
    return m
  }, [flow.rewardScores])

  // Build miner rows for the fan-out section (max 4 visible, +N more label)
  const visibleMiners = flow.miners.slice(0, 4)
  const extraMiners = flow.miners.length - visibleMiners.length

  const anyMinerRunning = flow.miners.some((m) => m.state === 'running')
  const anyMinerDoneOrTimeout = flow.miners.some((m) => m.state === 'done' || m.state === 'timeout')

  return (
    <div
      style={{
        padding: '20px 24px',
        background: 'var(--bp-surface)',
        borderRadius: '4px',
        border: '1px solid var(--bp-border)',
        overflowX: 'auto',
      }}
    >
      {/* ── Pipeline row ────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0',
          minWidth: '720px',
        }}
      >
        {/* Proposal node */}
        <PipelineNode
          label="PROPOSAL"
          sublabel="submitted"
          state={flow.proposal}
        />

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center', paddingTop: '4px' }}>
          <EdgeArrow active={flow.proposal === 'done'} />
        </div>

        {/* Validator node */}
        <PipelineNode
          label="VALIDATOR"
          sublabel="bt.dendrite"
          state={flow.validator}
          wide
          detail={
            flow.validator !== 'idle' && flow.miners.length > 0 ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-muted)' }}>
                {flow.miners.length} miner{flow.miners.length > 1 ? 's' : ''} queued
              </div>
            ) : null
          }
        />

        {/* Fan-out arrow + miner column */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '6px',
            paddingTop: '4px',
            flexShrink: 0,
          }}
        >
          {visibleMiners.length === 0 ? (
            // No miners yet — show placeholder arrows
            [0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', height: '72px' }}>
                <EdgeArrow active={false} />
                <div
                  style={{
                    width: '100px',
                    height: '60px',
                    border: '1px dashed var(--bp-border)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)' }}>
                    MINER {i + 1}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <>
              {visibleMiners.map((miner) => (
                <div key={miner.uid} style={{ display: 'flex', alignItems: 'center' }}>
                  <EdgeArrow active={flow.validator === 'running' || flow.validator === 'done'} />
                  <MinerNode miner={miner} score={scoreByUid.get(miner.uid)} />
                </div>
              ))}
              {extraMiners > 0 && (
                <div
                  style={{
                    paddingLeft: '32px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    color: 'var(--bp-text-dim)',
                    letterSpacing: '0.06em',
                  }}
                >
                  +{extraMiners} more
                </div>
              )}
            </>
          )}
        </div>

        {/* Fan-in arrows */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: '6px',
            paddingTop: '4px',
            flexShrink: 0,
            alignSelf: 'center',
          }}
        >
          {(visibleMiners.length > 0 ? visibleMiners : [{}, {}, {}]).map((_, i) => (
            <div key={i} style={{ height: '72px', display: 'flex', alignItems: 'center' }}>
              <EdgeArrow active={anyMinerDoneOrTimeout} />
            </div>
          ))}
        </div>

        {/* Reward engine */}
        <div style={{ alignSelf: 'center' }}>
          <PipelineNode
            label="REWARD"
            sublabel="engine"
            state={flow.rewardEngine}
            wide
            detail={
              flow.rewardScores && flow.rewardScores.length > 0 ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-muted)' }}>
                  {flow.rewardScores.length} scored
                </div>
              ) : null
            }
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center', paddingTop: '4px' }}>
          <EdgeArrow active={flow.rewardEngine === 'done'} />
        </div>

        {/* Chain */}
        <div style={{ alignSelf: 'center' }}>
          <PipelineNode
            label="CHAIN"
            sublabel="set_weights"
            state={flow.chain}
            detail={
              flow.chain === 'done' ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-teal)' }}>
                  weights set
                </div>
              ) : null
            }
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'center', paddingTop: '4px' }}>
          <EdgeArrow active={flow.chain === 'done'} />
        </div>

        {/* Decision packet */}
        <div style={{ alignSelf: 'center' }}>
          <PipelineNode
            label="DECISION"
            sublabel="packet"
            state={flow.decision}
            wide
            detail={
              flow.decision === 'done' ? (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-teal)' }}>
                  ready
                </div>
              ) : null
            }
          />
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: '16px',
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        {(['idle', 'running', 'done', 'timeout'] as NodeState[]).map((s) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: STATE_COLORS[s].dot,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--bp-text-dim)',
                letterSpacing: '0.06em',
              }}
            >
              {s.toUpperCase()}
            </span>
          </div>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
          {(['rubric', 'diligence', 'risk'] as const).map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '1px',
                  background: TASK_COLORS[t],
                  opacity: 0.7,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  color: 'var(--bp-text-dim)',
                  letterSpacing: '0.04em',
                }}
              >
                {TASK_LABELS[t]}
              </span>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes slideRight {
          0%   { transform: translateX(0); opacity: 1; }
          80%  { transform: translateX(22px); opacity: 0.6; }
          100% { transform: translateX(28px); opacity: 0; }
        }
        @keyframes slideDown {
          0%   { transform: translateY(0); opacity: 1; }
          80%  { transform: translateY(8px); opacity: 0.6; }
          100% { transform: translateY(12px); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
