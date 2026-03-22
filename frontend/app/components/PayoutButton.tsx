'use client'

import { useState, useEffect, useRef } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import type { FundingDecision } from '@/types/models'

const DEMO_RECIPIENT = new PublicKey('4Nd1mBQtrMJVYVfKf2PX98AdN7qqoZeSD28wnABLP1e8')
const DEMO_AMOUNT_SOL = 0.001

interface PayoutButtonProps {
  decision: FundingDecision | null
  proposalId?: string
  onPayoutComplete?: () => void
}

type PayoutState = 'idle' | 'sending' | 'success' | 'error'
type TxLifecycleStep = 'pending' | 'signed' | 'submitted' | 'confirmed'

const TX_STEPS: TxLifecycleStep[] = ['pending', 'signed', 'submitted', 'confirmed']
const TX_STEP_LABELS: Record<TxLifecycleStep, string> = {
  pending: 'Pending',
  signed: 'Signed',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
}

// ── Animated checkmark SVG ────────────────────────────────────────────────────

function AnimatedCheckmark() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      style={{ margin: '0 auto 16px', display: 'block' }}
    >
      <circle
        cx="24"
        cy="24"
        r="22"
        stroke="var(--bp-teal)"
        strokeWidth="2"
        strokeDasharray="138"
        strokeDashoffset="138"
        style={{
          animation: 'strokeReveal 0.4s ease-out 0.1s forwards',
          strokeLinecap: 'round',
        }}
      />
      <path
        d="M14 24l8 8 12-14"
        stroke="var(--bp-teal)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="30"
        strokeDashoffset="30"
        style={{
          animation: 'strokeReveal 0.4s ease-out 0.3s forwards',
        }}
      />
      <style jsx>{`
        @keyframes strokeReveal {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '14px',
        height: '14px',
        border: '1.5px solid #0D0F14',
        borderTopColor: 'transparent',
        borderRadius: '50%',
        animation: 'payoutSpin 0.8s linear infinite',
        flexShrink: 0,
      }}
    />
  )
}

// ── Provenance step ───────────────────────────────────────────────────────────

function ProvenanceStep({
  step,
  label,
  value,
  isLast,
}: {
  step: number
  label: string
  value: string
  isLast: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '12px', position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            border: '1.5px solid var(--bp-teal)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: 700,
            color: 'var(--bp-teal)',
            flexShrink: 0,
          }}
        >
          {step}
        </div>
        {!isLast && (
          <div
            style={{
              width: '1px',
              flex: 1,
              minHeight: '16px',
              borderLeft: '1.5px dashed var(--bp-border)',
              marginTop: '4px',
            }}
          />
        )}
      </div>
      <div style={{ paddingBottom: isLast ? 0 : '16px' }}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--bp-text-primary)',
            marginBottom: '2px',
            lineHeight: '22px',
          }}
        >
          {label}
        </p>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--bp-text-dim)',
          }}
        >
          {value}
        </p>
      </div>
    </div>
  )
}

// ── Confetti particle ─────────────────────────────────────────────────────────

const CONFETTI_COLORS = [
  'var(--bp-gold)',
  'var(--bp-teal)',
  'var(--bp-purple, #A78BFA)',
  'var(--bp-gold)',
  'var(--bp-teal)',
  'var(--bp-purple, #A78BFA)',
  'var(--bp-gold)',
  'var(--bp-teal)',
  'var(--bp-purple, #A78BFA)',
  'var(--bp-gold)',
]

const CONFETTI_PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  color: CONFETTI_COLORS[i],
  x: (i - 5) * 28 + (i % 3) * 12,
  delay: i * 0.06,
  rotation: (i * 47 + 15) % 360,
  size: 5 + (i % 3) * 2,
}))

function ConfettiParticles() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '0',
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      {CONFETTI_PARTICLES.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '-24px',
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: p.color,
            borderRadius: p.id % 3 === 0 ? '50%' : '1px',
            opacity: 0,
            animation: `confettiBurst 1.2s ease-out ${p.delay}s forwards`,
            ['--confetti-x' as string]: `${p.x}px`,
            ['--confetti-rot' as string]: `${p.rotation}deg`,
          }}
        />
      ))}
    </div>
  )
}

// ── Transaction lifecycle stepper ─────────────────────────────────────────────

function TxLifecycleStepper({ currentStep }: { currentStep: TxLifecycleStep }) {
  const currentIdx = TX_STEPS.indexOf(currentStep)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0',
        height: '52px',
        background: 'var(--bp-gold)',
        borderRadius: '4px',
        padding: '0 16px',
      }}
    >
      {TX_STEPS.map((step, i) => {
        const isActive = i <= currentIdx
        const isCurrent = i === currentIdx
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: isActive ? '#0D0F14' : 'rgba(13,15,20,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 300ms ease, transform 300ms ease',
                  transform: isCurrent ? 'scale(1.15)' : 'scale(1)',
                }}
              >
                {isActive && i < currentIdx ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2.5 2.5L8 3" stroke="var(--bp-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : isCurrent ? (
                  <span
                    style={{
                      display: 'block',
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: 'var(--bp-gold)',
                      animation: 'txPulse 1s ease-in-out infinite',
                    }}
                  />
                ) : null}
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '8px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: isActive ? '#0D0F14' : 'rgba(13,15,20,0.4)',
                  whiteSpace: 'nowrap',
                  transition: 'color 300ms ease',
                }}
              >
                {TX_STEP_LABELS[step]}
              </span>
            </div>
            {i < TX_STEPS.length - 1 && (
              <div
                style={{
                  width: '28px',
                  height: '1.5px',
                  background: i < currentIdx ? '#0D0F14' : 'rgba(13,15,20,0.15)',
                  margin: '0 6px',
                  marginBottom: '14px',
                  transition: 'background 300ms ease',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PayoutButton({ decision, proposalId, onPayoutComplete }: PayoutButtonProps) {
  const { connection } = useConnection()
  const { publicKey, sendTransaction, connected } = useWallet()
  const [state, setState] = useState<PayoutState>('idle')
  const [signature, setSignature] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [txStep, setTxStep] = useState<TxLifecycleStep>('pending')
  const [mounted, setMounted] = useState(false)
  const txStepTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Ensure WalletMultiButton only renders on client to avoid hydration mismatch
  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (state === 'sending') {
      setTxStep('pending')
      txStepTimers.current.forEach(clearTimeout)
      txStepTimers.current = []

      const steps: TxLifecycleStep[] = ['signed', 'submitted', 'confirmed']
      steps.forEach((step, i) => {
        const timer = setTimeout(() => setTxStep(step), (i + 1) * 500)
        txStepTimers.current.push(timer)
      })
    } else {
      txStepTimers.current.forEach(clearTimeout)
      txStepTimers.current = []
    }
    return () => {
      txStepTimers.current.forEach(clearTimeout)
    }
  }, [state])

  const handlePayout = async () => {
    if (!publicKey) return
    setState('sending')
    setErrorMsg(null)

    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

      const transaction = new Transaction({
        feePayer: publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: DEMO_RECIPIENT,
          lamports: LAMPORTS_PER_SOL * DEMO_AMOUNT_SOL,
        })
      )

      const sig = await sendTransaction(transaction, connection)
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })

      setSignature(sig)
      setState('success')
      onPayoutComplete?.()
    } catch (e: unknown) {
      setState('error')
      setErrorMsg(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  const explorerUrl = signature
    ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    : null

  const isFundable =
    decision?.recommendation === 'fund' || decision?.recommendation === 'fund_with_conditions'

  const recipientShort = `${DEMO_RECIPIENT.toBase58().slice(0, 4)}…${DEMO_RECIPIENT.toBase58().slice(-4)}`
  const walletShort = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}`
    : null

  return (
    <section
      id="payout"
      style={{
        padding: '64px 32px 80px',
        borderTop: '1px solid var(--bp-border)',
      }}
    >
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        {/* Legal document header */}
        <div style={{ borderBottom: '2px solid var(--bp-text-primary)', paddingBottom: '20px', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--bp-text-dim)',
              letterSpacing: '0.1em',
            }}>
              § 07
            </span>
            <span style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--bp-text-dim)',
            }}>
              Disbursement Authorization
            </span>
          </div>

          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(32px, 5vw, 56px)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: 'var(--bp-text-primary)',
              marginBottom: '12px',
              lineHeight: 1.1,
            }}
          >
            Disbursement <span style={{ fontStyle: 'italic', color: 'var(--bp-teal)' }}>Authorization</span>
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
              lineHeight: 1.75,
              color: 'var(--bp-text-muted)',
            }}
          >
            Demo payout layer. Connect a Phantom or Solflare wallet (Solana devnet) and
            authorize a 0.001 SOL disbursement. Devnet SOL available from{' '}
            <a
              href="https://faucet.solana.com"
              target="_blank"
              rel="noreferrer"
              style={{
                color: 'var(--bp-gold)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
              }}
            >
              faucet.solana.com
            </a>
            .
          </p>
        </div>

        {/* § 7.1 — Linked proposal */}
        {decision && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', minWidth: '32px' }}>7.1</span>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
                Linked Proposal
              </span>
            </div>
            <div
              style={{
                padding: '14px 20px',
                borderLeft: `3px solid ${isFundable ? 'var(--bp-teal)' : 'var(--bp-red)'}`,
                borderBottom: '1px solid var(--bp-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginLeft: '44px',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--bp-text-primary)' }}>
                {proposalId ?? '—'}
              </span>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: isFundable ? 'var(--bp-teal)' : 'var(--bp-red)',
                padding: '2px 10px',
                border: `1px solid ${isFundable ? 'var(--bp-teal)' : 'var(--bp-red)'}`,
                borderRadius: '2px',
              }}>
                {isFundable ? 'Approved' : 'Not approved'}
              </span>
            </div>
          </div>
        )}

        {/* ── § 7.2 Eligibility ──────────────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', minWidth: '32px' }}>7.2</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
              Eligibility Determination
            </span>
          </div>
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--bp-border)',
            marginLeft: '44px',
          }}
        >
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--bp-text-muted)',
              marginBottom: '8px',
              lineHeight: 1.5,
            }}
          >
            Top-ranked miner selected based on validator rewards
          </p>
          {decision && isFundable ? (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 700,
                color: 'var(--bp-teal)',
                marginBottom: '8px',
              }}
            >
              Consensus: FUND
            </p>
          ) : (
            <p
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: 'var(--bp-text-dim)',
                marginBottom: '8px',
              }}
            >
              Awaiting evaluation consensus
            </p>
          )}
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--bp-text-dim)',
              fontStyle: 'italic',
            }}
          >
            The best evaluation is economically rewarded
          </p>
        </div>
        </div>

        {/* ── § 7.3 Provenance chain ──────────────────────────────────────── */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', minWidth: '32px' }}>7.3</span>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
              Provenance Chain
            </span>
          </div>
          <div style={{ marginLeft: '44px', borderLeft: '1px solid var(--bp-border)', paddingLeft: '20px' }}>
            {[
              { num: '7.3.1', label: 'Proposal evaluated', value: proposalId ? `ID: ${proposalId}` : 'No proposal linked' },
              { num: '7.3.2', label: 'Miner selected', value: 'Best performing miner elected by validator consensus' },
              { num: '7.3.3', label: 'Score computed', value: decision?.consensus_confidence != null ? `Consensus confidence: ${(decision.consensus_confidence * 100).toFixed(0)}%` : 'Pending evaluation' },
              { num: '7.3.4', label: 'Payout authorized', value: isFundable ? `${DEMO_AMOUNT_SOL} SOL → ${recipientShort}` : 'Awaiting authorization' },
            ].map((item, i, arr) => (
              <div key={item.num} style={{ paddingBottom: i < arr.length - 1 ? '14px' : 0, paddingTop: i > 0 ? '0' : '0', borderBottom: i < arr.length - 1 ? '1px solid var(--bp-border)' : 'none', marginBottom: i < arr.length - 1 ? '14px' : 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', minWidth: '36px', flexShrink: 0 }}>{item.num}</span>
                  <div>
                    <span style={{ fontFamily: 'var(--font-sans)', fontSize: '13px', fontWeight: 600, color: 'var(--bp-text-primary)', display: 'block', marginBottom: '2px' }}>{item.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--bp-text-muted)' }}>{item.value}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid var(--bp-border)', margin: '0 0 24px' }} />

        {/* § 7.4 — Wallet signature block */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--bp-text-dim)', minWidth: '32px' }}>7.4</span>
          <span style={{ fontFamily: 'var(--font-sans)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bp-text-dim)' }}>
            Wallet Signature
          </span>
        </div>
        <div
          style={{ padding: '20px', border: '1px solid var(--bp-border)', marginLeft: '44px', borderRadius: '2px' }}
        >
          {/* Wallet row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '16px',
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}
              >
                WALLET
              </p>
              {connected && walletShort ? (
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: '#22C55E',
                  }}
                >
                  {walletShort}
                </p>
              ) : (
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '14px',
                    color: 'var(--bp-text-muted)',
                  }}
                >
                  Not connected
                </p>
              )}
            </div>
            {mounted && <WalletMultiButton />}
          </div>

          {/* Divider */}
          <div
            style={{
              height: '1px',
              background: 'var(--bp-border)',
              margin: '16px 0',
            }}
          />

          {/* 2×2 details grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '20px',
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}
              >
                NETWORK
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--bp-teal)',
                }}
              >
                Solana Devnet
              </p>
            </div>
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}
              >
                AMOUNT
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--bp-text-primary)',
                }}
              >
                {DEMO_AMOUNT_SOL} SOL
              </p>
            </div>
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}
              >
                RECIPIENT
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--bp-text-primary)',
                }}
              >
                {recipientShort}
              </p>
            </div>
            <div>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}
              >
                PURPOSE
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  color: 'var(--bp-text-primary)',
                }}
              >
                Demo disbursement
              </p>
            </div>
          </div>

          {/* Action button */}
          {state === 'idle' && (
            <button
              onClick={handlePayout}
              disabled={!connected || !isFundable}
              style={{
                width: '100%',
                height: '52px',
                background: connected && isFundable ? 'var(--bp-gold)' : 'var(--bp-surface-2)',
                color: connected && isFundable ? '#0D0F14' : 'var(--bp-text-dim)',
                border: connected && isFundable ? 'none' : '1px solid var(--bp-border)',
                borderRadius: '4px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                cursor: !connected || !isFundable ? 'not-allowed' : 'pointer',
                opacity: !connected || !isFundable ? 0.6 : 1,
                transition: 'filter 150ms ease-out',
              }}
              onMouseEnter={(e) => {
                if (connected && isFundable) e.currentTarget.style.filter = 'brightness(1.08)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'none'
              }}
            >
              {!connected
                ? 'CONNECT WALLET FIRST'
                : !isFundable
                ? 'PROPOSAL NOT APPROVED'
                : 'APPROVE 0.001 SOL DISBURSEMENT'}
            </button>
          )}

          {state === 'sending' && (
            <TxLifecycleStepper currentStep={txStep} />
          )}

          {state === 'success' && signature && (
            <div style={{ position: 'relative' }}>
              {/* Legal confirmation document style */}
              <div style={{
                borderTop: '2px solid var(--bp-teal)',
                paddingTop: '20px',
                marginBottom: '16px',
              }}>
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-teal)',
                  marginBottom: '10px',
                }}>
                  ✓ Transaction Confirmed
                </p>
                <p style={{
                  fontFamily: 'var(--font-legal-body)',
                  fontSize: '15px',
                  color: 'var(--bp-text-muted)',
                  lineHeight: 1.75,
                  marginBottom: '14px',
                }}>
                  The disbursement of {DEMO_AMOUNT_SOL} SOL has been authorized and recorded on-chain.
                  Reference below serves as proof of transaction.
                </p>
              </div>

              <div
                style={{
                  padding: '12px 14px',
                  borderLeft: '3px solid var(--bp-teal)',
                  marginBottom: '12px',
                  background: 'var(--bp-surface-2)',
                }}
              >
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--bp-text-dim)',
                  marginBottom: '4px',
                }}>
                  Transaction Reference
                </p>
                <p style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--bp-text-primary)',
                  wordBreak: 'break-all' as const,
                }}>
                  {signature.slice(0, 8)}…{signature.slice(-8)}
                </p>
                <p style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '11px',
                  color: 'var(--bp-teal)',
                  marginTop: '4px',
                }}>
                  +{DEMO_AMOUNT_SOL} SOL disbursed
                </p>
              </div>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    color: 'var(--bp-teal)',
                    textDecoration: 'none',
                    transition: 'opacity 150ms ease-out',
                    marginBottom: '16px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                >
                  View on Explorer
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 8L8 2M4 2h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}

              {/* Why this matters footnote */}
              <div
                style={{
                  borderTop: '1px solid var(--bp-border)',
                  paddingTop: '12px',
                  marginTop: '4px',
                }}
              >
                <p
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--bp-text-dim)',
                    marginBottom: '6px',
                  }}
                >
                  Why this matters
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-legal-body)',
                    fontSize: '14px',
                    color: 'var(--bp-text-muted)',
                    lineHeight: 1.7,
                    fontStyle: 'italic',
                  }}
                >
                  Good evaluation is economically rewarded — miners compete to be the most
                  accurate, and the best one earns the payout.
                </p>
              </div>
            </div>
          )}

          {state === 'error' && (
            <div
              style={{
                background: 'var(--bp-red-dim)',
                border: '1px solid rgba(224,82,82,0.3)',
                borderRadius: '4px',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
              }}
            >
              <span
                style={{
                  color: 'var(--bp-red)',
                  fontSize: '14px',
                  flexShrink: 0,
                  marginTop: '1px',
                }}
              >
                !
              </span>
              <div style={{ flex: 1 }}>
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--bp-red)',
                    marginBottom: '4px',
                  }}
                >
                  Transaction failed
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'rgba(224,82,82,0.8)',
                    marginBottom: '8px',
                  }}
                >
                  {errorMsg}
                </p>
                <button
                  onClick={() => setState('idle')}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--bp-gold)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '12px',
            color: 'var(--bp-text-dim)',
            textAlign: 'center',
            marginTop: '16px',
            fontStyle: 'italic',
          }}
        >
          This is a devnet demo. No real funds are transferred.
        </p>
      </div>

      <style jsx>{`
        @keyframes payoutSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes txPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes confettiBurst {
          0% {
            opacity: 1;
            transform: translate(-50%, 0) rotate(0deg) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(
              calc(-50% + var(--confetti-x)),
              -60px
            ) rotate(var(--confetti-rot)) scale(0.5);
          }
        }
        @keyframes badgePop {
          0% {
            opacity: 0;
            transform: scale(0.6);
          }
          60% {
            transform: scale(1.08);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </section>
  )
}
