import { useEffect, useRef, type ReactNode } from 'react'

export interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Centered panel, focus-trapped, Esc closes, returns focus to the opener (docs/DESIGN.md §8). */
export function Modal({ title, onClose, children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    ref.current?.focus()
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="gg-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="gg-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gg-modal-title"
        ref={ref}
        tabIndex={-1}
      >
        <h2 className="gg-modal__title" id="gg-modal-title">
          {title}
        </h2>
        {children}
        {footer && <div className="gg-modal__footer">{footer}</div>}
      </div>
    </div>
  )
}
