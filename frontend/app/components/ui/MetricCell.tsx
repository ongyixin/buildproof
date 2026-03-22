interface MetricCellProps {
  label: string
  value: string | number
  unit?: string
  trend?: 'up' | 'down' | null
  className?: string
}

export function MetricCell({ label, value, unit, trend, className = '' }: MetricCellProps) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '9px',
          fontWeight: 500,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--bp-text-dim)',
        }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--bp-text-primary)',
            lineHeight: 1,
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--bp-text-muted)',
            }}
          >
            {unit}
          </span>
        )}
        {trend === 'up' && (
          <span style={{ color: 'var(--bp-teal)', fontSize: '12px' }}>▲</span>
        )}
        {trend === 'down' && (
          <span style={{ color: 'var(--bp-red)', fontSize: '12px' }}>▼</span>
        )}
      </div>
    </div>
  )
}
