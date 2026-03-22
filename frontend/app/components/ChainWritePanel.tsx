'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getChainWeights, getChainWeightHistory, MOCK_CHAIN_WEIGHTS } from '@/lib/api'
import type { ChainWeightSnapshot, ChainWeightHistory, WeightEntry } from '@/types/models'
import { ProofStamp } from './ui/ProofStamp'

// ── Animated weight bar ───────────────────────────────────────────────────────

function WeightBar({ uid, weight, maxWeight, index }: { uid: number; weight: number; maxWeight: number; index: number }) {
  const pct = maxWeight > 0 ? (weight / maxWeight) * 100 : 0
  const color = weight > 0.3 ? 'var(--bp-teal)' : weight > 0.1 ? 'var(--bp-gold)' : 'var(--bp-text-dim)'

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: '10px', animation: `fadeIn 300ms ${index * 60}ms both ease-out` }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', width: '44px', flexShrink: 0, letterSpacing: '0.04em' }}>
        UID {uid}
      </span>
      <div style={{ flex: 1, height: '8px', background: 'var(--bp-border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: '2px',
            transition: 'width 600ms ease-out',
          }}
        />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color, width: '40px', textAlign: 'right', flexShrink: 0 }}>
        {(weight * 100).toFixed(1)}%
      </span>
    </div>
  )
}

// ── History sparkline ─────────────────────────────────────────────────────────

function HistorySparkline({ snapshots, uid }: { snapshots: ChainWeightHistory['history']; uid: number }) {
  if (snapshots.length < 2) return null

  const vals = snapshots.map((s) => s.weights.find((w) => w.uid === uid)?.weight ?? 0)
  const max = Math.max(...vals, 0.001)
  const W = 80
  const H = 24
  const step = W / (vals.length - 1)

  const pts = vals.map((v, i) => {
    const x = i * step
    const y = H - (v / max) * H
    return `${x},${y}`
  }).join(' ')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke="var(--bp-teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ChainWritePanel() {
  const [snapshot, setSnapshot] = useState<ChainWeightSnapshot | null>(null)
  const [history, setHistory] = useState<ChainWeightHistory | null>(null)
  const [isPolling, setIsPolling] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [pulse, setPulse] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [snap, hist] = await Promise.all([
        getChainWeights(),
        getChainWeightHistory(8),
      ])
      setSnapshot(snap)
      setHistory(hist)
      setLastRefreshed(new Date())
      if (snap.snapshot_at) {
        setPulse(true)
        setTimeout(() => setPulse(false), 800)
      }
    } catch {
      // Chain not running — show mock weights so the panel is populated
      if (!snapshot) {
        setSnapshot(MOCK_CHAIN_WEIGHTS)
      }
    }
  }, [])

  useEffect(() => {
    refresh()
    setIsPolling(true)
  }, [refresh])

  useEffect(() => {
    if (!isPolling) return
    intervalRef.current = setInterval(refresh, 15_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isPolling, refresh])

  const weights: WeightEntry[] = snapshot?.weights ?? []
  const maxWeight = weights.length > 0 ? Math.max(...weights.map((w) => w.weight)) : 1

  const hasData = weights.length > 0

  return (
    <div
      style={{
        border: '1px solid var(--bp-border)',
        borderTop: '2px solid var(--bp-teal)',
        borderRadius: '4px',
        background: 'var(--bp-surface)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--bp-border)',
          background: 'var(--bp-surface-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: hasData ? 'var(--bp-teal)' : 'var(--bp-text-dim)',
              animation: pulse ? 'pulseGreen 0.6s ease-out' : undefined,
            }}
          />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
            Chain Weights
          </span>
          {hasData && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-teal)', border: '1px solid rgba(0,201,167,0.3)', padding: '1px 6px', borderRadius: '2px' }}>
              LIVE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {lastRefreshed && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)' }}>
              {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--bp-text-muted)',
              background: 'none', border: '1px solid var(--bp-border)',
              borderRadius: '2px', padding: '3px 8px', cursor: 'pointer',
              transition: 'all 150ms ease-out',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--bp-teal)'; e.currentTarget.style.color = 'var(--bp-teal)' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--bp-border)'; e.currentTarget.style.color = 'var(--bp-text-muted)' }}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {!hasData ? (
          <div style={{ padding: '24px 0', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-dim)', lineHeight: 1.6 }}>
              No weight snapshots yet.
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', marginTop: '4px' }}>
              Weights are written to chain after each validator epoch.
            </p>
          </div>
        ) : (
          <>
            {/* Weight bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {weights
                .sort((a, b) => b.weight - a.weight)
                .map((w, i) => (
                  <div key={w.uid} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <WeightBar uid={w.uid} weight={w.weight} maxWeight={maxWeight} index={i} />
                    </div>
                    {/* Sparkline */}
                    {history && history.count > 1 && (
                      <div style={{ flexShrink: 0 }}>
                        <HistorySparkline snapshots={history.history} uid={w.uid} />
                      </div>
                    )}
                  </div>
                ))}
            </div>

            {/* Stats footer */}
            <div
              style={{
                display: 'flex',
                gap: '16px',
                paddingTop: '10px',
                borderTop: '1px solid var(--bp-border)',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', display: 'block' }}>
                  Active UIDs
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--bp-teal)' }}>
                  {weights.filter((w) => w.weight > 0).length}
                </span>
              </div>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', display: 'block' }}>
                  Snapshots
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '16px', fontWeight: 700, color: 'var(--bp-text-primary)' }}>
                  {history?.count ?? 1}
                </span>
              </div>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', display: 'block' }}>
                  Method
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)', letterSpacing: '0.04em' }}>
                  bt.set_weights()
                </span>
              </div>
              <div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)', display: 'block' }}>
                  Poll interval
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)' }}>15s</span>
              </div>
              <div style={{ marginLeft: 'auto', flexShrink: 0 }}>
                <ProofStamp variant="consensus" size="sm" animate={true} />
              </div>
            </div>

            {/* Ledger receipt block */}
            {snapshot?.snapshot_at && (
              <div
                style={{
                  marginTop: '12px',
                  borderTop: '1px dashed rgba(0,201,167,0.2)',
                  paddingTop: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--bp-teal-dim)', marginBottom: '4px', opacity: 0.7 }}>
                  WEIGHT WRITE RECEIPT
                </span>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>TIMESTAMP</span>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-teal)', marginTop: '2px' }}>
                      {new Date(snapshot.snapshot_at).toISOString()}
                    </p>
                  </div>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>NETWORK</span>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-muted)', marginTop: '2px' }}>
                      finney · subnet —
                    </p>
                  </div>
                  <div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--bp-text-dim)', letterSpacing: '0.06em' }}>ACTIVE MINERS</span>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-teal)', marginTop: '2px' }}>
                      {weights.filter((w) => w.weight > 0).length} / {weights.length}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-4px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
