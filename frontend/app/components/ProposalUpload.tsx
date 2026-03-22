'use client'

import { useState, useRef, useEffect } from 'react'
import { submitProposal, runBenchmark } from '@/lib/api'
import { EvaluationTimeline } from './ui/EvaluationTimeline'
import type { TimelineStep } from './ui/EvaluationTimeline'
import { SAMPLE_PROPOSALS } from '@/lib/sampleProposals'
import type { SampleProposal } from '@/lib/sampleProposals'

interface ProposalUploadProps {
  onSubmitted: (proposalId: string) => void
  isLoading: boolean
  /** Set to true once a complete result is available so the timeline snaps to "all done". */
  hasResult?: boolean
}

// ── Proposal parsing ─────────────────────────────────────────────────────────

interface ParsedProposal {
  title: string | null
  budget: string | null
  domain: string | null
  traction: string | null
  riskFlags: string[]
}

function parseProposal(text: string): ParsedProposal {
  const lines = text.split('\n').filter((l) => l.trim())
  const title = lines[0]?.replace(/^(project|title|proposal)\s*[:—–-]\s*/i, '').trim().slice(0, 80) || null

  const budgetMatch = text.match(/\$[\d,]+(?:\.\d+)?(?:\s*(?:k|K|thousand|million|M|USD))?/g)
  const budget = budgetMatch?.[0] ?? null

  const domainKeywords: Record<string, string[]> = {
    'Infrastructure': ['infrastructure', 'tooling', 'sdk', 'protocol', 'framework'],
    'DeSci': ['science', 'research', 'desci', 'academic'],
    'DeFi': ['defi', 'finance', 'treasury', 'payout'],
    'Social Impact': ['community', 'education', 'refugee', 'displaced', 'humanitarian'],
    'Security': ['security', 'audit', 'adversarial', 'robustness'],
    'AI/ML': ['ai', 'machine learning', 'model', 'neural', 'llm'],
  }
  let domain: string | null = null
  const lower = text.toLowerCase()
  for (const [cat, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((k) => lower.includes(k))) { domain = cat; break }
  }

  const tractionPatterns = [
    /(?:prior work|previously|deployed|built|shipped|experience)[^.]*\./i,
    /(?:team|founder|engineer|developer)[^.]*(?:year|yr|experience)[^.]*\./i,
    /(?:used by|adopted by|partner)[^.]*\./i,
  ]
  let traction: string | null = null
  for (const pat of tractionPatterns) {
    const m = text.match(pat)
    if (m) { traction = m[0].trim().slice(0, 120); break }
  }

  const riskFlags: string[] = []
  if (/system\s*override|ignore\s*previous|you\s*are\s*now/i.test(text)) riskFlags.push('Possible prompt injection detected')
  if (/\$\d{6,}/.test(text) && /vague|tbd|pending|to be determined/i.test(text)) riskFlags.push('Large budget with vague deliverables')
  if (/wept|tears|imagine|moral emergency|children are waiting/i.test(text)) riskFlags.push('Emotionally manipulative framing')
  if (budgetMatch && budgetMatch.length > 1) {
    const amounts = budgetMatch.map((b) => parseFloat(b.replace(/[$,]/g, '')))
    const total = amounts[0]
    const breakdown = amounts.slice(1).reduce((a, b) => a + b, 0)
    if (total > 0 && breakdown > 0 && Math.abs(total - breakdown) / total > 0.3) riskFlags.push('Budget breakdown doesn\'t match total')
  }

  return { title, budget, domain, traction, riskFlags }
}

// ── Completeness check ───────────────────────────────────────────────────────

interface CompletenessItem {
  label: string
  present: boolean
}

function checkCompleteness(text: string): CompletenessItem[] {
  const lower = text.toLowerCase()
  return [
    { label: 'Budget included', present: /\$[\d,]+/.test(text) },
    { label: 'Timeline included', present: /month|week|timeline|milestone|phase|quarter/i.test(lower) },
    { label: 'Deliverables included', present: /deliver|ship|build|deploy|release|launch|mvp|prototype/i.test(lower) },
    { label: 'Evidence / prior work', present: /prior|previous|experience|deployed|shipped|reference|portfolio/i.test(lower) },
  ]
}

// ── Evaluation progress simulation ───────────────────────────────────────────

const IDLE_STEPS: TimelineStep[] = [
  { label: 'Proposal received',    status: 'active'  },
  { label: 'Validator queued',     status: 'pending' },
  { label: 'Querying miners (0/3)', status: 'pending' },
  { label: 'Scoring responses',    status: 'pending' },
  { label: 'Writing chain weights', status: 'pending' },
  { label: 'Result ready',         status: 'pending' },
]

const ALL_DONE_STEPS: TimelineStep[] = [
  { label: 'Proposal received',    status: 'done', timestamp: 'DONE' },
  { label: 'Validator queued',     status: 'done', timestamp: 'DONE' },
  { label: 'Querying miners (3/3)', status: 'done', timestamp: 'DONE', subItems: [
      { uid: 1, strategy: 'rubric_scorer',       latency: 2340, done: true },
      { uid: 2, strategy: 'diligence_generator', latency: 890,  done: true },
      { uid: 3, strategy: 'risk_detector',       latency: 4820, done: true },
  ]},
  { label: 'Scoring responses',    status: 'done', timestamp: 'DONE' },
  { label: 'Writing chain weights', status: 'done', timestamp: 'DONE' },
  { label: 'Result ready',         status: 'done', timestamp: 'DONE' },
]

function useEvalProgress(isLoading: boolean, hasResult: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const [steps, setSteps] = useState<TimelineStep[]>(IDLE_STEPS)

  useEffect(() => {
    // Real result arrived — freeze timeline in completed state immediately.
    if (hasResult) {
      setSteps(ALL_DONE_STEPS)
      return
    }

    if (!isLoading) {
      setElapsed(0)
      setSteps(IDLE_STEPS)
      return
    }

    const startTime = Date.now()

    const timer = setInterval(() => {
      const s = (Date.now() - startTime) / 1000
      setElapsed(s)

      setSteps([
        {
          label: 'Proposal received',
          status: s > 0.5 ? 'done' : 'active',
          timestamp: s > 0.5 ? 'DONE' : undefined,
        },
        {
          label: 'Validator queued',
          status: s > 1 ? 'done' : s > 0.5 ? 'active' : 'pending',
          timestamp: s > 1 ? 'DONE' : undefined,
        },
        {
          label: `Querying miners (${Math.min(3, Math.floor(s / 4))} / 3)`,
          status: s > 13 ? 'done' : s > 1 ? 'active' : 'pending',
          timestamp: s > 13 ? 'DONE' : undefined,
          subItems: s > 1
            ? [
                { uid: 1, strategy: 'rubric_scorer',       latency: s > 5  ? 2340 : undefined, done: s > 5  },
                { uid: 2, strategy: 'diligence_generator', latency: s > 3  ? 890  : undefined, done: s > 3  },
                { uid: 3, strategy: 'risk_detector',       latency: s > 9  ? 4820 : undefined, done: s > 9  },
              ]
            : undefined,
        },
        {
          label: 'Scoring responses',
          status: s > 18 ? 'done' : s > 13 ? 'active' : 'pending',
          timestamp: s > 18 ? 'DONE' : undefined,
        },
        {
          label: 'Writing chain weights',
          status: s > 22 ? 'done' : s > 18 ? 'active' : 'pending',
          timestamp: s > 22 ? 'DONE' : undefined,
        },
        {
          label: 'Result ready',
          status: s > 25 ? 'done' : s > 22 ? 'active' : 'pending',
          timestamp: s > 25 ? 'DONE' : undefined,
        },
      ])
    }, 300)

    return () => clearInterval(timer)
  }, [isLoading, hasResult])

  return { steps, elapsed }
}

// ── Sample proposal dropdown ──────────────────────────────────────────────────

function SampleDropdown({
  open,
  onSelect,
  onClose,
}: {
  open: boolean
  onSelect: (p: SampleProposal) => void
  onClose: () => void
}) {
  if (!open) return null

  const categoryColors: Record<string, string> = {
    normal: 'var(--bp-teal)',
    inflated: '#C45A3C',
    emotional: 'var(--bp-purple)',
    adversarial: 'var(--bp-red)',
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
      <div
        className="animate-slide-in-up"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '4px',
          background: 'var(--bp-surface)',
          border: '1px solid var(--bp-border)',
          borderRadius: '2px',
          width: '340px',
          zIndex: 61,
          overflow: 'hidden',
          boxShadow: '0 4px 16px rgba(26,35,50,0.12)',
        }}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--bp-border)' }}>
          <span style={{
            fontFamily: 'var(--font-editorial-body)',
            fontSize: '11px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--bp-text-dim)',
            fontWeight: 600,
          }}>
            Load Sample Proposal
          </span>
        </div>
        {SAMPLE_PROPOSALS.map((p) => (
          <button
            key={p.id}
            onClick={() => { onSelect(p); onClose() }}
            style={{
              display: 'block',
              width: '100%',
              padding: '12px 14px',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              borderTop: '1px solid var(--bp-border)',
              cursor: 'pointer',
              transition: 'background 150ms ease-out',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bp-surface-2)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: categoryColors[p.category] ?? 'var(--bp-text-dim)',
                flexShrink: 0,
              }} />
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--bp-text-primary)',
              }}>
                {p.title}
              </span>
            </div>
            <p style={{
              fontFamily: 'var(--font-editorial-body)',
              fontSize: '12px',
              color: 'var(--bp-text-muted)',
              marginLeft: '14px',
              lineHeight: 1.4,
            }}>
              {p.description}
            </p>
          </button>
        ))}
      </div>
    </>
  )
}

// ── Operational dispatch animation ────────────────────────────────────────────

function OperationalDispatch() {
  return (
    <div
      data-theme="instrument"
      className="animate-fade-in"
      style={{
        background: '#000',
        padding: '48px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px',
      }}
    >
      {/* Scanline effect */}
      <div style={{ position: 'relative', width: '100%', maxWidth: '400px' }}>
        <div style={{
          height: '2px',
          background: 'linear-gradient(90deg, transparent, #F59E0B, transparent)',
          marginBottom: '24px',
          animation: 'scanlineLoad 2s linear infinite',
        }} />

        <svg width="100%" viewBox="0 0 300 80" fill="none" style={{ maxWidth: '300px', display: 'block', margin: '0 auto' }}>
          {/* Center proposal node */}
          <circle cx="40" cy="40" r="10" fill="rgba(245,158,11,0.15)" stroke="#F59E0B" strokeWidth="1">
            <animate attributeName="r" values="10;12;10" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <circle cx="40" cy="40" r="4" fill="#F59E0B" />

          {/* Animated connection lines */}
          <line x1="50" y1="40" x2="130" y2="20" stroke="#22C55E" strokeWidth="1" strokeDasharray="6 3">
            <animate attributeName="stroke-dashoffset" values="18;0" dur="0.8s" repeatCount="indefinite" />
          </line>
          <line x1="50" y1="40" x2="130" y2="40" stroke="#3B82F6" strokeWidth="1" strokeDasharray="6 3">
            <animate attributeName="stroke-dashoffset" values="18;0" dur="1s" repeatCount="indefinite" />
          </line>
          <line x1="50" y1="40" x2="130" y2="60" stroke="#F59E0B" strokeWidth="1" strokeDasharray="6 3">
            <animate attributeName="stroke-dashoffset" values="18;0" dur="1.2s" repeatCount="indefinite" />
          </line>

          {/* Miner nodes */}
          {[
            { cx: 140, cy: 20, color: '#22C55E', label: 'RUBRIC' },
            { cx: 140, cy: 40, color: '#3B82F6', label: 'DILIGENCE' },
            { cx: 140, cy: 60, color: '#F59E0B', label: 'RISK' },
          ].map(({ cx, cy, color, label }) => (
            <g key={label}>
              <circle cx={cx} cy={cy} r="8" fill={`${color}22`} stroke={color} strokeWidth="1">
                <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <text x={cx + 16} y={cy + 4} fontFamily="'Share Tech Mono', monospace" fontSize="8" fill={color} letterSpacing="0.1em">
                {label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{
          fontFamily: "'Share Tech Mono', monospace",
          fontSize: '13px',
          color: '#F59E0B',
          letterSpacing: '0.08em',
          marginBottom: '4px',
        }}>
          DISPATCHING TO MINER NETWORK
        </p>
        <p style={{
          fontFamily: "'Barlow', sans-serif",
          fontSize: '12px',
          color: '#7A7A72',
          letterSpacing: '0.04em',
        }}>
          Initiating DiligenceSynapse queries…
        </p>
      </div>
    </div>
  )
}

// ── Form section label ────────────────────────────────────────────────────────

function FormSectionLabel({ num, label }: { num: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '8px' }}>
      <span style={{
        fontFamily: 'var(--font-typewriter)',
        fontSize: '11px',
        color: 'var(--bp-text-dim)',
        letterSpacing: '0.04em',
        minWidth: '32px',
      }}>
        {num}
      </span>
      <span style={{
        fontFamily: 'var(--font-editorial-body)',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--bp-text-muted)',
      }}>
        {label}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ProposalUpload({ onSubmitted, isLoading, hasResult = false }: ProposalUploadProps) {
  const [text, setText] = useState('')
  const [programMandate, setProgramMandate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [mode, setMode] = useState<'text' | 'json'>('text')
  const [isDragging, setIsDragging] = useState(false)
  const [uploadedFile, setUploadedFile] = useState<string | null>(null)
  const [textareaFocused, setTextareaFocused] = useState(false)
  const [sampleDropdownOpen, setSampleDropdownOpen] = useState(false)
  const [evalMode, setEvalMode] = useState<'live' | 'benchmark'>('live')
  const [dispatching, setDispatching] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const { steps, elapsed } = useEvalProgress(isLoading, hasResult)

  const wordCount = text.split(/\s+/).filter(Boolean).length
  const parsed = wordCount > 50 ? parseProposal(text) : null
  const completeness = wordCount > 20 ? checkCompleteness(text) : null
  const completenessPercent = completeness
    ? Math.round((completeness.filter((c) => c.present).length / completeness.length) * 100)
    : 0

  useEffect(() => {
    if (wordCount > 0 && wordCount < 50) {
      setWarning('Proposal too short for meaningful evaluation')
    } else if (wordCount > 5000) {
      setWarning('Large proposals may increase evaluation latency')
    } else {
      setWarning(null)
    }
  }, [wordCount])

  const handleSubmit = async () => {
    if (!text.trim()) {
      setError('Proposal text is required.')
      return
    }
    setError(null)
    setDispatching(true)
    await new Promise((r) => setTimeout(r, 1500))
    setDispatching(false)
    try {
      const res = await submitProposal({
        proposal_text: text.trim(),
        program_mandate: programMandate.trim() || undefined,
      })
      onSubmitted(res.proposal_id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit proposal')
    }
  }

  const handleBenchmark = async () => {
    setError(null)
    setDispatching(true)
    await new Promise((r) => setTimeout(r, 1500))
    setDispatching(false)
    try {
      const res = await runBenchmark()
      onSubmitted(res.proposal_id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to start benchmark')
    }
  }

  const handleSampleSelect = (p: SampleProposal) => {
    setText(p.text)
    if (p.mandate) setProgramMandate(p.mandate)
  }

  const processFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const content = ev.target?.result as string
        if (file.name.endsWith('.json')) {
          const parsed = JSON.parse(content)
          if (typeof parsed === 'string') {
            setText(parsed)
          } else if (parsed.proposal_text) {
            setText(parsed.proposal_text)
            if (parsed.program_mandate) setProgramMandate(parsed.program_mandate)
          } else {
            setText(JSON.stringify(parsed, null, 2))
          }
        } else {
          setText(content)
        }
        setUploadedFile(file.name)
      } catch {
        setError('Could not parse file. Expected .txt or { proposal_text } JSON.')
      }
    }
    reader.readAsText(file)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  return (
    <section id="submit">
      {/* Operational zone (loading/dispatch) */}
      {(dispatching || isLoading) ? (
        <div data-theme="instrument" style={{ background: '#000', padding: '48px 32px' }}>
          <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
            {dispatching ? (
              <OperationalDispatch />
            ) : (
              <>
                {/* Instrument header for loading state */}
                <div style={{ marginBottom: '32px', borderBottom: '1px solid #1E1E1E', paddingBottom: '20px' }}>
                  <p style={{
                    fontFamily: "'Barlow', sans-serif",
                    fontSize: '9px',
                    fontWeight: 600,
                    letterSpacing: '0.22em',
                    textTransform: 'uppercase',
                    color: '#7A7A72',
                    marginBottom: '8px',
                  }}>
                    01 — EVALUATION PIPELINE
                  </p>
                  <h2 style={{
                    fontFamily: "'Barlow', sans-serif",
                    fontSize: 'clamp(22px, 3vw, 32px)',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: '#F5F0E8',
                  }}>
                    PROCESSING <span style={{ color: '#F59E0B' }}>PROPOSAL</span>
                  </h2>
                </div>
                <div style={{
                  background: '#0A0A0A',
                  border: '1px solid #1E1E1E',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.5)',
                  padding: '24px',
                }}>
                  <EvaluationTimeline steps={steps} elapsedSecs={elapsed} />
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        /* ── Editorial Dossier Form ── */
        <div style={{
          padding: '64px 32px 72px',
          borderTop: '1px solid var(--bp-border)',
        }}>
          <div style={{ maxWidth: '1280px', margin: '0 auto' }}>

            {/* Dossier header */}
            <div style={{ marginBottom: '48px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <div style={{ height: '1px', width: '32px', background: 'var(--bp-text-primary)', flexShrink: 0 }} />
                <span className="editorial-eyebrow">Proposal Intake Form</span>
                <span style={{
                  fontFamily: 'var(--font-typewriter)',
                  fontSize: '10px',
                  letterSpacing: '0.1em',
                  padding: '2px 8px',
                  border: '1px solid var(--bp-teal)',
                  color: 'var(--bp-teal)',
                  borderRadius: '2px',
                }}>
                  ROUND OPEN
                </span>
              </div>

              <h2
                className="editorial-heading"
                style={{ fontSize: 'clamp(32px, 5vw, 56px)', marginBottom: '12px' }}
              >
                Submit a Proposal
              </h2>
              <p className="editorial-body" style={{ maxWidth: '560px' }}>
                Submit a funding application. The validator will query all active
                miners over the Bittensor network and score their independent evaluations.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '48px', alignItems: 'start' }}>

              {/* Left: Main form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

                {/* Input mode toggle */}
                <div>
                  <FormSectionLabel num="§ 1" label="Input Format" />
                  <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--bp-border)' }}>
                    {(['text', 'json'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={{
                          padding: '8px 20px',
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '13px',
                          fontWeight: 500,
                          letterSpacing: '0.04em',
                          border: 'none',
                          borderBottom: mode === m ? '2px solid var(--bp-text-primary)' : '2px solid transparent',
                          cursor: 'pointer',
                          background: 'transparent',
                          color: mode === m ? 'var(--bp-text-primary)' : 'var(--bp-text-dim)',
                          marginBottom: '-1px',
                          transition: 'color 150ms ease-out',
                        }}
                      >
                        {m === 'text' ? 'Plain Text' : 'JSON Upload'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Proposal text area */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <FormSectionLabel num="§ 2" label="Proposal Text" />
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSampleDropdownOpen((v) => !v) }}
                        style={{
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '12px',
                          color: 'var(--bp-gold)',
                          background: 'none',
                          border: '1px solid var(--bp-border)',
                          borderRadius: '2px',
                          cursor: 'pointer',
                          padding: '3px 10px',
                          letterSpacing: '0.02em',
                          transition: 'border-color 150ms ease-out',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bp-gold)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border)' }}
                      >
                        Load sample ▾
                        <SampleDropdown
                          open={sampleDropdownOpen}
                          onSelect={handleSampleSelect}
                          onClose={() => setSampleDropdownOpen(false)}
                        />
                      </button>
                    </div>
                  </div>

                  <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    style={{ position: 'relative' }}
                  >
                    {/* Document watermark */}
                    <span style={{
                      position: 'absolute',
                      top: '12px',
                      right: '16px',
                      fontFamily: 'var(--font-typewriter)',
                      fontSize: '9px',
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'rgba(26, 35, 50, 0.08)',
                      pointerEvents: 'none',
                      userSelect: 'none',
                      zIndex: 1,
                    }}>
                      PROPOSAL DOSSIER
                    </span>

                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onFocus={() => setTextareaFocused(true)}
                      onBlur={() => setTextareaFocused(false)}
                      rows={12}
                      placeholder="Paste your funding proposal here, or drag and drop a file..."
                      style={{
                        width: '100%',
                        background: 'var(--bp-surface)',
                        border: `1px solid ${
                          isDragging ? 'var(--bp-teal)' :
                          error ? 'var(--bp-red)' :
                          textareaFocused ? 'var(--bp-text-primary)' :
                          'var(--bp-border)'
                        }`,
                        borderRadius: '2px',
                        padding: '16px',
                        fontFamily: 'var(--font-editorial-body)',
                        fontSize: '14px',
                        lineHeight: 1.7,
                        color: 'var(--bp-text-primary)',
                        outline: 'none',
                        resize: 'vertical' as const,
                        minHeight: '260px',
                        transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out',
                        boxShadow: textareaFocused ? '0 0 0 3px rgba(26,35,50,0.06)' : 'none',
                      }}
                    />
                    {isDragging && (
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                        background: 'rgba(45, 139, 122, 0.04)',
                      }}>
                        <span style={{ fontFamily: 'var(--font-editorial-body)', fontSize: '14px', color: 'var(--bp-teal)' }}>
                          Drop file to upload
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Word count */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                    <span style={{
                      fontFamily: 'var(--font-editorial-body)',
                      fontSize: '11px',
                      color: wordCount > 50 ? 'var(--bp-teal)' : 'var(--bp-text-dim)',
                    }}>
                      {wordCount} words
                    </span>
                  </div>
                </div>

                {/* Warning */}
                {warning && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    border: '1px solid rgba(196, 90, 60, 0.3)',
                    borderLeft: '3px solid #C45A3C',
                    background: 'rgba(196, 90, 60, 0.04)',
                  }}>
                    <span style={{ color: '#C45A3C', fontSize: '12px' }}>⚠</span>
                    <span style={{ fontFamily: 'var(--font-editorial-body)', fontSize: '13px', color: '#C45A3C' }}>
                      {warning}
                    </span>
                  </div>
                )}

                {/* Program mandate */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                    <FormSectionLabel num="§ 3" label="Program Mandate" />
                    <span style={{
                      fontFamily: 'var(--font-editorial-body)',
                      fontSize: '11px',
                      fontStyle: 'italic',
                      color: 'var(--bp-text-dim)',
                    }}>
                      optional
                    </span>
                  </div>
                  <input
                    type="text"
                    value={programMandate}
                    onChange={(e) => setProgramMandate(e.target.value)}
                    placeholder="e.g. Open-source tooling for Web3 developers · Budget cap $25,000"
                    style={{
                      width: '100%',
                      background: 'var(--bp-surface)',
                      border: '1px solid var(--bp-border)',
                      borderRadius: '2px',
                      height: '44px',
                      padding: '0 16px',
                      fontFamily: 'var(--font-editorial-body)',
                      fontSize: '14px',
                      color: 'var(--bp-text-primary)',
                      outline: 'none',
                      transition: 'border-color 150ms ease-out, box-shadow 150ms ease-out',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = 'var(--bp-text-primary)'
                      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,35,50,0.06)'
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = 'var(--bp-border)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  />
                </div>

                {/* File upload */}
                <div>
                  <FormSectionLabel num="§ 4" label="File Upload" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".txt,.json,.md"
                      onChange={handleFileChange}
                      style={{ display: 'none' }}
                    />
                    {uploadedFile ? (
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 12px',
                        border: '1px solid var(--bp-border)',
                        borderRadius: '2px',
                        background: 'var(--bp-surface)',
                      }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--bp-text-muted)' }}>
                          {uploadedFile}
                        </span>
                        <button
                          onClick={() => { setUploadedFile(null); setText('') }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--bp-text-dim)',
                            fontSize: '14px',
                            lineHeight: 1,
                            padding: '0 2px',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--bp-red)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--bp-text-dim)' }}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileRef.current?.click()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 14px',
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '13px',
                          border: '1px solid var(--bp-border)',
                          borderRadius: '2px',
                          background: 'transparent',
                          color: 'var(--bp-text-muted)',
                          cursor: 'pointer',
                          transition: 'all 150ms ease-out',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--bp-surface)'
                          e.currentTarget.style.borderColor = 'var(--bp-border-hover)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.borderColor = 'var(--bp-border)'
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M6 1v7M3 4l3-3 3 3M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        Upload file
                      </button>
                    )}
                    <span style={{ fontFamily: 'var(--font-editorial-body)', fontSize: '12px', color: 'var(--bp-text-dim)' }}>
                      .txt · .json · .md accepted
                    </span>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px 16px',
                    border: '1px solid var(--bp-red)',
                    borderLeft: '3px solid var(--bp-red)',
                    background: 'var(--bp-red-dim)',
                  }}>
                    <span style={{ color: 'var(--bp-red)', fontSize: '14px', flexShrink: 0 }}>!</span>
                    <span style={{ fontFamily: 'var(--font-editorial-body)', fontSize: '13px', color: 'var(--bp-red)' }}>
                      {error}
                    </span>
                  </div>
                )}

                {/* Evaluation mode + submit */}
                <div style={{
                  borderTop: '1px solid var(--bp-border)',
                  paddingTop: '24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                    {(['live', 'benchmark'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setEvalMode(m)}
                        style={{
                          padding: '7px 16px',
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '12px',
                          fontWeight: 500,
                          letterSpacing: '0.04em',
                          border: '1px solid var(--bp-border)',
                          borderRadius: m === 'live' ? '2px 0 0 2px' : '0 2px 2px 0',
                          cursor: 'pointer',
                          transition: 'all 150ms ease-out',
                          background: evalMode === m ? 'var(--bp-text-primary)' : 'var(--bp-surface)',
                          color: evalMode === m ? 'var(--bp-bg)' : 'var(--bp-text-muted)',
                          borderColor: evalMode === m ? 'var(--bp-text-primary)' : 'var(--bp-border)',
                        }}
                      >
                        {m === 'live' ? '● Live Evaluation' : '▐▌ Benchmark Replay'}
                      </button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    {evalMode === 'live' ? (
                      <>
                        <button
                          onClick={handleSubmit}
                          disabled={isLoading || !text.trim()}
                          style={{
                            flex: '0 0 70%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            height: '52px',
                            background: 'var(--bp-text-primary)',
                            color: 'var(--bp-bg)',
                            border: 'none',
                            borderRadius: '2px',
                            fontFamily: 'var(--font-editorial-body)',
                            fontSize: '15px',
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                            cursor: isLoading || !text.trim() ? 'not-allowed' : 'pointer',
                            opacity: isLoading || !text.trim() ? 0.4 : 1,
                            transition: 'opacity 150ms ease-out',
                          }}
                          onMouseEnter={(e) => { if (!isLoading && text.trim()) e.currentTarget.style.opacity = '0.85' }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = isLoading || !text.trim() ? '0.4' : '1' }}
                        >
                          Submit for Evaluation →
                        </button>
                        <button
                          onClick={handleBenchmark}
                          disabled={isLoading}
                          style={{
                            flex: '0 0 calc(30% - 12px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            height: '52px',
                            background: 'var(--bp-surface)',
                            border: '1px solid var(--bp-border)',
                            borderRadius: '2px',
                            fontFamily: 'var(--font-editorial-body)',
                            fontSize: '13px',
                            fontWeight: 500,
                            color: 'var(--bp-text-muted)',
                            cursor: isLoading ? 'not-allowed' : 'pointer',
                            opacity: isLoading ? 0.4 : 1,
                            transition: 'all 150ms ease-out',
                          }}
                          onMouseEnter={(e) => { if (!isLoading) { e.currentTarget.style.borderColor = 'var(--bp-border-hover)'; e.currentTarget.style.color = 'var(--bp-text-primary)' } }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border)'; e.currentTarget.style.color = 'var(--bp-text-muted)' }}
                        >
                          Benchmark
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={handleBenchmark}
                        disabled={isLoading}
                        style={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '10px',
                          height: '52px',
                          background: 'var(--bp-text-primary)',
                          color: 'var(--bp-bg)',
                          border: 'none',
                          borderRadius: '2px',
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '15px',
                          fontWeight: 600,
                          cursor: isLoading ? 'not-allowed' : 'pointer',
                          opacity: isLoading ? 0.4 : 1,
                          transition: 'opacity 150ms ease-out',
                        }}
                        onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.opacity = '0.85' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = isLoading ? '0.4' : '1' }}
                      >
                        Run Benchmark Replay →
                      </button>
                    )}
                  </div>

                  <p className="editorial-footnote" style={{ textAlign: 'center' }}>
                    {evalMode === 'live'
                      ? 'Live evaluation queries all active miners in real time via DiligenceSynapse.'
                      : 'Benchmark uses seeded proposals for deterministic scoring across all miner strategies.'}
                  </p>
                </div>
              </div>

              {/* Right: Parsing preview + completeness */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Document analysis card */}
                {parsed ? (
                  <div
                    className="editorial-card"
                    style={{ padding: '20px', borderTop: '2px solid var(--bp-text-primary)' }}
                  >
                    <p className="editorial-eyebrow" style={{ marginBottom: '16px' }}>
                      Document Analysis
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {[
                        { num: '1.', label: 'Title', value: parsed.title },
                        { num: '2.', label: 'Budget', value: parsed.budget },
                        { num: '3.', label: 'Domain', value: parsed.domain },
                        { num: '4.', label: 'Prior Work', value: parsed.traction },
                      ].map((item) => (
                        <div key={item.label} style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
                          <span style={{
                            fontFamily: 'var(--font-typewriter)',
                            fontSize: '10px',
                            color: 'var(--bp-text-dim)',
                            minWidth: '20px',
                            flexShrink: 0,
                          }}>
                            {item.num}
                          </span>
                          <div>
                            <span style={{
                              fontFamily: 'var(--font-editorial-body)',
                              fontSize: '10px',
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              color: 'var(--bp-text-dim)',
                              fontWeight: 600,
                              display: 'block',
                              marginBottom: '2px',
                            }}>
                              {item.label}
                            </span>
                            <span style={{
                              fontFamily: 'var(--font-editorial-body)',
                              fontSize: '13px',
                              color: item.value ? 'var(--bp-text-primary)' : 'var(--bp-text-dim)',
                              lineHeight: 1.4,
                              fontStyle: item.value ? 'normal' : 'italic',
                            }}>
                              {item.value ?? 'Not detected'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Risk flags */}
                    {parsed.riskFlags.length > 0 && (
                      <div style={{
                        marginTop: '16px',
                        paddingTop: '12px',
                        borderTop: '1px solid var(--bp-border)',
                      }}>
                        <span style={{
                          fontFamily: 'var(--font-editorial-body)',
                          fontSize: '10px',
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'var(--bp-red)',
                          fontWeight: 600,
                          display: 'block',
                          marginBottom: '8px',
                        }}>
                          Risk Flags
                        </span>
                        {parsed.riskFlags.map((f, i) => (
                          <p key={i} style={{
                            fontFamily: 'var(--font-editorial-body)',
                            fontSize: '12px',
                            color: 'var(--bp-red)',
                            display: 'flex',
                            gap: '6px',
                            marginBottom: '4px',
                            lineHeight: 1.4,
                          }}>
                            <span style={{ flexShrink: 0 }}>⚑</span>
                            {f}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="editorial-card"
                    style={{ padding: '24px', borderTop: '2px solid var(--bp-border)' }}
                  >
                    <p className="editorial-eyebrow" style={{ marginBottom: '12px' }}>Document Analysis</p>
                    <p className="editorial-footnote" style={{ fontStyle: 'italic' }}>
                      Enter at least 50 words to see auto-parsed document metadata.
                    </p>
                  </div>
                )}

                {/* Completeness rubric */}
                {completeness && (
                  <div
                    className="editorial-card"
                    style={{ padding: '20px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
                      <p className="editorial-eyebrow">Completeness Rubric</p>
                      <span style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '20px',
                        fontWeight: 700,
                        color: completenessPercent >= 75 ? 'var(--bp-teal)' : completenessPercent >= 50 ? '#C45A3C' : 'var(--bp-text-dim)',
                      }}>
                        {completenessPercent}%
                      </span>
                    </div>

                    {/* Progress bar — refined */}
                    <div style={{
                      height: '2px',
                      background: 'var(--bp-border)',
                      marginBottom: '16px',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${completenessPercent}%`,
                        background: completenessPercent >= 75 ? 'var(--bp-teal)' : completenessPercent >= 50 ? '#C45A3C' : 'var(--bp-text-dim)',
                        transition: 'width 400ms ease-out',
                      }} />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {completeness.map((item) => (
                        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            color: item.present ? 'var(--bp-teal)' : 'var(--bp-border)',
                            flexShrink: 0,
                          }}>
                            {item.present ? '✓' : '○'}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-editorial-body)',
                            fontSize: '13px',
                            color: item.present ? 'var(--bp-text-muted)' : 'var(--bp-text-dim)',
                          }}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intake instructions */}
                <div style={{ borderTop: '1px solid var(--bp-border)', paddingTop: '16px' }}>
                  <p className="editorial-footnote" style={{ lineHeight: 1.7 }}>
                    <strong style={{ color: 'var(--bp-text-muted)' }}>Intake guidelines:</strong> Proposals should include
                    a clear budget breakdown, timeline with milestones, evidence of prior work,
                    and measurable deliverables. Incomplete proposals may receive lower quality scores.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes evalSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  )
}
