'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Toast as ToastItem, ToastType, ToastContextValue } from '@/hooks/useToast'
import { ToastContext } from '@/hooks/useToast'

// ── Individual Toast ──────────────────────────────────────────────────────────

const BORDER_COLORS: Record<ToastType, string> = {
  success: 'var(--bp-teal)',
  error:   'var(--bp-red)',
  info:    'var(--bp-gold)',
}

const ICON_COLORS: Record<ToastType, string> = {
  success: 'var(--bp-teal)',
  error:   'var(--bp-red)',
  info:    'var(--bp-gold)',
}

function ToastIcon({ type }: { type: ToastType }) {
  if (type === 'success') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (type === 'error') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6.5v4M7 4.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: ToastItem
  onRemove: (id: string) => void
}) {
  const [exiting, setExiting] = useState(false)
  const borderColor = BORDER_COLORS[toast.type]
  const iconColor = ICON_COLORS[toast.type]

  const dismiss = useCallback(() => {
    setExiting(true)
    setTimeout(() => onRemove(toast.id), 150)
  }, [toast.id, onRemove])

  useEffect(() => {
    const timer = setTimeout(dismiss, 4000)
    return () => clearTimeout(timer)
  }, [dismiss])

  return (
    <div
      className={exiting ? 'animate-slide-out-right' : 'animate-slide-in-right'}
      style={{
        width: '320px',
        background: 'var(--bp-surface-2)',
        border: '1px solid var(--bp-border)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '4px',
        padding: '16px',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
        cursor: 'pointer',
      }}
      onClick={dismiss}
    >
      <span style={{ color: iconColor, flexShrink: 0, marginTop: '1px' }}>
        <ToastIcon type={toast.type} />
      </span>
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--bp-text-primary)',
              marginBottom: '2px',
            }}
          >
            {toast.title}
          </p>
        )}
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--bp-text-muted)',
            lineHeight: 1.5,
          }}
        >
          {toast.message}
        </p>
      </div>
    </div>
  )
}

// ── Toast Provider ────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const counterRef = useRef(0)

  const addToast = useCallback((type: ToastType, message: string, title?: string) => {
    const id = `toast-${++counterRef.current}`
    setToasts((prev) => [...prev, { id, type, message, title }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const value: ToastContextValue = { toasts, addToast, removeToast }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container */}
      <div
        style={{
          position: 'fixed',
          top: '64px',  // below nav
          right: '16px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => (
          <div key={toast.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
