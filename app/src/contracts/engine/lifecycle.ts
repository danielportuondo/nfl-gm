/**
 * engine/lifecycle — progression, aging, retirement, injuries, procedural generation (§6.7).
 * Owned by lifecycle (3D).
 */
import type { InjuryEvent, LeagueState, PlayerId, Prospect, Season } from '../types'
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
   * Recompute consensus for `forSeason` (default `state.season`): veterans ovr = a blend of the seasons
   * completed before it, pot from age/position curve + draft-pedigree bump, confidence up with seasons
   * played; rookies keep their pre-draft view. league.simWeek calls it once per year, when the Super Bowl
   * ends, with `forSeason = season + 1`, so the offseason and the Season Recap run on the new view.
   * Deterministic per (seed, forSeason, player), so a repeat call is a no-op.
   */
  refreshScouting(state: LeagueState, ctx: EngineContext, forSeason?: Season): LeagueState

  /**
   * True when a real player has no game left after `state.season` (truth.retiresAfter ≤ season): the
   * camp roll will retire him whatever his contract says. The only public face of that fact; the re-sign
   * screen reads it so the user is not offered a re-sign for a player with no future. Never true for
   * procedural players, whose end is still a draw.
   */
  leavesAfterSeason(state: LeagueState, playerId: PlayerId): boolean

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
   * Announce the real weeks every player missed in the season being prepared or played: `season + 1`
   * in the offseason phases, `season` from PRESEASON on. Writes `state.absences` (public) from the
   * season chunk, which lifecycle may read; a no-op, returning the same state, when the board already
   * covers that season or the season is past real data. Idempotent.
   */
  announceAbsences(state: LeagueState, ctx: EngineContext): LeagueState

  /**
   * Before a week is played: every rostered player whose announced absence covers `state.week` is
   * marked injured through the ordinary injury path, for exactly the weeks left in the range, so he
   * comes back when it ends. Applies to every team, starter or bench, and to players signed or
   * traded for mid-season. Never shortens an injury a player already has. Idempotent.
   */
  applyWeekAbsences(state: LeagueState): LeagueState
}

export const lifecycleStub: LifecycleModule = {
  progressSeason: () => notImplemented('lifecycle.progressSeason'),
  retirements: () => notImplemented('lifecycle.retirements'),
  refreshScouting: () => notImplemented('lifecycle.refreshScouting'),
  leavesAfterSeason: () => notImplemented('lifecycle.leavesAfterSeason'),
  tickInjuries: () => notImplemented('lifecycle.tickInjuries'),
  applyInjuryEvents: () => notImplemented('lifecycle.applyInjuryEvents'),
  generateDraftClass: () => notImplemented('lifecycle.generateDraftClass'),
  age: () => notImplemented('lifecycle.age'),
  announceAbsences: () => notImplemented('lifecycle.announceAbsences'),
  applyWeekAbsences: () => notImplemented('lifecycle.applyWeekAbsences'),
}
