/**
 * engine/lifecycle — progression, aging, retirement, injuries, procedural generation (§6.7).
 * Owned by lifecycle (3D).
 */
import type { InjuryEvent, LeagueState, PlayerId, Prospect } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface GeneratedClass {
  prospects: Prospect[]
  /** Hidden trajectories for the generated players, to be merged into state.truth. */
  truth: LeagueState['truth']
  /** Prospect ids in consensus board order; the first `drafted` many are the draftable pool. */
  order: PlayerId[]
  draftedCount: number
}

export interface LifecycleModule {
  /**
   * At season rollover (called after `season` has been incremented): set every player's true value for
   * the new season. Real players inside real data → from trajectory (no smoothing, ever). Real players
   * beyond data and procedural players → prev + ageDelta(pos, age) + N(0, σ_pos) from curves, seeded.
   */
  progressSeason(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /**
   * Retirements after the season just completed. Real players: after their last real roster season
   * (truth.retiresAfter). Otherwise logistic in age and value from curves.retirement. Removes them from
   * rosters/freeAgents, returns the ids.
   */
  retirements(
    state: LeagueState,
    ctx: EngineContext,
    rng: Rng,
  ): { state: LeagueState; retired: PlayerId[] }

  /**
   * Recompute consensus at season start: veterans ovr = last completed season's true value, pot from
   * age/position curve + draft-pedigree bump, confidence up with seasons played; rookies keep their
   * pre-draft view. Also refreshes in-season after a completed season for the SeasonRecap.
   */
  refreshScouting(state: LeagueState, ctx: EngineContext): LeagueState

  /** Weekly: decrement weeksOut, clear healed injuries, apply small permanent loss after long injuries. */
  tickInjuries(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /** Apply new injury events from game results to roster slots. */
  applyInjuryEvents(state: LeagueState, events: InjuryEvent[]): LeagueState

  /**
   * Procedural class for a post-history season: size from curves.classSize, position mix from
   * curves.positionMix, consensus from the slot-grade distribution, hidden trajectory sampled from the
   * pick→outcome tables so steals and busts occur at realistic rates. Names from curves.names.
   */
  generateDraftClass(state: LeagueState, ctx: EngineContext, rng: Rng): GeneratedClass

  /** Age of a player in a season (season − birthYear). */
  age(state: LeagueState, playerId: PlayerId, season?: number): number

  /**
   * Before a season: a consensus starter whose real availability this season was very low (Luck 2017)
   * is announced injured for the share of the season he really missed, so depth charts skip him through
   * the normal injured path. Idempotent; a no-op for seasons without real availability.
   */
  applyHistoricalAbsences(state: LeagueState): LeagueState
}

export const lifecycleStub: LifecycleModule = {
  progressSeason: () => notImplemented('lifecycle.progressSeason'),
  retirements: () => notImplemented('lifecycle.retirements'),
  refreshScouting: () => notImplemented('lifecycle.refreshScouting'),
  tickInjuries: () => notImplemented('lifecycle.tickInjuries'),
  applyInjuryEvents: () => notImplemented('lifecycle.applyInjuryEvents'),
  generateDraftClass: () => notImplemented('lifecycle.generateDraftClass'),
  age: () => notImplemented('lifecycle.age'),
  applyHistoricalAbsences: () => notImplemented('lifecycle.applyHistoricalAbsences'),
}
