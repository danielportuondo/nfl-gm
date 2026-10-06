/**
 * History-anchored, need-aware AI selection (§6.4). CONSENSUS ONLY — nothing here reads state.truth
 * or ctx.trajectories, and the lint rules plus tests/engine/draft keep it that way.
 *
 *  1. The player the team really picked at this slot, if still on the board and the position is not
 *     saturated. Most picks stay historical, which is the whole "follow real history" feel.
 *     In a sim-order draft (`rescue`), a real draftee whose real slot has already passed — vetoed for
 *     saturation, or displaced — is "stranded": he goes ahead of the slot's own anchor once he is
 *     `strandedOverrideLead` picks overdue, and fills any slot whose own anchor is gone or vetoed.
 *  2. Otherwise best `consensus.pot × needWeight(pos) × ageAdj` with small seeded noise, over a window
 *     of the board so a desperate need can never reach down for a nobody.
 *  3. 10% of the time: pure best available, need ignored.
 */
import type { EngineContext, LeagueState, PlayerId, Rng, Season, TeamId } from '@contracts/index'
import { draftConstants, type DraftConstants } from './constants'
import { needProfile, needWeight } from './needs'

export interface PickContext {
  teamId: TeamId
  season: Season
  round: number
  available: readonly PlayerId[]
  /** Who really went here in real life, or null post-history / for an unmatched slot. */
  anchor: PlayerId | null
  /** Sim-order drafts in history only; the opening draft keeps the plain anchor rule. */
  rescue?: StrandedRescue
}

export interface StrandedRescue {
  /** Overall pick number of the slot being made. */
  pickNumber: number
  /** Every real draftee's real overall pick. */
  realPicks: ReadonlyMap<PlayerId, number>
  /** Slots in this draft (7 × 32); real comp picks past it have no slot of their own. */
  orderLength: number
}

/**
 * Real draftees still on the board whose real slot has passed, earliest real pick first. Real comp
 * picks numbered past the sim order (#225–256 against 224 slots) join in the final round, after
 * everyone genuinely overdue, so they compete for round-7 gaps instead of being dropped.
 */
function strandedAnchors(
  available: readonly PlayerId[],
  rescue: StrandedRescue,
  picksPerRound: number,
): PlayerId[] {
  const finalRound = rescue.pickNumber > rescue.orderLength - picksPerRound
  const realPick = (id: PlayerId): number => rescue.realPicks.get(id) ?? Infinity
  return available
    .filter((id) => {
      const rp = realPick(id)
      if (rp === Infinity) return false
      return rp < rescue.pickNumber || (finalRound && rp > rescue.orderLength)
    })
    .sort((a, b) => realPick(a) - realPick(b) || a.localeCompare(b))
}

/**
 * The soonest real draftee due within `window` picks who fits this team. Taking him leaves a gap at
 * his own slot, which the stranded anchor this pick could not use fills a few picks later; the
 * consensus fallback would push everyone after him a slot down instead.
 */
function upcomingAnchor(
  available: readonly PlayerId[],
  rescue: StrandedRescue,
  window: number,
  fits: (id: PlayerId) => boolean,
): PlayerId | undefined {
  let soonest: PlayerId | undefined
  let soonestPick = Infinity
  for (const id of available) {
    const rp = rescue.realPicks.get(id)
    if (rp === undefined || rp <= rescue.pickNumber || rp > rescue.pickNumber + window) continue
    if (rp < soonestPick && fits(id)) {
      soonest = id
      soonestPick = rp
    }
  }
  return soonest
}

function ageAdjustment(
  state: LeagueState,
  ctx: EngineContext,
  id: PlayerId,
  season: Season,
  c: DraftConstants,
): number {
  const age = ctx.modules.lifecycle.age(state, id, season)
  return Math.max(0.5, 1 - c.agePenalty * Math.max(0, age - c.ageBaseline))
}

export function chooseProspect(
  state: LeagueState,
  ctx: EngineContext,
  rng: Rng,
  pick: PickContext,
  c: DraftConstants = draftConstants,
): PlayerId {
  const best = pick.available[0]
  if (best === undefined) throw new Error('draft: no prospects available')

  const needs = needProfile(state, pick.teamId, c)
  const fits = (id: PlayerId): boolean => {
    const pos = state.players[id]?.pos
    if (pos === undefined) return false
    return !(pick.round <= c.anchorVetoMaxRound && needs.saturated.includes(pos))
  }
  const ownAnchor =
    pick.anchor !== null && pick.available.includes(pick.anchor) && fits(pick.anchor)
      ? pick.anchor
      : null

  if (pick.rescue) {
    const rescue = pick.rescue
    const stranded = strandedAnchors(pick.available, rescue, c.picksPerRound).filter(fits)
    const overdue = stranded.find(
      (id) => (rescue.realPicks.get(id) ?? Infinity) <= rescue.pickNumber - c.strandedOverrideLead,
    )
    if (overdue !== undefined) return overdue
    if (ownAnchor !== null) return ownAnchor
    if (stranded[0] !== undefined) return stranded[0]
    const pulled = upcomingAnchor(pick.available, rescue, c.pullForwardWindow, fits)
    if (pulled !== undefined) return pulled
  } else if (ownAnchor !== null) return ownAnchor

  if (rng.chance(c.bestAvailableChance)) return best

  let chosen = best
  let bestScore = -Infinity
  const window = pick.available.slice(0, c.candidateWindow)
  for (const id of window) {
    const player = state.players[id]
    const pot = state.scouting[id]?.pot
    if (!player || pot === undefined) continue
    const score =
      pot *
      needWeight(needs, player.pos, c) *
      ageAdjustment(state, ctx, id, pick.season, c) *
      (1 + rng.normal(0, c.noiseSd))
    if (score > bestScore) {
      bestScore = score
      chosen = id
    }
  }
  return chosen
}
