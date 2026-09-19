/**
 * Pure lookups over `curves.json` (docs/DATA_CONTRACT.md#curvesjson). No state, no rng — everything
 * here is a deterministic function of (curves, pos, age/pick) so progression, retirement and the
 * procedural generator can share it.
 */
import type { AgingCurve, CurvesFile, OutcomeTable, Position } from '@contracts/index'
import { DEFAULT_AGING_SD, RETIREMENT_PROB_EPSILON, RETIREMENT_VALUE_BASELINE } from './constants'

/** Ratings live on the 40–99 scale at one decimal, like the shipped consensus data. */
export const clampRating = (x: number): number =>
  Math.round(Math.min(99, Math.max(40, x)) * 10) / 10

function agingCurveFor(curves: CurvesFile, pos: Position): AgingCurve | undefined {
  return curves.aging.find((c) => c.pos === pos)
}

/** Nearest defined age key, clamped to the curve's fitted range (ages outside it reuse the boundary). */
function clampToKeys(byAge: Record<string, number>, age: number): number {
  const keys = Object.keys(byAge).map(Number)
  const min = Math.min(...keys)
  const max = Math.max(...keys)
  return Math.min(max, Math.max(min, Math.round(age)))
}

/** Expected true-value delta entering a season at `age` (HANDOFF §6.7). */
export function ageDelta(curves: CurvesFile, pos: Position, age: number): number {
  const curve = agingCurveFor(curves, pos)
  if (!curve) return 0
  const key = clampToKeys(curve.byAge, age)
  return curve.byAge[String(key)] ?? 0
}

export function agingSd(curves: CurvesFile, pos: Position): number {
  return agingCurveFor(curves, pos)?.sd ?? DEFAULT_AGING_SD
}

/** Linear interpolation between the sparse `slotGrade` sample points; clamps outside the fitted range. */
export function interpolateSlotGrade(
  curves: CurvesFile,
  pick: number,
): { ovr: number; pot: number; sd: number } {
  const pts = curves.slotGrade
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (!first || !last) return { ovr: 60, pot: 65, sd: 5 }
  if (pick <= first.pick) return { ovr: first.ovr, pot: first.pot, sd: first.sd }
  if (pick >= last.pick) return { ovr: last.ovr, pot: last.pot, sd: last.sd }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    if (pick >= a.pick && pick <= b.pick) {
      const t = (pick - a.pick) / (b.pick - a.pick)
      return { ovr: lerp(a.ovr, b.ovr, t), pot: lerp(a.pot, b.pot, t), sd: lerp(a.sd, b.sd, t) }
    }
  }
  return { ovr: last.ovr, pot: last.pot, sd: last.sd }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** P(retire after this season), per HANDOFF §6.7: logistic in age (from the fitted curve) and value. */
export function retireProbability(
  curves: CurvesFile,
  pos: Position,
  age: number,
  value: number,
): number {
  const curve = curves.retirement.find((c) => c.pos === pos)
  if (!curve) return 0
  const key = clampToKeys(curve.byAge, age)
  const base = clamp01(curve.byAge[String(key)] ?? 0)
  const logit = Math.log(base / (1 - base))
  const adjusted = logit + curve.valueSlope * (value - RETIREMENT_VALUE_BASELINE)
  return 1 / (1 + Math.exp(-adjusted))
}

function clamp01(p: number): number {
  return Math.min(1 - RETIREMENT_PROB_EPSILON, Math.max(RETIREMENT_PROB_EPSILON, p))
}

/** Best-matching pick→outcome row: position-specific bucket row, falling back to the bucket's 'ALL' row. */
export function findOutcomeTable(
  curves: CurvesFile,
  bucket: string,
  pos: Position,
): OutcomeTable | undefined {
  return (
    curves.outcomes.find((o) => o.bucket === bucket && o.pos === pos) ??
    curves.outcomes.find((o) => o.bucket === bucket && o.pos === 'ALL')
  )
}

/** Pick-slot bucket label used by curves.outcomes (DATA_CONTRACT). */
export function bucketForPick(pick: number): string {
  if (pick <= 10) return '1-10'
  if (pick <= 32) return '11-32'
  if (pick <= 64) return '33-64'
  if (pick <= 105) return '65-105'
  if (pick <= 160) return '106-160'
  return '161-260'
}

/** Interpolate a value at career-percentile `u` (0–1) from an outcome row's quantile grid at `yearIdx`. */
export function outcomeValueAt(table: OutcomeTable, yearIdx: number, u: number): number {
  const yearPos = table.years.indexOf(yearIdx)
  const values = table.values[yearPos === -1 ? table.years.length - 1 : yearPos]
  if (!values || values.length === 0) return RETIREMENT_VALUE_BASELINE
  const quantiles = table.quantiles
  return interpolateAtLevel(quantiles, values, u)
}

/** Interpolate `values[i]` (aligned to `levels[i]`) at an arbitrary level in [0,1], clamped at the ends. */
export function interpolateAtLevel(
  levels: readonly number[],
  values: readonly number[],
  level: number,
): number {
  const first = values[0]
  const last = values[values.length - 1]
  if (first === undefined || last === undefined) return RETIREMENT_VALUE_BASELINE
  if (level <= levels[0]!) return first
  if (level >= levels[levels.length - 1]!) return last
  for (let i = 0; i < levels.length - 1; i++) {
    const lo = levels[i]!
    const hi = levels[i + 1]!
    if (level >= lo && level <= hi) {
      const t = (level - lo) / (hi - lo)
      return lerp(values[i]!, values[i + 1]!, t)
    }
  }
  return last
}

/** Ceiling estimate for refreshScouting's pot: accumulate the aging curve's positive deltas from `age`
 * until it turns non-positive (development room left before decline sets in). */
export function projectedCeiling(
  curves: CurvesFile,
  pos: Position,
  age: number,
  ovr: number,
): number {
  const curve = agingCurveFor(curves, pos)
  if (!curve) return ovr
  const keys = Object.keys(curve.byAge).map(Number)
  const maxKey = Math.max(...keys)
  let value = ovr
  for (let a = age; a <= maxKey; a++) {
    const d = curve.byAge[String(a)] ?? 0
    if (d <= 0) break
    value += d
  }
  return clampRating(value)
}
