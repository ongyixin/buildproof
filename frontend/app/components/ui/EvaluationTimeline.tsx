'use client'

export interface TimelineStep {
  label: string
  status: 'done' | 'active' | 'pending'
  timestamp?: string
  subItems?: Array<{
    uid: number
    strategy: string
    latency?: number
    done: boolean
  }>
}

interface EvaluationTimelineProps {
  steps: TimelineStep[]
  elapsedSecs?: number
}

const DOT_COLORS = {
  done:    'var(--bp-teal)',
  active:  'var(--bp-gold)',
  pending: 'var(--bp-border)',
}

const STATUS_LABELS = {
  done:    { color: 'var(--bp-teal)',      label: 'DONE' },
  active:  { color: 'var(--bp-gold)',      label: 'ACTIVE' },
  pending: { color: 'var(--bp-text-dim)',  label: 'PENDING' },
}

const STRATEGY_LABEL: Record<string, string> = {
  // Task-typed miners (current)
  rubric:              'RUBRIC',
  rubric_scorer:       'RUBRIC',
  diligence:           'DILIGENCE',
  diligence_generator: 'DILIGENCE',
  risk:                'RISK',
  risk_detector:       'RISK',
  // Legacy
  robust:              'ROBUST',
  generalist:          'GENERALIST',
  cost_optimized:      'COST OPT.',
}

export function EvaluationTimeline({ steps, elapsedSecs }: EvaluationTimelineProps) {
  return (
    <div className="relative">
      {elapsedSecs !== undefined && (
        <div
          className="absolute top-0 right-0"
          style={{ fontSize: '12px', color: 'var(--bp-text-dim)' }}
        >
          {elapsedSecs.toFixed(1)}s elapsed
        </div>
      )}

      <div className="flex flex-col">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1
          const dotColor = DOT_COLORS[step.status]
          const sl = STATUS_LABELS[step.status]

          return (
            <div key={i} className="flex gap-0">
              {/* Left column: dot + connector */}
              <div className="flex flex-col items-center" style={{ width: '32px', flexShrink: 0 }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                    marginTop: '16px',
                    animation: step.status === 'active'
                      ? 'pulseGold 1.2s ease-in-out infinite'
                      : undefined,
                  }}
                />
                {!isLast && (
                  <div
                    style={{
                      width: '1px',
                      flex: 1,
                      minHeight: '32px',
                      borderLeft: step.status === 'done'
                        ? '1px solid var(--bp-border)'
                        : '1px dashed var(--bp-border)',
                      marginTop: '4px',
                    }}
                  />
                )}
              </div>

              {/* Right column: label + status + sub-items */}
              <div className="flex-1 pb-6" style={{ paddingTop: '12px' }}>
                <div className="flex items-center justify-between">
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      color: step.status === 'pending'
                        ? 'var(--bp-text-dim)'
                        : 'var(--bp-text-primary)',
                    }}
                  >
                    {step.label}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: sl.color,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {step.timestamp ?? sl.label}
                  </span>
                </div>

                {/* Sub-items (miner list) */}
                {step.subItems && step.subItems.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {step.subItems.map((sub) => (
                      <div
                        key={sub.uid}
                        className="flex items-center gap-3 animate-slide-in-left"
                        style={{ paddingLeft: '8px' }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            color: 'var(--bp-text-dim)',
                          }}
                        >
                          uid {sub.uid}
                        </span>
                        <span
                          className="badge"
                          style={{
                            fontSize: '9px',
                            padding: '1px 6px',
                            borderRadius: '2px',
                            background:
                              sub.strategy === 'robust'
                                ? 'rgba(245,166,35,0.15)'
                                : sub.strategy === 'generalist'
                                ? 'rgba(0,201,167,0.12)'
                                : 'rgba(139,127,232,0.15)',
                            color:
                              sub.strategy === 'robust'
                                ? 'var(--bp-gold)'
                                : sub.strategy === 'generalist'
                                ? 'var(--bp-teal)'
                                : 'var(--bp-purple)',
                          }}
                        >
                          {STRATEGY_LABEL[sub.strategy] ?? sub.strategy}
                        </span>
                        {sub.latency != null && (
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '11px',
                              color: 'var(--bp-text-muted)',
                              marginLeft: 'auto',
                            }}
                          >
                            {sub.latency}ms
                          </span>
                        )}
                        {sub.done ? (
                          <span style={{ color: 'var(--bp-teal)', fontSize: '11px' }}>✓</span>
                        ) : (
                          <span
                            style={{
                              width: '10px',
                              height: '10px',
                              border: '1px solid var(--bp-gold)',
                              borderTopColor: 'transparent',
                              borderRadius: '50%',
                              display: 'inline-block',
                              animation: 'spin 0.8s linear infinite',
                            }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
