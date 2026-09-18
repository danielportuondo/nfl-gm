import { useEffect, useRef } from 'react'

export interface ToastItem {
  id: string
  text: string
  tone?: 'info' | 'success' | 'warn' | 'error'
}

interface ToastRegionProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

const TONE_CLASS: Record<NonNullable<ToastItem['tone']>, string> = {
  info: '',
  success: 'gg-toast--success',
  warn: 'gg-toast--warn',
  error: 'gg-toast--error',
}

const AUTO_DISMISS_MS = 5000

function ToastRow({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const start = () => {
    timer.current = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
  }
  const stop = () => timer.current && clearTimeout(timer.current)

  useEffect(() => {
    start()
    return stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id])

  return (
    <div
      className={['gg-toast', TONE_CLASS[toast.tone ?? 'info']].filter(Boolean).join(' ')}
      role="status"
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
    >
      {toast.text}
    </div>
  )
}

/** Bottom-right on desktop, top on ≤720px; max 3 stacked, paused on hover/focus (docs/DESIGN.md §8). */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  const visible = toasts.slice(-3)
  if (visible.length === 0) return null
  return (
    <div className="gg-toast-region">
      {visible.map((t) => (
        <ToastRow key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
