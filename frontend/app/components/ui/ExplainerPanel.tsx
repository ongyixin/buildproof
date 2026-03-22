'use client'

import { useState, useEffect } from 'react'

const TERMS = [
  {
    label: 'Miners',
    description: 'Independent AI evaluators that compete to produce the best proposal reviews.',
    color: 'var(--bp-teal)',
  },
  {
    label: 'Validator',
    description: 'Scores miner responses on quality, calibration, robustness, and efficiency.',
    color: 'var(--bp-gold)',
  },
  {
    label: 'Weights',
    description: 'On-chain reward allocation — better miners earn a larger share of emissions.',
    color: 'var(--bp-purple)',
  },
  {
    label: 'Arena',
    description: 'Adversarial stress testing where deceptive proposals expose weak miners.',
    color: 'var(--bp-red)',
  },
  {
    label: 'Payout',
    description: 'Downstream reward disbursement triggered by evaluation consensus.',
    color: '#22C55E',
  },
]

export function ExplainerPanel() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    try {
      const saved = localStorage.getItem('bp-explainer-open')
      if (saved === 'true') setOpen(true)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem('bp-explainer-open', String(open))
    } catch { /* ignore */ }
  }, [open, mounted])

  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '24px',
        zIndex: 50,
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
            borderLeft: '2px solid var(--bp-gold)',
            borderRadius: '4px',
            padding: '16px',
            width: '280px',
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
              marginBottom: '12px',
            }}
          >
            WHAT AM I LOOKING AT?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {TERMS.map((term) => (
              <div key={term.label}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: term.color,
                    letterSpacing: '0.04em',
                  }}
                >
                  {term.label}
                </span>
                <p
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '12px',
                    color: 'var(--bp-text-muted)',
                    lineHeight: 1.5,
                    marginTop: '2px',
                  }}
                >
                  {term.description}
                </p>
              </div>
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
          background: open ? 'var(--bp-gold)' : 'var(--bp-surface)',
          border: `1px solid ${open ? 'var(--bp-gold)' : 'var(--bp-border)'}`,
          color: open ? '#0D0F14' : 'var(--bp-text-muted)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: '16px',
          fontWeight: 700,
          transition: 'all 150ms ease-out',
          boxShadow: open ? '0 0 12px var(--bp-gold-glow)' : 'none',
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
            e.currentTarget.style.color = 'var(--bp-text-muted)'
          }
        }}
        aria-label={open ? 'Close explainer' : 'What am I looking at?'}
      >
        ?
      </button>
    </div>
  )
}
