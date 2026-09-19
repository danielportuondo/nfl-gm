/**
 * History-anchored, need-aware AI selection (§6.4). CONSENSUS ONLY — nothing here reads state.truth
 * or ctx.trajectories, and the lint rules plus tests/engine/draft keep it that way.
 *
 *  1. The player the team really picked at this slot, if still on the board and the position is not
 *     saturated. Most picks stay historical, which is the whole "follow real history" feel.
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

  if (pick.anchor !== null && pick.available.includes(pick.anchor)) {
    const pos = state.players[pick.anchor]?.pos
    const vetoed =
      pos !== undefined && pick.round <= c.anchorVetoMaxRound && needs.saturated.includes(pos)
    if (pos !== undefined && !vetoed) return pick.anchor
  }

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
