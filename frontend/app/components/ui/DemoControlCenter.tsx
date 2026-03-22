'use client'

import { useState, useEffect } from 'react'

interface DemoControlCenterProps {
  onLoadCannedData: () => void
  onResetDemo: () => void
  onTriggerBenchmark: () => void
  onTriggerAdversarial: () => void
  onToggleTicker: () => void
  tickerVisible: boolean
}

export function DemoControlCenter({
  onLoadCannedData,
  onResetDemo,
  onTriggerBenchmark,
  onTriggerAdversarial,
  onToggleTicker,
  tickerVisible,
}: DemoControlCenterProps) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  if (!mounted) return null

  const actions = [
    {
      label: 'LOAD CANNED DATA',
      description: 'Pre-populate all sections',
      color: 'var(--bp-teal)',
      onClick: onLoadCannedData,
    },
    {
      label: 'RESET DEMO',
      description: 'Clear all state',
      color: 'var(--bp-red)',
      onClick: onResetDemo,
    },
    {
      label: 'RUN BENCHMARK',
      description: 'Seed benchmark proposals',
      color: 'var(--bp-gold)',
      onClick: onTriggerBenchmark,
    },
    {
      label: 'ADVERSARIAL RUN',
      description: 'Trigger stress test',
      color: 'var(--bp-red)',
      onClick: onTriggerAdversarial,
    },
    {
      label: tickerVisible ? 'HIDE TICKER' : 'SHOW TICKER',
      description: 'Activity event feed',
      color: 'var(--bp-purple)',
      onClick: onToggleTicker,
    },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 51,
      }}
    >
      {/* Expanded panel */}
      <div
        style={{
          maxHeight: open ? '400px' : '0',
          opacity: open ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 200ms ease-out, opacity 150ms ease-out',
          marginBottom: open ? '8px' : '0',
        }}
      >
        <div
          style={{
            background: 'var(--bp-surface)',
            border: '1px solid var(--bp-border)',
            borderRadius: '4px',
            padding: '12px',
            width: '220px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--bp-gold-dim)',
              marginBottom: '10px',
            }}
          >
            DEMO CONTROLS
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {actions.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  action.onClick()
                  setOpen(false)
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1px',
                  width: '100%',
                  padding: '8px 10px',
                  textAlign: 'left',
                  background: 'none',
                  border: '1px solid transparent',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  transition: 'all 150ms ease-out',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bp-surface-2)'
                  e.currentTarget.style.borderColor = 'var(--bp-border)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'none'
                  e.currentTarget.style.borderColor = 'transparent'
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: action.color,
                    letterSpacing: '0.06em',
                  }}
                >
                  {action.label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: 'var(--bp-text-dim)',
                  }}
                >
                  {action.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: open ? 'var(--bp-surface-2)' : 'var(--bp-surface)',
          border: `1px solid ${open ? 'var(--bp-gold)' : 'var(--bp-border)'}`,
          color: open ? 'var(--bp-gold)' : 'var(--bp-text-dim)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 150ms ease-out',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = 'var(--bp-gold)'
            e.currentTarget.style.color = 'var(--bp-gold)'
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.borderColor = 'var(--bp-border)'
            e.currentTarget.style.color = 'var(--bp-text-dim)'
          }
        }}
        aria-label={open ? 'Close demo controls' : 'Open demo controls'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
