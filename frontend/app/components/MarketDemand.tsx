'use client'

import { useEffect, useRef, useState } from 'react'

// ── Count-up hook ─────────────────────────────────────────────────────────────

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4)
}

function useCountUp(target: string, duration = 900) {
  const [display, setDisplay] = useState('0')
  const startedRef = useRef(false)
  const rafRef = useRef<number>(0)

  const match = target.match(/^([~$]?)([0-9.]+)(.*)$/)
  const prefix = match?.[1] ?? ''
  const numStr = match?.[2] ?? '0'
  const suffix = match?.[3] ?? ''
  const targetNum = parseFloat(numStr)
  const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0

  const start = () => {
    if (startedRef.current) return
    startedRef.current = true
    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)
      const current = eased * targetNum
      setDisplay(`${prefix}${current.toFixed(decimals)}${suffix}`)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setDisplay(target)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return { display, start }
}

function useInView(threshold = 0.2) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect() } },
      { threshold }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold])
  return { ref, visible }
}

// ── Stats data ────────────────────────────────────────────────────────────────

const STATS = [
  {
    value: '$4.2B',
    label: 'disbursed annually by foundations under-staffed for rigorous review',
    footnote: '¹ Foundations & Impact',
    tooltip: 'Most funding programs lack the reviewer bandwidth to evaluate proposals rigorously. Capital moves slowly or poorly.',
  },
  {
    value: '6',
    suffix: '–18 wk',
    label: 'typical proposal-to-decision cycle before funds are committed',
    footnote: '² Open Philanthropy, 2023',
    tooltip: 'Teams wait months for decisions. Delayed funding means delayed impact.',
  },
  {
    value: '3',
    suffix: '–7',
    label: 'committee reviewers per application, often unpaid volunteers',
    footnote: '³ Gitcoin Grants survey',
    tooltip: 'Overloaded volunteers produce inconsistent scores.',
  },
  {
    value: '~40%',
    label: 'of gaming and padding attacks undetected by non-specialist reviewers',
    footnote: '⁴ Red-team study, internal',
    tooltip: 'Budget inflation, fake traction, and emotional manipulation regularly pass human review.',
  },
]

// ── Peer-review rubric comparison table ──────────────────────────────────────

function PeerReviewRubric() {
  const { ref, visible } = useInView(0.15)

  const rows = [
    {
      criterion: 'Review speed',
      traditional: { verdict: 'Inadequate', detail: '6–18 week cycles', mark: '✗' },
      buildproof:  { verdict: 'Satisfactory', detail: 'Minutes, not months', mark: '✓' },
    },
    {
      criterion: 'Transparency',
      traditional: { verdict: 'Inadequate', detail: 'Behind closed doors', mark: '✗' },
      buildproof:  { verdict: 'Satisfactory', detail: 'Scores + weights on-chain', mark: '✓' },
    },
    {
      criterion: 'Reviewer scalability',
      traditional: { verdict: 'Marginal', detail: '3–7 unpaid reviewers', mark: '~' },
      buildproof:  { verdict: 'Satisfactory', detail: 'Permissionless miners', mark: '✓' },
    },
    {
      criterion: 'Adversarial robustness',
      traditional: { verdict: 'Inadequate', detail: '~40% attacks missed', mark: '✗' },
      buildproof:  { verdict: 'Satisfactory', detail: 'Adversarial benchmarks', mark: '✓' },
    },
  ]

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(20px)',
        transition: 'opacity 500ms ease-out, transform 500ms ease-out',
        marginBottom: '48px',
      }}
    >
      <p
        className="editorial-eyebrow"
        style={{ marginBottom: '14px' }}
      >
        Peer Review Assessment — Proposal Evaluation Methods
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-editorial-body)',
          fontSize: '14px',
        }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--bp-text-primary)' }}>
              <th style={{
                textAlign: 'left',
                padding: '8px 12px 8px 0',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: '13px',
                color: 'var(--bp-text-primary)',
                width: '30%',
              }}>
                Criterion
              </th>
              <th style={{
                textAlign: 'left',
                padding: '8px 12px',
                fontFamily: 'var(--font-editorial-body)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: '#C45A3C',
                width: '35%',
              }}>
                Traditional Review
              </th>
              <th style={{
                textAlign: 'left',
                padding: '8px 0 8px 12px',
                fontFamily: 'var(--font-editorial-body)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: 'var(--bp-teal)',
                width: '35%',
              }}>
                BuildProof
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.criterion}
                style={{
                  borderBottom: `1px solid var(--bp-border)`,
                  background: i % 2 === 0 ? 'transparent' : 'rgba(26, 35, 50, 0.02)',
                }}
              >
                <td style={{
                  padding: '10px 12px 10px 0',
                  fontFamily: 'var(--font-editorial-body)',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: 'var(--bp-text-primary)',
                }}>
                  {row.criterion}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    marginRight: '6px',
                    color: '#C45A3C',
                  }}>
                    {row.traditional.mark}
                  </span>
                  <span style={{ color: '#C45A3C', fontWeight: 500 }}>{row.traditional.verdict}</span>
                  <br />
                  <span style={{ fontSize: '12px', color: 'var(--bp-text-dim)' }}>{row.traditional.detail}</span>
                </td>
                <td style={{ padding: '10px 0 10px 12px' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    marginRight: '6px',
                    color: 'var(--bp-teal)',
                  }}>
                    {row.buildproof.mark}
                  </span>
                  <span style={{ color: 'var(--bp-teal)', fontWeight: 500 }}>{row.buildproof.verdict}</span>
                  <br />
                  <span style={{ fontSize: '12px', color: 'var(--bp-text-dim)' }}>{row.buildproof.detail}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="editorial-footnote" style={{ marginTop: '8px' }}>
        Referee notation: ✓ Satisfactory, ~ Marginal, ✗ Inadequate — as per standard grant review rubrics.
      </p>
    </div>
  )
}

// ── Architecture flow with margin annotations ─────────────────────────────────

function ArchitectureFlow() {
  const { ref, visible } = useInView(0.2)

  const nodes = [
    { label: 'Proposal', x: 30, y: 50, color: 'var(--bp-text-primary)', delay: 0 },
    { label: 'Generalist', x: 180, y: 20, color: 'var(--bp-teal)', delay: 200 },
    { label: 'Cost Opt.', x: 180, y: 50, color: 'var(--bp-purple)', delay: 350 },
    { label: 'Robust', x: 180, y: 80, color: '#C45A3C', delay: 500 },
    { label: 'Validator', x: 330, y: 50, color: '#2D4A7A', delay: 700 },
    { label: 'Ranks', x: 460, y: 50, color: 'var(--bp-teal)', delay: 900 },
  ]

  return (
    <div
      ref={ref}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px',
        gap: '24px',
        alignItems: 'start',
        marginBottom: '48px',
      }}
    >
      {/* Main diagram */}
      <div
        className="editorial-card"
        style={{ padding: '28px 28px 20px' }}
      >
        <p className="editorial-eyebrow" style={{ marginBottom: '16px' }}>
          Fig. 1 — Evaluation Pipeline Architecture
        </p>
        <svg width="100%" viewBox="0 0 520 110" style={{ maxWidth: '520px', display: 'block' }}>
          {visible && (
            <>
              <line x1="70" y1="50" x2="160" y2="20" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3">
                <animate attributeName="stroke" values="var(--bp-border);var(--bp-teal);var(--bp-border)" dur="2.5s" begin="0.3s" repeatCount="indefinite" />
              </line>
              <line x1="70" y1="50" x2="160" y2="50" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3">
                <animate attributeName="stroke" values="var(--bp-border);var(--bp-purple);var(--bp-border)" dur="2.5s" begin="0.5s" repeatCount="indefinite" />
              </line>
              <line x1="70" y1="50" x2="160" y2="80" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3">
                <animate attributeName="stroke" values="var(--bp-border);#C45A3C;var(--bp-border)" dur="2.5s" begin="0.7s" repeatCount="indefinite" />
              </line>
              <line x1="210" y1="20" x2="310" y2="50" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3" />
              <line x1="210" y1="50" x2="310" y2="50" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3" />
              <line x1="210" y1="80" x2="310" y2="50" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3" />
              <line x1="370" y1="50" x2="440" y2="50" stroke="var(--bp-border)" strokeWidth="1" strokeDasharray="4 3" />
            </>
          )}
          {nodes.map((node) => (
            <g
              key={node.label}
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'none' : 'translateX(-8px)',
                transition: `opacity 300ms ease-out ${node.delay}ms, transform 300ms ease-out ${node.delay}ms`,
              }}
            >
              <circle cx={node.x} cy={node.y} r="11" fill={`transparent`} stroke={node.color} strokeWidth="1" />
              <circle cx={node.x} cy={node.y} r="3.5" fill={node.color} />
              <text
                x={node.x}
                y={node.y + 23}
                textAnchor="middle"
                fontSize="8.5"
                fontFamily="var(--font-editorial-body)"
                fill="var(--bp-text-dim)"
                fontWeight="500"
              >
                {node.label}
              </text>
            </g>
          ))}
          {visible && (
            <>
              <text x="110" y="38" fontSize="9" fill="var(--bp-text-dim)" fontFamily="var(--font-editorial-body)">→</text>
              <text x="263" y="44" fontSize="9" fill="var(--bp-text-dim)" fontFamily="var(--font-editorial-body)">→</text>
              <text x="403" y="44" fontSize="9" fill="var(--bp-text-dim)" fontFamily="var(--font-editorial-body)">→</text>
            </>
          )}
        </svg>
      </div>

      {/* Margin annotations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '44px' }}>
        <div className="editorial-marginnote">
          Competing miners produce independent evaluations — no single point of failure.
        </div>
        <div className="editorial-marginnote" style={{ borderLeftColor: '#C45A3C', color: '#C45A3C' }}>
          Adversarial scenarios stress-test each miner before weight assignment.
        </div>
        <div className="editorial-marginnote">
          Validator aggregates scores; final weights written to chain.
        </div>
      </div>
    </div>
  )
}

// ── Stat card — editorial footnote style ──────────────────────────────────────

function StatCard({ value, label, footnote, tooltip }: {
  value: string
  label: string
  footnote: string
  tooltip: string
}) {
  const { display, start } = useCountUp(value)
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { start(); observer.disconnect() } },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [start])

  return (
    <div
      ref={ref}
      className="editorial-card editorial-card-hover"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '24px 20px 20px',
        cursor: 'default',
        position: 'relative',
        borderTop: '2px solid var(--bp-text-primary)',
      }}
    >
      {/* Large stat */}
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(36px, 5vw, 52px)',
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: 'var(--bp-text-primary)',
          lineHeight: 1,
          marginBottom: '10px',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </p>
      <p style={{
        fontFamily: 'var(--font-editorial-body)',
        fontSize: '13px',
        lineHeight: 1.55,
        color: 'var(--bp-text-muted)',
        marginBottom: '12px',
      }}>
        {label}
      </p>
      <p className="editorial-footnote">{footnote}</p>

      {/* Tooltip on hover */}
      {hovered && (
        <div
          className="animate-fade-in editorial-card"
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '0',
            right: '0',
            marginBottom: '6px',
            padding: '12px 14px',
            zIndex: 10,
            borderTop: '2px solid var(--bp-teal)',
          }}
        >
          <p style={{ fontFamily: 'var(--font-editorial-body)', fontSize: '12px', color: 'var(--bp-text-muted)', lineHeight: 1.55 }}>
            {tooltip}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Hero heading — editorial typesetting ──────────────────────────────────────

function EditorialHero() {
  const { ref, visible } = useInView(0.1)

  return (
    <div
      ref={ref}
      style={{
        marginBottom: '32px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(16px)',
        transition: 'opacity 600ms ease-out, transform 600ms ease-out',
      }}
    >
      {/* Journal-style overline */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '20px',
      }}>
        <div style={{
          height: '1px',
          width: '32px',
          background: 'var(--bp-text-primary)',
          flexShrink: 0,
        }} />
        <span className="editorial-eyebrow">
          Context & Problem Statement
        </span>
      </div>

      <h1
        className="editorial-heading"
        style={{
          fontSize: 'clamp(44px, 7vw, 80px)',
          marginBottom: '8px',
          fontStyle: 'normal',
        }}
      >
        Why BuildProof
      </h1>
      <h1
        className="editorial-heading"
        style={{
          fontSize: 'clamp(44px, 7vw, 80px)',
          color: 'var(--bp-teal)',
          fontStyle: 'italic',
          marginBottom: '0',
        }}
      >
        Exists
      </h1>
    </div>
  )
}

// ── Feature callout cards ─────────────────────────────────────────────────────

const FEATURES = [
  {
    ref_num: '§ 1.1',
    title: 'Permissionless Evaluators',
    body: 'Any node can join as a miner. Competition drives quality up and cost down — no fixed reviewer pool, no committee bottlenecks.',
    tag: 'Infrastructure · Protocol',
    color: 'var(--bp-teal)',
  },
  {
    ref_num: '§ 1.2',
    title: 'Adversarial Robustness',
    body: 'Validators score miners on whether they catch prompt injections, fake traction, emotional manipulation, and budget inflation.',
    tag: 'Security · Research',
    color: '#C45A3C',
  },
]

// ── Main export ───────────────────────────────────────────────────────────────

export function MarketDemand() {
  return (
    <section
      id="why"
      style={{
        position: 'relative',
        padding: '72px 32px 80px',
        overflow: 'hidden',
      }}
    >
      {/* Subtle paper texture overlay */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'4\' height=\'4\'%3E%3Crect x=\'0\' y=\'0\' width=\'1\' height=\'1\' fill=\'%231A2332\'/%3E%3C/svg%3E")',
          backgroundRepeat: 'repeat',
          opacity: 0.012,
          pointerEvents: 'none',
        }}
      />

      <div style={{ maxWidth: '1280px', margin: '0 auto', position: 'relative', zIndex: 1 }}>

        {/* Two-column editorial layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: '64px',
          alignItems: 'start',
          marginBottom: '64px',
        }}>
          {/* Left: Hero + body */}
          <div>
            <EditorialHero />
            <p
              className="editorial-body"
              style={{ maxWidth: '560px', marginBottom: '32px' }}
            >
              Proposal review is broken. It&apos;s slow, inconsistent, and easy to game.
              BuildProof is a Bittensor subnet that turns proposal evaluation into a
              competitive, transparent, on-chain market — where miners earn by being
              right, and validators earn by catching miners that cheat.
            </p>

            {/* Feature cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="editorial-card editorial-card-hover"
                  style={{ padding: '20px 24px', borderLeft: `3px solid ${f.color}` }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: 'var(--font-typewriter)', fontSize: '11px', color: f.color }}>
                      {f.ref_num}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '17px',
                      fontWeight: 600,
                      color: 'var(--bp-text-primary)',
                    }}>
                      {f.title}
                    </span>
                  </div>
                  <p style={{
                    fontFamily: 'var(--font-editorial-body)',
                    fontSize: '14px',
                    lineHeight: 1.65,
                    color: 'var(--bp-text-muted)',
                    marginBottom: '10px',
                  }}>
                    {f.body}
                  </p>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: f.color,
                    opacity: 0.8,
                  }}>
                    {f.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Evidence sidebar */}
          <div style={{ paddingTop: '12px' }}>
            <div style={{
              borderTop: '2px solid var(--bp-text-primary)',
              paddingTop: '16px',
              marginBottom: '28px',
            }}>
              <p className="editorial-eyebrow" style={{ marginBottom: '16px' }}>
                Evidence Summary
              </p>

              {/* Inline editorial blockquote */}
              <blockquote className="editorial-blockquote" style={{ marginBottom: '20px' }}>
                &ldquo;Funding programs consistently lack the review bandwidth to evaluate proposals at the speed capital demands.&rdquo;
              </blockquote>
            </div>

            {/* Stat cards in sidebar — compact */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {STATS.map((s, i) => (
                <StatCard
                  key={s.value + i}
                  value={s.value}
                  label={s.label}
                  footnote={s.footnote}
                  tooltip={s.tooltip}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Divider */}
        <hr className="editorial-rule" />

        {/* Peer review rubric */}
        <PeerReviewRubric />

        {/* Architecture diagram with margin annotations */}
        <ArchitectureFlow />

        {/* Bottom footnotes */}
        <div
          style={{
            borderTop: '1px solid var(--bp-border)',
            paddingTop: '20px',
            marginBottom: '40px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '8px 32px',
          }}
        >
          {STATS.map((s) => (
            <p key={s.footnote} className="editorial-footnote">
              {s.footnote} — {s.tooltip}
            </p>
          ))}
        </div>

        {/* Editorial CTA callout */}
        <div
          className="editorial-card"
          style={{
            padding: '32px 40px',
            borderLeft: '4px solid var(--bp-text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '32px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <p className="editorial-eyebrow" style={{ marginBottom: '8px' }}>
              Proceed to Evaluation
            </p>
            <p style={{
              fontFamily: 'var(--font-display)',
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--bp-text-primary)',
              lineHeight: 1.3,
              maxWidth: '420px',
            }}>
              Submit a proposal and observe the peer-review engine in operation.
            </p>
          </div>
          <a
            href="#submit"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '14px 28px',
              background: 'var(--bp-text-primary)',
              color: 'var(--bp-bg)',
              borderRadius: '2px',
              fontFamily: 'var(--font-editorial-body)',
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'opacity 150ms ease-out',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          >
            Run a proposal through the network →
          </a>
        </div>

      </div>
    </section>
  )
}
