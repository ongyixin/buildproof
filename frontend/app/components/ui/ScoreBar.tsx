'use client'

import { useEffect, useRef, useState } from 'react'

interface ScoreBarProps {
  value: number        // 0–100
  color: string
  animate?: boolean
  height?: number      // px, default 4
  className?: string
}

export function ScoreBar({
  value,
  color,
  animate = true,
  height = 4,
  className = '',
}: ScoreBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!animate)

  useEffect(() => {
    if (!animate) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [animate])

  return (
    <div
      ref={ref}
      className={`w-full ${className}`}
      style={{
        height: `${height}px`,
        borderRadius: '2px',
        background: 'var(--bp-border)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: '2px',
          background: color,
          width: visible ? `${Math.min(100, Math.max(0, value))}%` : '0%',
          transition: animate ? 'width 800ms ease-out' : 'none',
        }}
      />
    </div>
  )
}
