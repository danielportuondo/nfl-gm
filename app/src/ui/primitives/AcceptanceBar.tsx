import type { TradePriceHint } from '@contracts/index'

const SEGMENTS = 20

export interface AcceptanceBarProps {
  /** Acceptance probability 0–1, as returned by trade.evaluate / TradeEvaluation.p. */
  p: number
  /** TradeEvaluation.valid — false means a hard gate failed (cap, roster size, unknown asset…). */
  valid: boolean
  label?: string
  /**
   * What p means here. `acceptance`: the counterparty's chance of saying yes to the user's proposal.
   * `fairness`: the same evaluation read from the user's side of an AI-initiated deal, which the AI
   * already stands behind — the bar says how good the deal is for the user, not whether it goes through.
   */
  mode?: 'acceptance' | 'fairness'
  /** TradeEvaluation.priceHint: shown under an acceptance read below even. */
  priceHint?: TradePriceHint
  /** Whether the user already has something on the table, so the hint reads as "more". */
  adding?: boolean
}

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th']

function priceHintText(hint: TradePriceHint, adding: boolean): string {
  if (hint.round === null)
    return adding ? "They'd want more than a 1st on top." : "They'd want more than a 1st."
  const pick = ORDINALS[hint.round - 1] ?? `round ${hint.round} pick`
  return adding ? `They'd want about a ${pick} more.` : `They'd want about a ${pick}.`
}

function band(p: number, mode: 'acceptance' | 'fairness'): string {
  if (mode === 'fairness') {
    // Never "Fair" below an even deal: a 47% suggestion read as Fair while it cost the user value.
    if (p < 0.4) return 'Against you'
    if (p < 0.5) return 'Slightly against you'
    if (p <= 0.6) return 'Fair'
    return 'Favors you'
  }
  if (p < 0.35) return 'Unlikely'
  if (p <= 0.65) return 'Coin flip'
  return 'Likely'
}

function toneFor(p: number, mode: 'acceptance' | 'fairness'): 'danger' | 'accent' | 'positive' {
  const [low, high] = mode === 'fairness' ? [0.4, 0.6] : [0.35, 0.65]
  if (p < low) return 'danger'
  if (p <= high) return 'accent'
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
export function AcceptanceBar({
  p,
  valid,
  mode = 'acceptance',
  priceHint,
  adding = false,
  label = mode === 'fairness' ? 'Deal value for you' : 'Acceptance likelihood',
}: AcceptanceBarProps) {
  const clamped = Math.min(1, Math.max(0, p))
  const filledCount = valid ? Math.round(clamped * SEGMENTS) : 0
  const tone = toneFor(clamped, mode)
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
        {valid ? band(clamped, mode) : 'Invalid'}
      </span>
      {valid && mode === 'acceptance' && clamped < 0.5 && priceHint && (
        <span className="gg-acceptance-band">{priceHintText(priceHint, adding)}</span>
      )}
      <span className="gg-vh">{label}</span>
    </div>
  )
}
