import type { ReactNode } from 'react'
import type { TradeEvaluation } from '@contracts/index'
import { AcceptanceBar } from './AcceptanceBar'
import { Button } from './Button'
import { Panel } from './Panel'

export interface OfferCardProps {
  title: string
  youGet: ReactNode
  youGive: ReactNode
  evaluation: TradeEvaluation
  onAccept: () => void
  onDecline: () => void
  busy?: boolean
  revealIndex?: number
}

/**
 * One incoming trade offer: what you'd get, what you'd give up, the acceptance bar, accept/decline
 * (docs/HANDOFF.md Phase 3E; docs/DESIGN.md §11 Draft Room / Trade Center). Used in the draft-room
 * offers panel and the Trade Center's incoming-offers list.
 */
export function OfferCard({ title, youGet, youGive, evaluation, onAccept, onDecline, busy, revealIndex }: OfferCardProps) {
  return (
    <Panel variant="attention" title={title} revealIndex={revealIndex}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <strong>You get:</strong> {youGet}
      </p>
      <p style={{ margin: '0 0 var(--sp-3)' }}>
        <strong>You give:</strong> {youGive}
      </p>
      <AcceptanceBar p={evaluation.p} valid={evaluation.valid} />
      {evaluation.reasons.length > 0 && (
        <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 'var(--sp-4)', color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
          {evaluation.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
        <Button type="button" variant="primary" busy={busy} busyLabel="Working…" onClick={onAccept}>
          Accept
        </Button>
        <Button type="button" variant="ghost" onClick={onDecline}>
          Decline
        </Button>
      </div>
    </Panel>
  )
}
