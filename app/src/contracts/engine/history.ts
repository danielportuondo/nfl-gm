/**
 * engine/history — history anchoring & divergence tracking (§6.8). Owned by fa-cap (3C).
 */
import type { LeagueState, PlayerId, SnapEvent } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'

export interface HistoryModule {
  /**
   * At a new in-history season: for every player NOT in divergence and not on the user's team, place
   * them on their real team for that season (synthesized contract via fa.synthesizeContract using the
   * roster entry's apy/years hints). Diverged players stay put. Real players absent from all future
   * rosters are retired. Appends SnapEvents to state.snapLog. Requires ctx.seasonData(season).
   */
  snapToHistory(state: LeagueState, ctx: EngineContext): LeagueState

  /** Add ids to divergence (user-acquired/released/drafted, moved by user trades, displaced historical occupants). */
  markDiverged(state: LeagueState, playerIds: PlayerId[]): LeagueState

  /** Whether a player is still on the historical path. */
  isDiverged(state: LeagueState, playerId: PlayerId): boolean

  /** Snap events for a season, for the debug view and tests. */
  snapLog(state: LeagueState, season?: number): SnapEvent[]
}

export const historyStub: HistoryModule = {
  snapToHistory: () => notImplemented('history.snapToHistory'),
  markDiverged: () => notImplemented('history.markDiverged'),
  isDiverged: () => notImplemented('history.isDiverged'),
  snapLog: () => notImplemented('history.snapLog'),
}
