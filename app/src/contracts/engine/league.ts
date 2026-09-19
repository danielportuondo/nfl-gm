/**
 * engine/league — league state, season loop, standings, playoffs, schedule (§6.1, §6.3 playoffs).
 * Owned by league-engine (1C).
 *
 * The league module is the conductor: it owns phase transitions and calls the other modules through
 * `ctx.modules`. It never simulates a game itself (sim), never values a player (trade), never
 * synthesizes a contract (fa), never changes a rating (lifecycle), never snaps rosters (history).
 */
import type {
  DepthChart,
  Game,
  GameSettings,
  LeagueState,
  PlayoffBracket,
  PlayoffFormat,
  Season,
  SeasonSummary,
  StandingRow,
  TeamId,
  TeamStrength,
} from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'

export interface NewGameOptions {
  seed: string
  startSeason: Season
  userTeam: TeamId
  /** Number of seasons to win it all in (1–10). horizonEnd = startSeason + horizonSeasons − 1. */
  horizonSeasons: number
  settings: GameSettings
}

export interface WeekReport {
  state: LeagueState
  gamesPlayed: number
  /** Human-readable events for the UI toast/alerts stream (injuries, AI trades, clinches). */
  events: string[]
}

export interface LeagueModule {
  /**
   * Build the initial LeagueState for `startSeason`: players + consensus + truth from the season
   * chunk and trajectories, real opening-day rosters with synthesized contracts (via fa), real pick
   * ownership for the next 2 drafts (draft.buildDraftOrder for startSeason+1 and +2 — see the draft-year
   * convention in engine/draft.ts), real schedule, phase PRESEASON. Players with no opening-day team
   * start in freeAgents. Requires ctx.seasonData for startSeason and for +1/+2 while in history.
   */
  newGame(opts: NewGameOptions, ctx: EngineContext): LeagueState

  /**
   * Simulate the current week (REGULAR or PLAYOFFS) for every scheduled game, apply results to
   * records, apply injuries, tick injuries (lifecycle), generate AI-initiated trade offers (trade),
   * then advance `week`. When the regular season ends, seeds playoffs; when the Super Bowl is played,
   * writes a SeasonSummary and moves to OFFSEASON_RESIGN. Sets `outcome` when the user wins the
   * Super Bowl or the horizon expires. No-op with a warning event if phase is not REGULAR/PLAYOFFS.
   */
  simWeek(state: LeagueState, ctx: EngineContext): WeekReport

  /**
   * Move to the next phase in PHASES order, running the AI side of the phase being left:
   *  OFFSEASON_RESIGN → fa.runAiResign; DRAFT → requires draftRoom.status === 'COMPLETE';
   *  UDFA → draft.runUdfa for AI teams; FREE_AGENCY → fa.runAiFreeAgency;
   *  TRAINING_CAMP → season += 1, lifecycle.progressSeason + retirements + refreshScouting,
   *  history.snapToHistory (if in history), schedule for the new season, phase PRESEASON;
   *  PRESEASON → fa.runAiCutdowns, auto depth charts for AI teams, validate rosters
   *  (fa.validateRoster for all 32), phase REGULAR week 1.
   * Throws if the user's roster/cap is invalid for the transition (message lists the problems).
   */
  advancePhase(state: LeagueState, ctx: EngineContext): LeagueState

  /** Current standings with division/conference ranks and clinch flags. Pure. */
  standings(state: LeagueState, ctx: EngineContext): StandingRow[]

  /** Era-correct format for a season (12 teams/2 byes through 2019; 14/1 from 2020; 16/17 games). */
  playoffFormat(season: Season): PlayoffFormat

  /** Seed the bracket from standings. Tiebreak: record → head-to-head → point differential. */
  seedPlayoffs(state: LeagueState, ctx: EngineContext): PlayoffBracket

  /**
   * Schedule for `state.season`: the real schedule from the season chunk when in history (team codes
   * canonicalized), otherwise a generated 17-game schedule with divisional home/away, one bye per
   * team, and rotating cross-division opponents. Deterministic from seed.
   */
  buildSchedule(state: LeagueState, ctx: EngineContext): Game[]

  /** Best-available depth chart by consensus ovr per STARTER_TEMPLATE; healthy players first. */
  autoDepthChart(state: LeagueState, teamId: TeamId): DepthChart

  /** Convenience passthrough to sim.teamStrength for the store/UI. */
  teamStrength(state: LeagueState, teamId: TeamId, ctx: EngineContext): TeamStrength

  /** Summary for a completed season (used by simWeek at Super Bowl; exposed for tests). */
  summarizeSeason(state: LeagueState, ctx: EngineContext): SeasonSummary
}

export const leagueStub: LeagueModule = {
  newGame: () => notImplemented('league.newGame'),
  simWeek: () => notImplemented('league.simWeek'),
  advancePhase: () => notImplemented('league.advancePhase'),
  standings: () => notImplemented('league.standings'),
  playoffFormat: () => notImplemented('league.playoffFormat'),
  seedPlayoffs: () => notImplemented('league.seedPlayoffs'),
  buildSchedule: () => notImplemented('league.buildSchedule'),
  autoDepthChart: () => notImplemented('league.autoDepthChart'),
  teamStrength: () => notImplemented('league.teamStrength'),
  summarizeSeason: () => notImplemented('league.summarizeSeason'),
}
