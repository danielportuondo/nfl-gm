const SEGMENTS = 20

export interface AcceptanceBarProps {
  /** Acceptance probability 0–1, as returned by trade.evaluate / TradeEvaluation.p. */
  p: number
  /** TradeEvaluation.valid — false means a hard gate failed (cap, roster size, unknown asset…). */
  valid: boolean
  label?: string
}

function band(p: number): 'Unlikely' | 'Coin flip' | 'Likely' {
  if (p < 0.35) return 'Unlikely'
  if (p <= 0.65) return 'Coin flip'
  return 'Likely'
}

function toneFor(p: number): 'danger' | 'accent' | 'positive' {
  if (p < 0.35) return 'danger'
  if (p <= 0.65) return 'accent'
  return 'positive'
}

const TONE_VAR: Record<'danger' | 'accent' | 'positive', string> = {
  danger: 'var(--danger)',
  accent: 'var(--accent)',
  positive: 'var(--positive)',
}

/**
 * The draft-room / trade-center acceptance bar (docs/HANDOFF.md Phase 3E, docs/DESIGN.md §8 Meter).
 * Maps TradeEvaluation.p to a 20-segment fill plus a plain-language band; an invalid proposal (a hard
 * gate failed) shows "Invalid" instead of a percentage so the user never mistakes a gated deal for a
 * merely unlikely one.
 */
export function AcceptanceBar({ p, valid, label = 'Acceptance likelihood' }: AcceptanceBarProps) {
  const clamped = Math.min(1, Math.max(0, p))
  const filledCount = valid ? Math.round(clamped * SEGMENTS) : 0
  const tone = toneFor(clamped)
  return (
    <div className="gg-meter">
      <div
        className="gg-meter__row"
        role="meter"
        aria-valuenow={valid ? clamped : 0}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-label={label}
      >
        <div className="gg-meter__track" aria-hidden="true">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className="gg-meter__seg"
              style={i < filledCount ? { background: TONE_VAR[tone] } : undefined}
            />
          ))}
        </div>
        <span className="gg-meter__label" style={!valid ? { color: 'var(--danger)' } : undefined}>
          {valid ? `${Math.round(clamped * 100)}%` : 'Invalid'}
        </span>
      </div>
      <span className="gg-acceptance-band" style={!valid ? { color: 'var(--danger)' } : undefined}>
        {valid ? band(clamped) : 'Invalid'}
      </span>
      <span className="gg-vh">{label}</span>
    </div>
  )
}
