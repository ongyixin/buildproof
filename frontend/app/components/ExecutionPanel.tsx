'use client'

import { useEffect, useState, useRef } from 'react'
import { SubnetFlow } from './SubnetFlow'
import { EventStream } from './EventStream'
import { subscribeEvaluationEvents } from '@/lib/api'
import type { EvaluationEvent } from '@/types/models'
import type { ActivityEvent } from './ui/ActivityTicker'

interface ExecutionPanelProps {
  proposalId: string | null
  isActive: boolean
  onEventActivity?: (type: ActivityEvent['type'], message: string) => void
}

export function ExecutionPanel({ proposalId, isActive, onEventActivity }: ExecutionPanelProps) {
  const [events, setEvents] = useState<EvaluationEvent[]>([])
  const [isComplete, setIsComplete] = useState(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const lastProposalRef = useRef<string | null>(null)

  useEffect(() => {
    if (!proposalId || proposalId === lastProposalRef.current) return

    // Reset on new proposal
    setEvents([])
    setIsComplete(false)
    lastProposalRef.current = proposalId

    // Clean up any prior subscription
    cleanupRef.current?.()

    const cleanup = subscribeEvaluationEvents(
      proposalId,
      (ev) => {
        setEvents((prev) => {
          // Deduplicate by id
          if (prev.some((e) => e.id === ev.id)) return prev
          return [...prev, ev]
        })
        // Mirror key events to the parent activity ticker
        if (onEventActivity) {
          if (ev.event_type === 'proposal_claimed') {
            onEventActivity('validator' as const, `Validator claimed proposal ${proposalId.slice(0, 8)}`)
          } else if (ev.event_type === 'miner_response_received') {
            const p = ev.payload as { uid?: number; latency_ms?: number }
            onEventActivity(
              'miner' as const,
              `Miner ${p.uid} responded in ${Number(p.latency_ms ?? 0).toFixed(0)}ms`
            )
          } else if (ev.event_type === 'reward_scored') {
            onEventActivity('validator' as const, 'Rewards computed')
          } else if (ev.event_type === 'weights_submitted') {
            onEventActivity('weights' as const, 'Weights submitted to chain')
          } else if (ev.event_type === 'decision_packet_ready') {
            onEventActivity('validator' as const, 'Decision packet ready')
          }
        }
      },
      () => setIsComplete(true)
    )

    cleanupRef.current = cleanup
    return () => {
      cleanup()
      cleanupRef.current = null
    }
  }, [proposalId, onEventActivity])

  if (!proposalId) return null

  return (
    <section
      id="execution"
      style={{
        padding: '64px 32px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        {/* Section header */}
        <p
          className="section-label"
          style={{ marginBottom: '8px' }}
        >
          $ 02a — EXECUTION FLOW
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: '24px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(22px, 3vw, 36px)',
              fontWeight: 800,
              letterSpacing: '-0.02em',
              textTransform: 'uppercase',
              color: 'var(--bp-text-primary)',
              margin: 0,
            }}
          >
            SUBNET{' '}
            <span style={{ color: 'var(--bp-gold)' }}>PIPELINE</span>
          </h2>

          {/* Live / Done badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: isComplete ? 'var(--bp-teal)' : 'var(--bp-gold)',
                animation: isComplete
                  ? undefined
                  : 'pulseGold 1.2s ease-in-out infinite',
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                letterSpacing: '0.08em',
                color: isComplete ? 'var(--bp-teal)' : 'var(--bp-gold)',
              }}
            >
              {isComplete ? 'EVALUATION COMPLETE' : 'RUNNING'}
            </span>
          </div>
        </div>

        {/* Subtitle */}
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '13px',
            color: 'var(--bp-text-muted)',
            marginBottom: '24px',
            lineHeight: 1.6,
            maxWidth: '560px',
          }}
        >
          Live view of the Bittensor subnet as it processes the proposal.
          Each node reflects real validator and miner state.
        </p>

        {/* Animated pipeline graph */}
        <SubnetFlow events={events} />

        {/* Event timeline */}
        <div style={{ marginTop: '16px' }}>
          <EventStream events={events} proposalId={proposalId} maxHeight={220} />
        </div>
      </div>
    </section>
  )
}
