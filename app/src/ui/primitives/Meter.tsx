const SEGMENTS = 20

export interface MeterProps {
  /** 0–1. */
  value: number
  label: string
  min?: number
  max?: number
  /** Cap usage reads the other way: high is bad (docs/DESIGN.md §8). */
  invert?: boolean
}

function toneFor(value: number, invert: boolean): 'danger' | 'accent' | 'positive' {
  if (invert) return value > 0.95 ? 'danger' : value > 0.65 ? 'accent' : 'positive'
  if (value < 0.35) return 'danger'
  if (value <= 0.65) return 'accent'
  return 'positive'
}

const TONE_VAR: Record<'danger' | 'accent' | 'positive', string> = {
  danger: 'var(--danger)',
  accent: 'var(--accent)',
  positive: 'var(--positive)',
}

/** 20-segment meter bar used for acceptance likelihood, confidence, cap usage, horizon progress. */
export function Meter({ value, label, min = 0, max = 1, invert = false }: MeterProps) {
  const clamped = Math.min(1, Math.max(0, value))
  const filledCount = Math.round(clamped * SEGMENTS)
  const tone = toneFor(clamped, invert)
  return (
    <div className="gg-meter">
      <div
        className="gg-meter__row"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
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
        <span className="gg-meter__label">{Math.round(clamped * 100)}%</span>
      </div>
      <span className="gg-vh">{label}</span>
    </div>
  )
}
