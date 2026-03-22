'use client'

import { useEffect, useRef, useState } from 'react'

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

interface UseCountUpOptions {
  target: number
  duration?: number   // ms, default 800
  decimals?: number   // decimal places, default 0
  prefix?: string
  suffix?: string
  startOnMount?: boolean
}

export function useCountUp({
  target,
  duration = 800,
  decimals = 0,
  prefix = '',
  suffix = '',
  startOnMount = true,
}: UseCountUpOptions) {
  const [value, setValue] = useState(startOnMount ? 0 : target)
  const [started, setStarted] = useState(startOnMount)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (!started) return

    const startTime = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = easeOutQuart(progress)
      setValue(parseFloat((eased * target).toFixed(decimals)))

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setValue(target)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration, decimals, started])

  const start = () => setStarted(true)

  const display = `${prefix}${value.toFixed(decimals)}${suffix}`

  return { value, display, start }
}
