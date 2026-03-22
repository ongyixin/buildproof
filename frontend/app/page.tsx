'use client'

import { useState, useEffect, useCallback } from 'react'
import { AlertCircle, Loader2, Wifi } from 'lucide-react'

import { MarketDemand } from './components/MarketDemand'
import { ProposalUpload } from './components/ProposalUpload'
import { MinerComparison } from './components/MinerComparison'
import { ValidatorScores } from './components/ValidatorScores'
import { Leaderboard } from './components/Leaderboard'
import { AdversarialArena } from './components/AdversarialArena'
import { PayoutButton } from './components/PayoutButton'
import { ExecutionPanel } from './components/ExecutionPanel'
import { ChainWritePanel } from './components/ChainWritePanel'
import { MainnetRoadmap } from './components/MainnetRoadmap'
import { ToastProvider } from './components/ui/Toast'
import { MinerCardSkeleton } from './components/ui/Skeleton'

import { DemoStepper } from './components/ui/DemoStepper'
import { ExplainerPanel } from './components/ui/ExplainerPanel'
import { ActivityTicker, createActivityEvent } from './components/ui/ActivityTicker'
import type { ActivityEvent } from './components/ui/ActivityTicker'
import { DemoControlCenter } from './components/ui/DemoControlCenter'

import {
  pollProposalResult,
  getLeaderboard,
  runBenchmark,
  triggerDirectEvaluation,
  MOCK_LEADERBOARD,
  MOCK_PROPOSAL_RESULT,
} from '@/lib/api'
import type { ProposalResult, LeaderboardEntry } from '@/types/models'

// ── Section IDs for IntersectionObserver ──────────────────────────────────────

const SECTION_IDS = ['why', 'submit', 'miners', 'scores', 'ranks', 'arena', 'payout']

// ── Lightning bolt icon ───────────────────────────────────────────────────────

function LightningBolt() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
      <path
        d="M7 1L1 8h5l-1 5L11 6H6l1-5z"
        fill="#0D0F14"
        stroke="#0D0F14"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Section → theme mapping (mirrors data-theme wrappers in page body) ─────────

const SECTION_THEME_MAP: Record<string, string> = {
  why:    'editorial',
  submit: 'dossier',
  miners: 'instrument',
  scores: 'instrument',
  ranks:  'instrument',
  arena:  'network',
  chain:  'instrument',
  payout: 'legal',
}

// ── Slim brand header — adapts to active section theme ─────────────────────────

function Header({ activeSection }: { activeSection: string }) {
  const theme = SECTION_THEME_MAP[activeSection] ?? 'instrument'

  // Light themes need a dark logo icon background; dark/navy themes keep amber
  const logoBg = (theme === 'editorial' || theme === 'dossier') ? '#1A2332'
                : theme === 'legal' ? '#1E40AF'
                : 'var(--bp-gold)'

  const logoIconFill = (theme === 'editorial' || theme === 'dossier' || theme === 'legal')
                       ? '#FFFFFF' : '#0D0F14'

  return (
    <header
      data-theme={theme}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '48px',
        background: 'var(--bp-surface)',
        borderBottom: '1px solid var(--bp-border)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        transition: 'background 0.5s ease, border-color 0.5s ease, color 0.4s ease',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          width: '100%',
          margin: '0 auto',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '100%',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              background: logoBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              transition: 'background 0.5s ease',
            }}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
              <path
                d="M7 1L1 8h5l-1 5L11 6H6l1-5z"
                fill={logoIconFill}
                stroke={logoIconFill}
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span
            style={{
              fontFamily: theme === 'editorial' || theme === 'dossier'
                ? 'var(--font-editorial-body)'
                : theme === 'legal'
                ? 'var(--font-typewriter)'
                : 'var(--font-mono)',
              fontSize: '14px',
              fontWeight: 700,
              color: 'var(--bp-text-primary)',
              letterSpacing: theme === 'editorial' || theme === 'dossier' ? '0.04em' : '0.1em',
              transition: 'color 0.4s ease',
            }}
          >
            BUILDPROOF
          </span>
          <span
            className="hidden sm:inline"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--bp-text-muted)',
              border: '1px solid var(--bp-border)',
              padding: '1px 8px',
              borderRadius: theme === 'editorial' || theme === 'dossier' ? '2px' : '2px',
              letterSpacing: '0.04em',
            }}
          >
            BITTENSOR SUBNET DEMO
          </span>
        </div>

        {/* Network status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#22C55E',
              animation: 'pulseGreen 2s ease-in-out infinite',
              flexShrink: 0,
            }}
          />
          <span
            className="hidden sm:inline"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--bp-text-muted)',
            }}
          >
            localnet
          </span>
          <Wifi size={14} style={{ color: 'var(--bp-text-muted)' }} />
        </div>
      </div>
    </header>
  )
}

// ── Processing overlay ────────────────────────────────────────────────────────

function EvaluationProcessing({ status }: { status: string }) {
  return (
    <section
      id="miners"
      style={{
        padding: '64px 32px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '8px' }}>02 — NODES</p>
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
          Active <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Miners</span>
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
          }}
        >
          {[0, 1, 2].map((i) => (
            <MinerCardSkeleton key={i} />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginTop: '24px',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: 'var(--bp-gold)',
              animation: 'pulseGold 1.2s ease-in-out infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--bp-gold)',
            }}
          >
            {status === 'pending' ? 'Awaiting validator…' : 'Querying miner neurons via DiligenceSynapse…'}
          </span>
        </div>
      </div>
    </section>
  )
}

// ── Status toast banner ───────────────────────────────────────────────────────

function StatusBanner({ status, message }: { status: 'processing' | 'error'; message?: string }) {
  if (status === 'processing') {
    return (
      <div
        className="animate-slide-in-right"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 50,
          background: 'var(--bp-surface-2)',
          border: '1px solid var(--bp-border)',
          borderLeft: '3px solid var(--bp-gold)',
          borderRadius: '4px',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <Loader2
          size={14}
          style={{ color: 'var(--bp-gold)', animation: 'spin 0.8s linear infinite' }}
        />
        <div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--bp-gold)' }}>
            Evaluating proposal…
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)' }}>
            Querying miner neurons
          </p>
        </div>
        <style jsx>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    )
  }
  return (
    <div
      className="animate-slide-in-right"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 50,
        background: 'var(--bp-surface-2)',
        border: '1px solid var(--bp-border)',
        borderLeft: '3px solid var(--bp-red)',
        borderRadius: '4px',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}
    >
      <AlertCircle size={14} style={{ color: 'var(--bp-red)', flexShrink: 0 }} />
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--bp-red)' }}>
        {message ?? 'Evaluation failed'}
      </p>
    </div>
  )
}

// ── Hint when no proposal yet ─────────────────────────────────────────────────

function SubmitHint() {
  return (
    <section
      id="miners"
      style={{ padding: '48px 32px', borderTop: '1px solid var(--bp-border)' }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="instrument-label" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--bp-text-dim)',
              border: '1px solid var(--bp-border-hover)',
            }}
          />
          02 — MINERS
        </p>
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
          Active <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Miners</span>
        </h2>

        {/* Instrument-style idle panel */}
        <div
          className="instrument-panel"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1px',
            background: 'var(--bp-border)',
          }}
        >
          {[
            { label: 'AWAITING INPUT', value: '—', sub: 'no proposal received' },
            { label: 'MINERS QUEUED', value: '3', sub: 'neurons on standby' },
            { label: 'AVG LATENCY', value: '—', sub: 'ms · idle' },
          ].map((cell) => (
            <div
              key={cell.label}
              style={{
                background: 'var(--bp-surface)',
                padding: '24px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '9px',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                }}
              >
                {cell.label}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-instrument-mono, var(--font-mono))',
                  fontSize: '28px',
                  fontWeight: 700,
                  color: 'var(--bp-text-muted)',
                  lineHeight: 1,
                  letterSpacing: '0.04em',
                }}
              >
                {cell.value}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--bp-text-dim)',
                  letterSpacing: '0.06em',
                }}
              >
                {cell.sub}
              </span>
            </div>
          ))}
        </div>

        {/* Action strip */}
        <div
          style={{
            marginTop: '1px',
            background: 'var(--bp-surface-2)',
            border: '1px solid var(--bp-border)',
            borderTop: 'none',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.1em',
              color: 'var(--bp-text-dim)',
              textTransform: 'uppercase',
            }}
          >
            STANDBY — Submit a proposal to initiate evaluation
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
            <a
              href="#submit"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--bp-gold)',
                textDecoration: 'none',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                padding: '5px 14px',
                transition: 'border-color 150ms ease-out, background 150ms ease-out',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--bp-gold)'
                e.currentTarget.style.background = 'var(--bp-gold-glow)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'rgba(245, 158, 11, 0.3)'
                e.currentTarget.style.background = 'transparent'
              }}
            >
              ↑ SUBMIT PROPOSAL
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BuildProofDashboard() {
  const [proposalResult, setProposalResult] = useState<ProposalResult | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [evalError, setEvalError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState('why')
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [tickerVisible, setTickerVisible] = useState(false)
  const [arenaComplete, setArenaComplete] = useState(false)
  const [payoutComplete, setPayoutComplete] = useState(false)
  const [executionProposalId, setExecutionProposalId] = useState<string | null>(null)

  const addActivity = useCallback((type: ActivityEvent['type'], message: string) => {
    setActivityEvents((prev) => [...prev.slice(-19), createActivityEvent(type, message)])
  }, [])

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        })
      },
      { rootMargin: '-40% 0px -55% 0px' }
    )
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  // Load leaderboard
  const loadLeaderboard = useCallback(async () => {
    try {
      const data = await getLeaderboard()
      setLeaderboard(data)
    } catch {
      setLeaderboard(MOCK_LEADERBOARD)
    }
  }, [])

  useEffect(() => {
    loadLeaderboard()
    const interval = setInterval(loadLeaderboard, 30_000)
    return () => clearInterval(interval)
  }, [loadLeaderboard])

  // Handle proposal submission — three-tier fallback:
  //   Tier 1: poll for validator result (full bittensor stack)
  //   Tier 2: /evaluate-direct (in-process strategies, no bittensor needed)
  //   Tier 3: static MOCK_PROPOSAL_RESULT (fully offline)
  const handleProposalSubmitted = useCallback(async (proposalId: string) => {
    setIsSubmitting(true)
    setEvalError(null)
    setProposalResult(null)
    setExecutionProposalId(proposalId)
    addActivity('proposal', `Proposal ${proposalId.slice(0, 8)} submitted for evaluation`)

    const finaliseResult = (result: ProposalResult, source: string) => {
      setProposalResult(result)
      addActivity('validator', `Evaluation complete (${source}) — scores computed`)
      result.miner_responses?.forEach((m) => {
        addActivity('miner', `${m.strategy} miner responded in ${m.latency_ms.toFixed(0)}ms`)
      })
      addActivity('weights', 'Leaderboard updated with new weights')
      loadLeaderboard()
      setTimeout(() => {
        document.getElementById('miners')?.scrollIntoView({ behavior: 'smooth' })
      }, 300)
    }

    try {
      // Tier 1 — poll for validator result (full bittensor stack)
      let pollingTimedOut = false
      try {
        const result = await pollProposalResult(
          proposalId,
          (partial) => {
            setProposalResult(partial)
            if (partial.status === 'processing') {
              addActivity('validator', 'Validator queued — querying miner neurons')
            }
          },
          2000,
          120_000
        )
        if (result.status === 'error') {
          setEvalError(result.error_message ?? 'Evaluation failed')
        } else {
          finaliseResult(result, 'validator')
        }
        return
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : ''
        // Only escalate to fallback tiers on timeout; surface hard errors immediately
        if (!msg.toLowerCase().includes('timed out')) {
          setEvalError(msg || 'Evaluation failed')
          return
        }
        pollingTimedOut = true
        addActivity('validator', 'Validator not responding — trying direct evaluation…')
      }

      if (!pollingTimedOut) return

      // Tier 2 — direct in-process evaluation (seeded strategies, no bittensor)
      try {
        addActivity('validator', 'Running seeded evaluation via API…')
        const result = await triggerDirectEvaluation(proposalId)
        finaliseResult(result, 'seeded-direct')
        return
      } catch {
        addActivity('validator', 'API direct evaluation unavailable — loading demo data')
      }

      // Tier 3 — static frontend mock (fully offline)
      finaliseResult(
        { ...MOCK_PROPOSAL_RESULT, proposal_id: proposalId, evaluated_at: Date.now() / 1000 },
        'demo-mock'
      )
    } finally {
      setIsSubmitting(false)
    }
  }, [loadLeaderboard, addActivity])

  const hasCompleteResult =
    proposalResult?.status === 'complete' &&
    (proposalResult.miner_responses?.length ?? 0) > 0

  const isProcessing =
    isSubmitting ||
    proposalResult?.status === 'pending' ||
    proposalResult?.status === 'processing'

  const handleLoadCannedData = useCallback(async () => {
    addActivity('proposal', 'Loading canned benchmark data...')
    try {
      const res = await runBenchmark()
      handleProposalSubmitted(res.proposal_id)
    } catch {
      setLeaderboard(MOCK_LEADERBOARD)
      addActivity('weights', 'Loaded mock leaderboard data')
    }
  }, [addActivity, handleProposalSubmitted])

  const handleResetDemo = useCallback(() => {
    setProposalResult(null)
    setLeaderboard([])
    setIsSubmitting(false)
    setEvalError(null)
    setArenaComplete(false)
    setPayoutComplete(false)
    setActivityEvents([])
    setExecutionProposalId(null)
    addActivity('proposal', 'Demo state reset')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [addActivity])

  const handleTriggerBenchmark = useCallback(async () => {
    addActivity('proposal', 'Triggering benchmark run...')
    try {
      const res = await runBenchmark()
      handleProposalSubmitted(res.proposal_id)
    } catch (e: unknown) {
      setEvalError(e instanceof Error ? e.message : 'Benchmark failed')
    }
  }, [addActivity, handleProposalSubmitted])

  const handleTriggerAdversarial = useCallback(() => {
    document.getElementById('arena')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <ToastProvider>
      <div style={{ minHeight: '100vh', background: 'var(--bp-bg)', paddingTop: '88px' }}>
        <Header activeSection={activeSection} />

        <DemoStepper
          activeSection={activeSection}
          hasResult={hasCompleteResult}
          isProcessing={isProcessing}
          hasLeaderboard={leaderboard.length > 0}
          hasArenaResult={arenaComplete}
          payoutComplete={payoutComplete}
        />

        {/* §00 WHY — Editorial Ivory */}
        <div data-theme="editorial" className="theme-section">
          <MarketDemand />
        </div>

        {/* §01 SUBMIT — Dossier + Operational */}
        <div data-theme="dossier" className="theme-section">
          <ProposalUpload
            onSubmitted={handleProposalSubmitted}
            isLoading={isProcessing}
            hasResult={hasCompleteResult}
          />
        </div>

        {/* §02 MINERS — conditional */}
        {!proposalResult && !isProcessing && !executionProposalId && (
          <div data-theme="instrument" className="theme-section">
            <SubmitHint />
          </div>
        )}

        {/* §02a EXECUTION FLOW — live subnet pipeline (shown while processing or after) */}
        {executionProposalId && (
          <div data-theme="instrument" className="theme-section">
            <ExecutionPanel
              proposalId={executionProposalId}
              isActive={isProcessing}
              onEventActivity={addActivity}
            />
          </div>
        )}

        {/* Show skeleton while processing but no complete result yet */}
        {isProcessing && proposalResult && !hasCompleteResult && (
          <div data-theme="instrument" className="theme-section">
            <EvaluationProcessing status={proposalResult.status} />
          </div>
        )}

        {/* §02–03 MINERS + SCORES — Mission Control */}
        {hasCompleteResult && (
          <div data-theme="instrument" className="theme-section">
            <MinerComparison miners={proposalResult!.miner_responses} />
            <ValidatorScores
              miners={proposalResult!.miner_responses}
              decision={proposalResult!.decision}
            />
          </div>
        )}

        {/* §04 RANKS — Mission Control */}
        <div data-theme="instrument" className="theme-section">
          <Leaderboard entries={leaderboard} />
        </div>

        {/* §05 ARENA — Network Topology */}
        <div data-theme="network" className="theme-section">
          <AdversarialArena onArenaComplete={() => {
            setArenaComplete(true)
            addActivity('arena', 'Adversarial test complete')
          }} />
        </div>

        {/* §06 CHAIN WRITE — Instrument */}
        <div data-theme="instrument" className="theme-section">
          <section
            id="chain"
            style={{ padding: '0 32px 48px', borderTop: '1px solid var(--bp-border)' }}
          >
            <div style={{ maxWidth: '1280px', margin: '0 auto', paddingTop: '48px' }}>
              <p className="instrument-label" style={{ marginBottom: '8px' }}>06 — CHAIN</p>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 4vw, 52px)', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--bp-text-primary)', marginBottom: '20px', lineHeight: 1.1 }}>
                On-Chain <span style={{ color: 'var(--bp-gold)', fontStyle: 'italic' }}>Weights</span>
              </h2>
              <ChainWritePanel />
            </div>
          </section>
        </div>

        {/* §07 PAYOUT — Legal Document */}
        <div data-theme="legal" className="theme-section">
          <PayoutButton
            decision={proposalResult?.decision ?? null}
            proposalId={proposalResult?.proposal_id}
            onPayoutComplete={() => {
              setPayoutComplete(true)
              addActivity('payout', 'Payout disbursement confirmed')
            }}
          />
        </div>

        {/* §08 ROADMAP */}
        <MainnetRoadmap />

        {/* Footer */}
        <footer
          style={{
            borderTop: '1px solid var(--bp-border)',
            padding: '32px',
            background: 'var(--bp-surface)',
          }}
        >
          <div
            style={{
              maxWidth: '1280px',
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  background: 'var(--bp-gold)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LightningBolt />
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  fontWeight: 700,
                  color: 'var(--bp-text-primary)',
                  letterSpacing: '0.1em',
                }}
              >
                BUILDPROOF
              </span>
            </div>
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-muted)',
                textAlign: 'center',
              }}
            >
              Bittensor Subnet Demo · Funding the Commons 2025 ·{' '}
              <span style={{ color: '#22C55E' }}>localnet running</span>
            </p>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--bp-text-dim)',
              }}
            >
              Validator → Miner → Reward
            </span>
          </div>
        </footer>

        {/* Status banners */}
        {isProcessing && <StatusBanner status="processing" />}
        {evalError && <StatusBanner status="error" message={evalError} />}

        {/* Cross-cutting UX overlays */}
        <ExplainerPanel />
        <DemoControlCenter
          onLoadCannedData={handleLoadCannedData}
          onResetDemo={handleResetDemo}
          onTriggerBenchmark={handleTriggerBenchmark}
          onTriggerAdversarial={handleTriggerAdversarial}
          onToggleTicker={() => setTickerVisible((v) => !v)}
          tickerVisible={tickerVisible}
        />
        <ActivityTicker
          events={activityEvents}
          visible={tickerVisible}
          onToggle={() => setTickerVisible((v) => !v)}
        />
      </div>
    </ToastProvider>
  )
}
