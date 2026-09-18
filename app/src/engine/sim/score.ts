/**
 * Turning an expected margin into a football score (HANDOFF §6.3).
 *
 * margin ~ N(k·Δoverall + HFA, σ), total ~ N(45, 10) clipped, then both team scores are snapped onto
 * scores you can actually reach with touchdowns and field goals. Overtime follows the rules of the era.
 */
import type { Rng, Season } from '@contracts/index'
import { overtimeConstants, scoreConstants, simConstants } from './constants'
import { MAX_POINTS, scoreWeight } from './points'

export function isPlausibleScore(score: number): boolean {
  return Number.isInteger(score) && score >= 0 && score <= MAX_POINTS && scoreWeight(score) > 0
}

/** Pick the plausible score nearest `target`, weighted by a gaussian kernel. */
function snapScore(target: number, rng: Rng): number {
  const centre = Math.round(Math.max(0, target))
  const lo = Math.max(0, centre - scoreConstants.snapWindow)
  const hi = Math.min(MAX_POINTS, centre + scoreConstants.snapWindow)
  const twoSigmaSq = 2 * scoreConstants.snapSd * scoreConstants.snapSd
  const weights: number[] = []
  let sum = 0
  for (let s = lo; s <= hi; s++) {
    const d = s - target
    const w = scoreWeight(s) * Math.exp(-(d * d) / twoSigmaSq)
    weights.push(w)
    sum += w
  }
  if (sum <= 0) return Math.max(0, centre === 1 ? 0 : centre)
  let r = rng.next() * sum
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!
    if (r <= 0) return lo + i
  }
  return hi
}

export interface ScoreDraw {
  home: number
  away: number
  overtime: boolean
}

export function expectedMargin(homeOverall: number, awayOverall: number, neutralSite: boolean): number {
  return simConstants.k * (homeOverall - awayOverall) + (neutralSite ? 0 : simConstants.hfa)
}

function resolveOvertime(tied: number, mu: number, season: Season, rng: Rng): ScoreDraw {
  const { modifiedFrom, shortPeriodFrom, longPeriodTieMult, fgFirstP, bothScoreP, edgeDamp } = overtimeConstants
  const tieP = season >= shortPeriodFrom ? simConstants.tieP : simConstants.tieP * longPeriodTieMult
  if (rng.chance(tieP)) return { home: tied, away: tied, overtime: true }

  let home = tied
  let away = tied
  // Modified rules give the team that kicked off a possession of its own, so trading field goals happens.
  if (season >= modifiedFrom && rng.chance(bothScoreP)) {
    home += 3
    away += 3
  }
  const points = rng.chance(fgFirstP) ? 3 : 7
  if (rng.chance(1 / (1 + Math.exp((-mu * edgeDamp) / 4)))) home += points
  else away += points
  return { home, away, overtime: true }
}

export function drawScore(mu: number, season: Season, rng: Rng): ScoreDraw {
  const { marginSd, totalMean, totalSd } = simConstants
  const { totalMin, totalMax, otWindow, oneMarginFixP } = scoreConstants

  const margin = rng.normal(mu, marginSd)
  const total = Math.min(totalMax, Math.max(totalMin, rng.normal(totalMean, totalSd)))

  // A margin this small means nobody was ahead when the clock ran out.
  if (Math.abs(margin) < otWindow) return resolveOvertime(snapScore(total / 2, rng), mu, season, rng)

  let home = snapScore((total + margin) / 2, rng)
  let away = snapScore((total - margin) / 2, rng)

  const homeFavored = margin > 0
  if (home === away) {
    if (homeFavored) home += 3
    else away += 3
  } else if (home > away !== homeFavored) {
    const swap = home
    home = away
    away = swap
  }

  if (Math.abs(home - away) === 1 && rng.chance(oneMarginFixP)) {
    if (home > away) home += 2
    else away += 2
  }

  return { home, away, overtime: false }
}
