const STRATEGY_CONFIG: Record<string, { label: string; className: string }> = {
  // Task-typed miners (new)
  rubric:              { label: 'RUBRIC',    className: 'badge badge-rubric' },
  rubric_scorer:       { label: 'RUBRIC',    className: 'badge badge-rubric' },
  diligence:           { label: 'DILIGENCE', className: 'badge badge-diligence' },
  diligence_generator: { label: 'DILIGENCE', className: 'badge badge-diligence' },
  risk:                { label: 'RISK',      className: 'badge badge-risk' },
  risk_detector:       { label: 'RISK',      className: 'badge badge-risk' },
  // Legacy labels
  robust:              { label: 'ROBUST',    className: 'badge badge-robust' },
  generalist:          { label: 'GENERALIST',className: 'badge badge-generalist' },
  cost_optimized:      { label: 'COST OPT',  className: 'badge badge-cost-optimized' },
}

interface StrategyBadgeProps {
  strategy: string
  className?: string
}

export function StrategyBadge({ strategy, className = '' }: StrategyBadgeProps) {
  const config = STRATEGY_CONFIG[strategy] ?? {
    label: strategy.replace(/_/g, ' ').toUpperCase().slice(0, 12),
    className: 'badge',
  }

  return (
    <span className={`${config.className} ${className}`}>
      {config.label}
    </span>
  )
}

export function strategyColor(strategy: string): string {
  const map: Record<string, string> = {
    rubric:              'var(--bp-gold)',
    rubric_scorer:       'var(--bp-gold)',
    diligence:           'var(--bp-teal)',
    diligence_generator: 'var(--bp-teal)',
    risk:                'var(--bp-red)',
    risk_detector:       'var(--bp-red)',
    // Legacy
    robust:              'var(--bp-gold)',
    generalist:          'var(--bp-teal)',
    cost_optimized:      'var(--bp-purple)',
  }
  return map[strategy] ?? 'var(--bp-text-muted)'
}
