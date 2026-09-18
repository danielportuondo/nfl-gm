/**
 * Shared, truth-free helpers for player status badges (docs/HANDOFF.md Phase 5A brief items 3–4).
 * Pure functions only — never import state.truth here.
 */
import type { Injury, LeagueState, Player } from '@contracts/index'

/** Phases in which the class drafted this season (`rookieSeason === state.season`) is still "this year's rookies". */
const CURRENT_SEASON_ROOKIE_PHASES = new Set<LeagueState['phase']>(['PRESEASON', 'REGULAR', 'PLAYOFFS', 'OFFSEASON_RESIGN'])

/**
 * A player is a "rookie" for badge purposes against the season whose class is currently on the board:
 * from PRESEASON through OFFSEASON_RESIGN that's `state.season` (last season's draft class, still in
 * its first year); from DRAFT through TRAINING_CAMP the draft in progress is for `state.season + 1`.
 */
export function isRookie(player: Pick<Player, 'rookieSeason'>, state: Pick<LeagueState, 'season' | 'phase'>): boolean {
  const targetSeason = CURRENT_SEASON_ROOKIE_PHASES.has(state.phase) ? state.season : state.season + 1
  return player.rookieSeason === targetSeason
}

/** "Out 3 wk" for an injured roster slot; null when not injured. */
export function injuredWeeksLabel(injured: Injury | undefined): string | null {
  if (!injured) return null
  return `Out ${injured.weeksOut} wk`
}
