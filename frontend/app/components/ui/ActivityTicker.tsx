'use client'

import { useEffect, useRef, useState } from 'react'

export interface ActivityEvent {
  id: number
  timestamp: string
  type: 'proposal' | 'miner' | 'validator' | 'weights' | 'payout' | 'arena'
  message: string
}

const TYPE_COLORS: Record<ActivityEvent['type'], string> = {
  proposal:  'var(--bp-gold)',
  miner:     'var(--bp-teal)',
  validator: 'var(--bp-purple)',
  weights:   'var(--bp-text-primary)',
  payout:    '#22C55E',
  arena:     'var(--bp-red)',
}

const TYPE_LABELS: Record<ActivityEvent['type'], string> = {
  proposal:  'PROP',
  miner:     'MINE',
  validator: 'VALI',
  weights:   'WGHT',
  payout:    'PAY',
  arena:     'ADVR',
}

interface ActivityTickerProps {
  events: ActivityEvent[]
  visible: boolean
  onToggle: () => void
}

export function ActivityTicker({ events, visible, onToggle }: ActivityTickerProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (userScrolled.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [events])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    userScrolled.current = dist > 40
  }

  if (!mounted) return null

  return (
    <>
      {/* Collapsed toggle */}
      {!visible && (
        <button
          onClick={onToggle}
          style={{
            position: 'fixed',
            bottom: '0',
            right: '80px',
            zIndex: 50,
            background: 'var(--bp-surface)',
            border: '1px solid var(--bp-border)',
            borderBottom: 'none',
            borderRadius: '4px 4px 0 0',
            padding: '4px 12px',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--bp-text-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'color 150ms ease-out',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-gold)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-dim)' }}
        >
          <span
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: events.length > 0 ? 'var(--bp-teal)' : 'var(--bp-text-dim)',
            }}
          />
          Activity {events.length > 0 && `(${events.length})`}
        </button>
      )}

      {/* Expanded ticker */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 48,
          maxHeight: visible ? '160px' : '0',
          opacity: visible ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out, opacity 150ms ease-out',
          background: 'var(--bp-surface)',
          borderTop: visible ? '1px solid var(--bp-border)' : 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 32px',
            borderBottom: '1px solid var(--bp-border)',
          }}
        >
          <span
            style={{
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: 'var(--bp-teal)',
              animation: 'pulseGreen 2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--bp-text-dim)',
            }}
          >
            ACTIVITY FEED
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--bp-text-dim)',
              marginLeft: 'auto',
            }}
          >
            {events.length} events
          </span>
          <button
            onClick={onToggle}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--bp-text-dim)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              padding: '2px 6px',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-text-muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-dim)' }}
          >
            ▼ Hide
          </button>
        </div>

        {/* Events */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            overflowY: 'auto',
            padding: '6px 32px',
            maxHeight: '120px',
          }}
        >
          {events.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-dim)',
                padding: '8px 0',
              }}
            >
              Waiting for activity...
            </p>
          ) : (
            events.slice(-20).map((ev) => (
              <div
                key={ev.id}
                className="animate-slide-in-left"
                style={{
                  display: 'flex',
                  gap: '12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  lineHeight: 1.8,
                }}
              >
                <span style={{ color: 'var(--bp-text-dim)', flexShrink: 0 }}>{ev.timestamp}</span>
                <span
                  style={{
                    color: TYPE_COLORS[ev.type],
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    width: '36px',
                    flexShrink: 0,
                  }}
                >
                  {TYPE_LABELS[ev.type]}
                </span>
                <span style={{ color: 'var(--bp-text-muted)' }}>{ev.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}

let _eventCounter = 0
export function createActivityEvent(
  type: ActivityEvent['type'],
  message: string
): ActivityEvent {
  const now = new Date()
  return {
    id: ++_eventCounter,
    timestamp: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
    type,
    message,
  }
}
