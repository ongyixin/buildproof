'use client'

interface RoadmapPhase {
  id: string
  label: string
  title: string
  items: string[]
  status: 'done' | 'active' | 'planned'
  color: string
}

const PHASES: RoadmapPhase[] = [
  {
    id: 'local',
    label: 'PHASE 0',
    title: 'Local Demo',
    status: 'done',
    color: 'var(--bp-teal)',
    items: [
      'In-process job queue (SQLite)',
      'Task-specialized miners (rubric, diligence, risk)',
      'Provider heterogeneity (OpenAI, Anthropic, local)',
      'Anti-gaming validator scoring',
      'Local subtensor chain integration',
      '15 benchmark proposals (gold + adversarial)',
    ],
  },
  {
    id: 'testnet',
    label: 'PHASE 1',
    title: 'Testnet Hardening',
    status: 'active',
    color: 'var(--bp-gold)',
    items: [
      'Replace SQLite queue with durable Redis/Postgres job store',
      'Dynamic miner sampling from live metagraph',
      'Expand benchmarks to 50+ with labeled categories',
      'Per-task reward function tuning with real label data',
      'Automated adversarial mutation engine',
      'Hotkey verification for submitted miners',
    ],
  },
  {
    id: 'mainnet',
    label: 'PHASE 2',
    title: 'Mainnet Launch',
    status: 'planned',
    color: 'var(--bp-text-dim)',
    items: [
      'Domain-specific buyers pay TAO for evaluation output',
      'Proposal fingerprinting to detect template spam',
      'Mandate-conditional scoring per grant program',
      'Specialist routing: send proposal types to expert subsets',
      'Confidence calibration as a primary selection signal',
      'Cross-subnet integration with payout protocols',
    ],
  },
]

const STATUS_LABELS: Record<RoadmapPhase['status'], string> = {
  done:    'COMPLETE',
  active:  'IN PROGRESS',
  planned: 'PLANNED',
}

export function MainnetRoadmap() {
  return (
    <section
      id="roadmap"
      style={{
        padding: '64px 32px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <p className="section-label" style={{ marginBottom: '8px' }}>$ 08 — ROADMAP</p>
        <h2
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'clamp(28px, 4vw, 48px)',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            color: 'var(--bp-text-primary)',
            marginBottom: '8px',
          }}
        >
          MAINNET <span style={{ color: 'var(--bp-gold)' }}>PATH</span>
        </h2>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '15px',
            color: '#9BA3B5',
            marginBottom: '40px',
            maxWidth: '640px',
            lineHeight: 1.6,
          }}
        >
          This demo shows a working subnet with real mechanics. Here&apos;s the honest roadmap
          from local demo to production-grade decentralized diligence market.
        </p>

        {/* Phase timeline */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '16px',
          }}
        >
          {PHASES.map((phase) => (
            <div
              key={phase.id}
              style={{
                border: `1px solid ${phase.status === 'done' ? 'var(--bp-teal)' : phase.status === 'active' ? 'var(--bp-gold)' : 'var(--bp-border)'}`,
                borderTop: `3px solid ${phase.color}`,
                borderRadius: '4px',
                padding: '20px',
                background: phase.status === 'done'
                  ? 'rgba(0,201,167,0.04)'
                  : phase.status === 'active'
                  ? 'rgba(245,166,35,0.04)'
                  : 'var(--bp-surface)',
              }}
            >
              {/* Phase header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: phase.color,
                  }}
                >
                  {phase.label}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '9px',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: phase.status === 'done' ? 'var(--bp-teal)' : phase.status === 'active' ? 'var(--bp-gold)' : 'var(--bp-text-dim)',
                    border: `1px solid ${phase.status === 'done' ? 'rgba(0,201,167,0.3)' : phase.status === 'active' ? 'rgba(245,166,35,0.3)' : 'var(--bp-border)'}`,
                    borderRadius: '2px',
                    padding: '1px 6px',
                  }}
                >
                  {STATUS_LABELS[phase.status]}
                </span>
              </div>

              <h3
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: phase.status === 'planned' ? 'var(--bp-text-dim)' : 'var(--bp-text-primary)',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  marginBottom: '16px',
                }}
              >
                {phase.title}
              </h3>

              {/* Items */}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {phase.items.map((item, i) => (
                  <li
                    key={i}
                    style={{ display: 'flex', gap: '8px', fontFamily: 'var(--font-sans)', fontSize: '12px', lineHeight: 1.5 }}
                  >
                    <span
                      style={{
                        color: phase.status === 'done' ? 'var(--bp-teal)' : phase.status === 'active' ? 'var(--bp-gold)' : 'var(--bp-border)',
                        flexShrink: 0,
                        marginTop: '1px',
                      }}
                    >
                      {phase.status === 'done' ? '✓' : phase.status === 'active' ? '◐' : '○'}
                    </span>
                    <span style={{ color: phase.status === 'planned' ? 'var(--bp-text-dim)' : 'var(--bp-text-muted)' }}>
                      {item}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom callout */}
        <div
          style={{
            marginTop: '32px',
            padding: '20px 24px',
            background: 'var(--bp-surface)',
            border: '1px solid var(--bp-border)',
            borderLeft: '3px solid var(--bp-gold)',
            borderRadius: '4px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--bp-gold-dim)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: '8px',
            }}
          >
            Technical Honesty
          </p>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              color: '#9BA3B5',
              lineHeight: 1.65,
              maxWidth: '800px',
            }}
          >
            The hardest part of mainnet is not the code — it&apos;s economic design: how do buyers
            pay for evaluation, how do miners price quality, and how do validators earn for
            accurate curation rather than just uptime. BuildProof addresses all three layers with
            task-specific rewards, adversarial testing, and calibrated confidence scoring.
          </p>
        </div>
      </div>
    </section>
  )
}
