'use client'

interface ProofStampProps {
  label?: string
  hash?: string
  variant?: 'consensus' | 'verified' | 'sealed'
  size?: 'sm' | 'md'
  animate?: boolean
}

const VARIANT_CONFIG = {
  consensus: { text: 'CONSENSUS', color: 'var(--bp-teal)', glow: 'var(--bp-teal-glow)' },
  verified:  { text: 'VERIFIED',  color: 'var(--bp-teal)', glow: 'var(--bp-teal-glow)' },
  sealed:    { text: 'SEALED',    color: 'var(--bp-gold)', glow: 'var(--bp-gold-glow)' },
}

export function ProofStamp({
  label,
  hash,
  variant = 'consensus',
  size = 'md',
  animate = false,
}: ProofStampProps) {
  const cfg = VARIANT_CONFIG[variant]
  const dim = size === 'sm' ? 56 : 72
  const r = dim / 2 - 4
  const cx = dim / 2
  const cy = dim / 2
  const circumference = 2 * Math.PI * r

  const displayLabel = label ?? cfg.text
  const shortHash = hash ? hash.slice(0, 8) : null

  return (
    <div
      className={animate ? 'proof-stamp-active' : undefined}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      <svg
        width={dim}
        height={dim}
        viewBox={`0 0 ${dim} ${dim}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Outer dashed ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={cfg.color}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity={0.4}
        />

        {/* Inner solid ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r - 4}
          fill={`${cfg.color}08`}
          stroke={cfg.color}
          strokeWidth="1"
          opacity={0.8}
        />

        {/* Check/seal icon */}
        {variant === 'sealed' ? (
          <path
            d={`M${cx - 5} ${cy} l4 4 l7 -8`}
            fill="none"
            stroke={cfg.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d={`M${cx - 6} ${cy} l4 4 l8 -8`}
            fill="none"
            stroke={cfg.color}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Label text curved along top */}
        <path
          id="proof-arc"
          d={`M ${cx - r + 6} ${cy} A ${r - 6} ${r - 6} 0 0 1 ${cx + r - 6} ${cy}`}
          fill="none"
        />
        <text
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: size === 'sm' ? '5px' : '6px',
            fontWeight: 700,
            letterSpacing: '0.15em',
            fill: cfg.color,
            textAnchor: 'middle',
          }}
        >
          <textPath href="#proof-arc" startOffset="50%">
            {displayLabel}
          </textPath>
        </text>

        {/* Animated stroke-reveal on mount */}
        {animate && (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={cfg.color}
            strokeWidth="1.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            opacity={0.3}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <animate
              attributeName="stroke-dashoffset"
              from={circumference}
              to={0}
              dur="1s"
              fill="freeze"
              calcMode="spline"
              keySplines="0.4 0 0.2 1"
            />
          </circle>
        )}
      </svg>

      {shortHash && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '9px',
            letterSpacing: '0.08em',
            color: cfg.color,
            opacity: 0.6,
          }}
        >
          {shortHash}…
        </span>
      )}
    </div>
  )
}
