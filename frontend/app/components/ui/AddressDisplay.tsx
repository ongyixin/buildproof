'use client'

import { useState } from 'react'

interface AddressDisplayProps {
  address: string | null
  chars?: number
  className?: string
}

export function AddressDisplay({ address, chars = 4, className = '' }: AddressDisplayProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (!address) return null

  const truncated =
    address.length > chars * 2 + 3
      ? `${address.slice(0, chars)} ... ${address.slice(-chars)}`
      : address

  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className="cursor-default"
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          color: 'var(--bp-text-muted)',
        }}
      >
        {truncated}
      </span>

      {showTooltip && address.length > chars * 2 + 3 && (
        <span
          className="absolute bottom-full left-0 mb-1 z-50 whitespace-nowrap px-2 py-1 pointer-events-none"
          style={{
            background: 'var(--bp-surface-2)',
            border: '1px solid var(--bp-border)',
            borderRadius: '2px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--bp-text-primary)',
          }}
        >
          {address}
        </span>
      )}
    </span>
  )
}
