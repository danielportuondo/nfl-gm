import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@ui/primitives'
import { formatMoney } from './formatMoney'

/** What a release does to the cap; computed by the engine, never by the screen. */
export interface ReleaseImpact {
  deadMoney: number
  frees: number
  /** Set when the dead money lands on a later league year (an offseason release); absent means this season. */
  season?: number
}

interface PendingRelease {
  title: string
  confirmLabel: string
  impact: ReleaseImpact | null
  onConfirm: () => void
}

/**
 * Releasing books dead money the moment it happens and cannot be taken back, so every release path
 * asks first and says what it costs: "Release X? Dead money $Y this season, frees $Z."
 */
export function useReleaseConfirm(): {
  askToRelease: (pending: PendingRelease) => void
  releaseDialog: ReactNode
} {
  const [pending, setPending] = useState<PendingRelease | null>(null)

  const releaseDialog = pending ? (
    <Modal
      title={pending.title}
      onClose={() => setPending(null)}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={() => setPending(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              pending.onConfirm()
              setPending(null)
            }}
          >
            {pending.confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {pending.impact
          ? `Dead money ${formatMoney(pending.impact.deadMoney)} ${pending.impact.season ? `on the ${pending.impact.season} cap` : 'this season'}, frees ${formatMoney(pending.impact.frees)}. `
          : ''}
        You can't undo a release.
      </p>
    </Modal>
  ) : null

  return { askToRelease: setPending, releaseDialog }
}
