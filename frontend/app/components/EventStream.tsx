'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { EvaluationEvent } from '@/types/models'
import { getReplayEvents } from '@/lib/api'

// ── Display helpers ───────────────────────────────────────────────────────────

const EVENT_SOURCE_COLOR: Record<string, string> = {
  api:       'var(--bp-gold)',
  validator: 'var(--bp-purple)',
  chain:     'var(--bp-gold)',
}

function sourceColor(source: string): string {
  if (source.startsWith('miner:')) return 'var(--bp-teal)'
  return EVENT_SOURCE_COLOR[source] ?? 'var(--bp-text-muted)'
}

const SOURCE_LABEL: Record<string, string> = {
  api:       'API ',
  validator: 'VALI',
  chain:     'CHN ',
}

function sourceLabel(source: string): string {
  if (source.startsWith('miner:')) {
    const uid = source.split(':')[1]
    return `M${uid.padStart(3, ' ')}`
  }
  return SOURCE_LABEL[source] ?? source.slice(0, 4).toUpperCase().padEnd(4)
}

function formatEventMessage(ev: EvaluationEvent): string {
  const p = ev.payload as Record<string, unknown>

  switch (ev.event_type) {
    case 'proposal_queued':
      return `Proposal ${String(p.proposal_id ?? '').slice(0, 10)} queued`

    case 'proposal_claimed':
      return `Validator claimed proposal${p.title ? ` — ${String(p.title).slice(0, 40)}` : ''}`

    case 'synapse_built': {
      const uids = (p.miner_uids as number[] | undefined) ?? []
      const types = (p.task_types as string[] | undefined) ?? []
      const parts = uids.map((uid, i) => `${uid}(${types[i] ?? '?'})`)
      return `Synapse built — querying miners [${parts.join(', ')}]`
    }

    case 'miner_query_sent':
      return `Sent ${p.task_type ?? '?'} synapse → miner ${p.uid}`

    case 'miner_response_received': {
      const ms = p.latency_ms != null ? ` in ${Number(p.latency_ms).toFixed(0)}ms` : ''
      const be = p.backend ? ` via ${p.backend}` : ''
      return `Miner ${p.uid} responded${ms}${be}`
    }

    case 'miner_timeout':
      return `Miner ${p.uid} timed out after ${Number(p.latency_ms ?? 0).toFixed(0)}ms`

    case 'reward_scored': {
      const scores = (p.scores as Array<{ uid: number; composite: number }> | undefined) ?? []
      if (scores.length === 0) return 'Rewards computed'
      const summary = scores
        .map((s) => `uid${s.uid}=${(s.composite * 100).toFixed(0)}%`)
        .join('  ')
      return `Rewards scored: ${summary}`
    }

    case 'ema_updated': {
      const uids = (p.updated_uids as number[] | undefined) ?? []
      return `EMA scores updated for uids [${uids.join(', ')}]`
    }

    case 'weights_submitted': {
      const uids = (p.uids as number[] | undefined) ?? []
      return `Weights submitted to chain${uids.length ? ` for ${uids.length} UIDs` : ''}`
    }

    case 'decision_packet_ready':
      return `Decision packet ready — ${p.miner_count ?? '?'} miners evaluated`

    default:
      return (ev.event_type as string).replace(/_/g, ' ')
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

// ── Component ─────────────────────────────────────────────────────────────────

interface EventStreamProps {
  events: EvaluationEvent[]
  proposalId?: string
  maxHeight?: number
}

export function EventStream({ events, proposalId, maxHeight = 180 }: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(false)
  const [replaying, setReplaying] = useState(false)
  const [replayEvents, setReplayEvents] = useState<EvaluationEvent[]>([])
  const [displayedReplay, setDisplayedReplay] = useState<EvaluationEvent[]>([])
  const replayRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const displayedEvents = replaying ? displayedReplay : events

  useEffect(() => {
    if (userScrolled.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [displayedEvents])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 40
  }

  const startReplay = useCallback(async () => {
    if (!proposalId || replaying) return
    setReplaying(true)
    setDisplayedReplay([])
    try {
      const { events: allEvents } = await getReplayEvents(proposalId)
      setReplayEvents(allEvents)
    } catch {
      const allEvents = events
      setReplayEvents(allEvents)
    }
  }, [proposalId, replaying, events])

  useEffect(() => {
    if (!replaying || replayEvents.length === 0) return
    let idx = 0
    const tick = () => {
      if (idx >= replayEvents.length) {
        setTimeout(() => setReplaying(false), 1200)
        return
      }
      setDisplayedReplay((prev) => [...prev, replayEvents[idx++]])
      replayRef.current = setTimeout(tick, 280)
    }
    replayRef.current = setTimeout(tick, 50)
    return () => { if (replayRef.current) clearTimeout(replayRef.current) }
  }, [replaying, replayEvents])

  return (
    <div
      style={{
        border: '1px solid var(--bp-border)',
        borderRadius: '4px',
        background: 'var(--bp-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 12px',
          borderBottom: '1px solid var(--bp-border)',
          background: 'var(--bp-surface-2)',
        }}
      >
        <div
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: displayedEvents.length > 0 ? (replaying ? 'var(--bp-gold)' : 'var(--bp-teal)') : 'var(--bp-text-dim)',
            animation: replaying ? 'pulseGold 1.2s ease-in-out infinite' : (displayedEvents.length > 0 ? 'pulseGreen 2s ease-in-out infinite' : undefined),
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', color: replaying ? 'var(--bp-gold)' : 'var(--bp-text-dim)' }}>
          {replaying ? 'REPLAYING' : 'EVENT TIMELINE'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)' }}>
            {displayedEvents.length} event{displayedEvents.length !== 1 ? 's' : ''}
          </span>
          {proposalId && events.length > 0 && !replaying && (
            <button
              onClick={startReplay}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.08em', textTransform: 'uppercase',
                color: 'var(--bp-gold)', background: 'none', border: '1px solid rgba(245,166,35,0.4)',
                borderRadius: '2px', padding: '2px 8px', cursor: 'pointer', transition: 'all 150ms ease-out',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,166,35,0.1)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
            >
              ▶ Replay
            </button>
          )}
        </span>
      </div>

      {/* Events */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          overflowY: 'auto',
          maxHeight,
          padding: '6px 12px',
        }}
      >
        {displayedEvents.length === 0 ? (
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--bp-text-dim)',
              padding: '8px 0',
              lineHeight: 1.6,
            }}
          >
            Waiting for subnet events…
          </p>
        ) : (
          displayedEvents.map((ev) => (
            <div
              key={ev.id}
              className="animate-slide-in-left"
              style={{
                display: 'flex',
                gap: '10px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                lineHeight: 1.9,
                borderBottom: '1px solid rgba(37,42,54,0.5)',
              }}
            >
              {/* Timestamp */}
              <span
                style={{
                  color: 'var(--bp-text-dim)',
                  flexShrink: 0,
                  fontSize: '10px',
                  paddingTop: '1px',
                  letterSpacing: '0.02em',
                }}
              >
                {formatTimestamp(ev.timestamp)}
              </span>

              {/* Source badge */}
              <span
                style={{
                  color: sourceColor(ev.source),
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  width: '32px',
                  flexShrink: 0,
                  fontSize: '10px',
                  paddingTop: '1px',
                }}
              >
                {sourceLabel(ev.source)}
              </span>

              {/* Message */}
              <span
                style={{
                  color: 'var(--bp-text-muted)',
                  flex: 1,
                  overflowWrap: 'break-word',
                  wordBreak: 'break-all',
                }}
              >
                {formatEventMessage(ev)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
