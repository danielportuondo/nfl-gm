/**
 * How football scores are built. Every point total is enumerated into the touchdown / field-goal /
 * two-point / safety combinations that could produce it, weighted by how ordinary the combination is.
 *
 * The same table does two jobs: it tells `score.ts` how plausible a final score is (24 is three
 * touchdowns and a field goal; 25 needs a touchdown and six field goals, so it is far rarer), and it
 * tells `boxScore.ts` which touchdowns and kicks to write into the box score.
 */
import type { Rng } from '@contracts/index'
import { pointsConstants as P } from './constants'

export const MAX_POINTS = 120

export interface Decomposition {
  td: number
  fg: number
  twoPt: number
  missedXp: number
  safety: number
}

interface PointEntry {
  list: Decomposition[]
  cum: number[]
  weight: number
}

const TABLE: PointEntry[] = (() => {
  const table: PointEntry[] = []
  for (let points = 0; points <= MAX_POINTS; points++) {
    const list: Decomposition[] = []
    const cum: number[] = []
    let running = 0
    for (let td = 0; td * 7 <= points + 4 && td <= 9; td++) {
      for (let twoPt = 0; twoPt <= Math.min(td, 2); twoPt++) {
        for (let missedXp = 0; missedXp <= Math.min(td - twoPt, 2); missedXp++) {
          for (let safety = 0; safety <= 2; safety++) {
            const rest = points - (7 * td + twoPt - missedXp + 2 * safety)
            if (rest < 0 || rest % 3 !== 0) continue
            const fg = rest / 3
            if (fg > P.maxFg) continue
            running +=
              Math.exp(-((td - points / P.pointsPerTd) ** 2) / (2 * P.tdSpread ** 2)) *
              Math.exp(-((fg - P.fgMean) ** 2) / (2 * P.fgSpread ** 2)) *
              Math.pow(P.twoPtWeight, twoPt) *
              Math.pow(P.missedXpWeight, missedXp) *
              Math.pow(P.safetyWeight, safety)
            list.push({ td, fg, twoPt, missedXp, safety })
            cum.push(running)
          }
        }
      }
    }
    table.push({ list, cum, weight: running })
  }
  const peak = Math.max(...table.map((e) => e.weight))
  for (const entry of table) entry.weight /= peak
  return table
})()

/** 0 for a score no football game reaches, ~1 for the ordinary ones. */
export function scoreWeight(points: number): number {
  return TABLE[points]?.weight ?? 0
}

export function pickDecomposition(points: number, rng: Rng): Decomposition {
  const entry = TABLE[Math.min(MAX_POINTS, Math.max(0, points))]
  if (!entry || entry.list.length === 0) return { td: 0, fg: 0, twoPt: 0, missedXp: 0, safety: 0 }
  const r = rng.next() * entry.cum[entry.cum.length - 1]!
  for (let i = 0; i < entry.cum.length; i++) if (r <= entry.cum[i]!) return entry.list[i]!
  return entry.list[entry.list.length - 1]!
}
