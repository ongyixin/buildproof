'use client'

import { useState, useEffect } from 'react'

export interface StepState {
  done: boolean
  active: boolean
  locked: boolean
}

interface DemoStepperProps {
  activeSection: string
  hasResult: boolean
  isProcessing: boolean
  hasLeaderboard: boolean
  hasArenaResult: boolean
  payoutComplete: boolean
}

const STEPS = [
  { id: 'why',    label: 'Why',     purpose: 'The problem we solve',        next: 'Submit a proposal' },
  { id: 'submit', label: 'Submit',  purpose: 'Upload a funding proposal',   next: 'See miner outputs' },
  { id: 'miners', label: 'Miners',  purpose: 'Compare evaluator responses', next: 'View validator scores' },
  { id: 'scores', label: 'Scores',  purpose: 'Validator scoring breakdown',  next: 'Check rankings' },
  { id: 'ranks',  label: 'Ranks',   purpose: 'Miner leaderboard & weights', next: 'Stress test miners' },
  { id: 'arena',  label: 'Arena',   purpose: 'Adversarial robustness test', next: 'Trigger payout' },
  { id: 'payout', label: 'Payout',  purpose: 'Solana devnet disbursement',  next: null },
] as const

function deriveStepStates(props: DemoStepperProps): StepState[] {
  const { hasResult, isProcessing, hasLeaderboard, hasArenaResult, payoutComplete } = props

  return STEPS.map((step) => {
    switch (step.id) {
      case 'why':
        return { done: true, active: false, locked: false }
      case 'submit':
        return { done: hasResult || isProcessing, active: !hasResult && !isProcessing, locked: false }
      case 'miners':
        return { done: hasResult, active: isProcessing, locked: !hasResult && !isProcessing }
      case 'scores':
        return { done: hasResult, active: false, locked: !hasResult }
      case 'ranks':
        return { done: hasLeaderboard, active: false, locked: false }
      case 'arena':
        return { done: hasArenaResult, active: false, locked: false }
      case 'payout':
        return { done: payoutComplete, active: false, locked: false }
      default:
        return { done: false, active: false, locked: true }
    }
  })
}

function StepDot({ state }: { state: StepState }) {
  if (state.done) {
    return (
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--bp-teal)',
          flexShrink: 0,
        }}
      />
    )
  }
  if (state.active) {
    return (
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--bp-gold)',
          animation: 'pulseGold 1.2s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
    )
  }
  return (
    <span
      style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: 'var(--bp-text-dim)',
        flexShrink: 0,
      }}
    />
  )
}

const SECTION_THEMES: Record<string, { bg: string; border: string; activeColor: string; doneColor: string; font: string }> = {
  why:    { bg: '#FAF8F5', border: '#D8D3C9', activeColor: '#2D4A7A', doneColor: '#2D8B7A', font: "'Source Sans 3', system-ui, sans-serif" },
  submit: { bg: '#FAF8F5', border: '#D8D3C9', activeColor: '#2D4A7A', doneColor: '#2D8B7A', font: "'Source Sans 3', system-ui, sans-serif" },
  miners: { bg: '#000000', border: '#1E1E1E', activeColor: '#F59E0B', doneColor: '#22C55E', font: "'Barlow', system-ui, sans-serif" },
  scores: { bg: '#000000', border: '#1E1E1E', activeColor: '#F59E0B', doneColor: '#22C55E', font: "'Barlow', system-ui, sans-serif" },
  ranks:  { bg: '#000000', border: '#1E1E1E', activeColor: '#F59E0B', doneColor: '#22C55E', font: "'Barlow', system-ui, sans-serif" },
  arena:  { bg: '#0B1120', border: 'rgba(76,154,255,0.2)', activeColor: '#4C9AFF', doneColor: '#22C55E', font: "'DM Sans', system-ui, sans-serif" },
  payout: { bg: '#FFFFFF', border: '#E5E7EB', activeColor: '#1E40AF', doneColor: '#166534', font: "'Literata', Georgia, serif" },
}

export function DemoStepper(props: DemoStepperProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mounted, setMounted] = useState(false)
  const states = deriveStepStates(props)

  useEffect(() => { setMounted(true) }, [])

  const activeIdx = STEPS.findIndex((s) => s.id === props.activeSection)
  const nextStep = activeIdx >= 0 && activeIdx < STEPS.length - 1 ? STEPS[activeIdx] : null
  const theme = SECTION_THEMES[props.activeSection] ?? SECTION_THEMES.why

  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: '48px',
        left: 0,
        right: 0,
        zIndex: 39,
        background: theme.bg,
        borderBottom: `1px solid ${theme.border}`,
        transition: 'max-height 200ms ease-out, opacity 200ms ease-out, background 400ms ease, border-color 400ms ease',
        maxHeight: collapsed ? '0' : '40px',
        opacity: collapsed ? 0 : 1,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 32px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        {STEPS.map((step, i) => {
          const state = states[i]
          const isCurrent = props.activeSection === step.id
          const stepColor = state.locked ? theme.border : isCurrent ? theme.activeColor : state.done ? theme.doneColor : theme.border
          const textColor = state.locked ? theme.border : isCurrent ? theme.activeColor : state.done ? theme.doneColor : `${theme.activeColor}66`
          return (
            <div key={step.id} style={{ display: 'contents' }}>
              <a
                href={state.locked ? undefined : `#${step.id}`}
                onClick={state.locked ? (e) => e.preventDefault() : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '2px',
                  textDecoration: 'none',
                  cursor: state.locked ? 'not-allowed' : 'pointer',
                  background: isCurrent ? `${theme.activeColor}10` : 'transparent',
                  transition: 'background 150ms ease-out',
                }}
              >
                <span style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: isCurrent ? theme.activeColor : state.done ? theme.doneColor : 'transparent',
                  border: `1.5px solid ${stepColor}`,
                  flexShrink: 0,
                  animation: state.active ? 'pulseGold 1.2s ease-in-out infinite' : 'none',
                }} />
                <span
                  style={{
                    fontFamily: theme.font,
                    fontSize: '10px',
                    fontWeight: isCurrent ? 600 : 400,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: textColor,
                    whiteSpace: 'nowrap',
                    transition: 'color 400ms ease',
                  }}
                >
                  {step.label}
                </span>
              </a>
              {i < STEPS.length - 1 && (
                <span
                  style={{
                    width: '16px',
                    height: '1px',
                    background: state.done ? theme.doneColor : theme.border,
                    flexShrink: 0,
                    transition: 'background 300ms ease-out',
                  }}
                />
              )}
            </div>
          )
        })}

        {/* Next CTA */}
        {nextStep?.next && (
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: theme.font,
              fontSize: '10px',
              color: `${theme.activeColor}90`,
              whiteSpace: 'nowrap',
              letterSpacing: '0.04em',
              transition: 'color 400ms ease',
            }}
          >
            Next: {nextStep.next}
          </span>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(true)}
          style={{
            marginLeft: nextStep?.next ? '8px' : 'auto',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: `${theme.activeColor}60`,
            fontSize: '10px',
            padding: '4px',
            lineHeight: 1,
          }}
          aria-label="Hide stepper"
        >
          ▲
        </button>
      </div>
    </div>
  )
}

export function DemoStepperToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean
  onToggle: () => void
}) {
  if (!collapsed) return null
  return (
    <button
      onClick={onToggle}
      style={{
        position: 'fixed',
        top: '52px',
        right: '32px',
        zIndex: 39,
        background: 'var(--bp-surface)',
        border: '1px solid var(--bp-border)',
        borderRadius: '0 0 4px 4px',
        padding: '2px 10px',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--bp-text-dim)',
        letterSpacing: '0.08em',
        transition: 'color 150ms ease-out',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-gold)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-dim)' }}
    >
      ▼ JOURNEY
    </button>
  )
}
