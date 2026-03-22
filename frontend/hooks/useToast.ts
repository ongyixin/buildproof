'use client'

import { createContext, useContext } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  type: ToastType
  message: string
  title?: string
}

export interface ToastContextValue {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, title?: string) => void
  removeToast: (id: string) => void
}

export const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  addToast: () => {},
  removeToast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}
