# Engine contract

**Generated** from `app/src/contracts/` by `pnpm gen:contracts`. Do not edit by hand; edit the source
and regenerate. `tests/contracts.test.ts` fails when this file is stale.

Every engine module is a plain object of pure functions over `LeagueState` (input never mutated).
Cross-module calls go through `EngineContext.modules`. Randomness only through `engine/rng`, seeded from
`LeagueState.seed` + scope. Nothing under `app/src/screens` or `app/src/ui` reads `LeagueState.truth`.
Ownership per module is in the header comment of each file; see `docs/HANDOFF.md` §3 and §7.

- [`types.ts`](#appsrccontractstypests)
- [`teams.ts`](#appsrccontractsteamsts)
- [`data.ts`](#appsrccontractsdatats)
- [`engine/context.ts`](#appsrccontractsenginecontextts)
- [`engine/rng.ts`](#appsrccontractsenginerngts)
- [`engine/league.ts`](#appsrccontractsengineleaguets)
- [`engine/sim.ts`](#appsrccontractsenginesimts)
- [`engine/draft.ts`](#appsrccontractsenginedraftts)
- [`engine/trade.ts`](#appsrccontractsenginetradets)
- [`engine/fa.ts`](#appsrccontractsenginefats)
- [`engine/lifecycle.ts`](#appsrccontractsenginelifecyclets)
- [`engine/history.ts`](#appsrccontractsenginehistoryts)
- [`engine/persistence.ts`](#appsrccontractsenginepersistencets)

## `app/src/contracts/types.ts`

```ts
/**
 * Gridiron GM — core domain types (docs/HANDOFF.md §6.1). ORCHESTRATOR-OWNED.
 *
 * Most types are inferred from the zod schemas in ./schemas.ts so the save file, the data files and
 * the in-memory model can never drift. Only in-memory-specific types (Set-based LeagueState, derived
 * views) are declared here directly.
 */
import type { z } from 'zod'
import type {
  AgingCurveSchema,
  AwardIdSchema,
  AwardSchema,
  BoxScoreSchema,
  CapFileSchema,
  CompactTrajectorySchema,
  ContractSchema,
  CurvesFileSchema,
  DepthChartSchema,
  DraftLogEntrySchema,
  DraftOrderEntrySchema,
  DraftOriginSchema,
  DraftPickSchema,
  DraftRoomStateSchema,
  GameOutcomeSchema,
  GameResultSchema,
  GameSchema,
  GameSettingsSchema,
  GameTypeSchema,
  InjuryEventSchema,
  InjuryModelFileSchema,
  InjurySchema,
  ManifestSchema,
  OutcomeTableSchema,
  PhaseSchema,
  PickRefSchema,
  PlayerGameLineSchema,
  PlayerSchema,
  PlayoffBracketSchema,
  PlayoffExitSchema,
  PlayoffFormatSchema,
  PlayoffSeedSchema,
  PositionSchema,
  ProspectSchema,
  RetirementCurveSchema,
  RosterEntrySchema,
  RosterSlotSchema,
  SavedLeagueSchema,
  ScheduledGameSchema,
  ScoutingViewSchema,
  SeasonDraftFileSchema,
  SeasonPlayerSchema,
  SeasonPlayersFileSchema,
  SeasonRostersFileSchema,
  SeasonScheduleFileSchema,
  SeasonSummarySchema,
  SlotGradePointSchema,
  SnapEventSchema,
  StandingRowSchema,
  TeamInfoSchema,
  TeamRecordSchema,
  TeamStateSchema,
  TeamsFileSchema,
  TradeProposalSchema,
  TradeSideSchema,
  TrajectoriesFileSchema,
  TrueTrajectorySchema,
} from './schemas'

export { POSITIONS, PHASES } from './schemas'

// --- identifiers ------------------------------------------------------------------------------
export type Season = number
export type Week = number
export type TeamId = string
export type PlayerId = string
export type GameId = string
export type Position = z.infer<typeof PositionSchema>
export type Conference = 'AFC' | 'NFC'
export type Division = 'East' | 'North' | 'South' | 'West'

// --- domain objects ---------------------------------------------------------------------------
export type DraftOrigin = z.infer<typeof DraftOriginSchema>
export type Player = z.infer<typeof PlayerSchema>
/** What the world believes about a player right now. The only rating the UI may show. */
export type ScoutingView = z.infer<typeof ScoutingViewSchema>
/** The hidden truth. Used by sim + progression only. Never rendered. */
export type TrueTrajectory = z.infer<typeof TrueTrajectorySchema>
export type Contract = z.infer<typeof ContractSchema>
export type Injury = z.infer<typeof InjurySchema>
export type RosterSlot = z.infer<typeof RosterSlotSchema>
export type TeamRecord = z.infer<typeof TeamRecordSchema>
export type DepthChart = z.infer<typeof DepthChartSchema>
export type TeamState = z.infer<typeof TeamStateSchema>
export type DraftPick = z.infer<typeof DraftPickSchema>
export type GameType = z.infer<typeof GameTypeSchema>
export type Game = z.infer<typeof GameSchema>
export type PlayerGameLine = z.infer<typeof PlayerGameLineSchema>
export type BoxScore = z.infer<typeof BoxScoreSchema>
export type InjuryEvent = z.infer<typeof InjuryEventSchema>
export type GameResult = z.infer<typeof GameResultSchema>
export type StandingRow = z.infer<typeof StandingRowSchema>
export type PlayoffFormat = z.infer<typeof PlayoffFormatSchema>
export type PlayoffSeed = z.infer<typeof PlayoffSeedSchema>
export type PlayoffBracket = z.infer<typeof PlayoffBracketSchema>
export type PlayoffExit = z.infer<typeof PlayoffExitSchema>
export type AwardId = z.infer<typeof AwardIdSchema>
export type Award = z.infer<typeof AwardSchema>
export type SeasonSummary = z.infer<typeof SeasonSummarySchema>
export type Phase = z.infer<typeof PhaseSchema>
export type GameSettings = z.infer<typeof GameSettingsSchema>
export type GameOutcome = z.infer<typeof GameOutcomeSchema>
export type PickRef = z.infer<typeof PickRefSchema>
export type TradeSide = z.infer<typeof TradeSideSchema>
export type TradeProposal = z.infer<typeof TradeProposalSchema>
export type DraftLogEntry = z.infer<typeof DraftLogEntrySchema>
export type DraftRoomState = z.infer<typeof DraftRoomStateSchema>
export type SnapEvent = z.infer<typeof SnapEventSchema>

// --- league state -----------------------------------------------------------------------------
/** Serialized form (IndexedDB / export). `divergence` is an array here. */
export type SavedLeague = z.infer<typeof SavedLeagueSchema>

/**
 * In-memory league state. Identical to SavedLeague except `divergence` is a Set.
 * `truth` is present in state; nothing under app/src/screens or app/src/ui may read it (lint + test).
 */
export type LeagueState = Omit<SavedLeague, 'divergence'> & { divergence: Set<PlayerId> }

export function toSaved(state: LeagueState): SavedLeague {
  return { ...state, divergence: [...state.divergence].sort(), savedAt: new Date().toISOString() }
}

export function fromSaved(saved: SavedLeague): LeagueState {
  return { ...saved, divergence: new Set(saved.divergence) }
}

// --- static data files ------------------------------------------------------------------------
export type TeamInfo = z.infer<typeof TeamInfoSchema>
export type TeamsFile = z.infer<typeof TeamsFileSchema>
export type CapFile = z.infer<typeof CapFileSchema>
export type AgingCurve = z.infer<typeof AgingCurveSchema>
export type SlotGradePoint = z.infer<typeof SlotGradePointSchema>
export type OutcomeTable = z.infer<typeof OutcomeTableSchema>
export type RetirementCurve = z.infer<typeof RetirementCurveSchema>
export type CurvesFile = z.infer<typeof CurvesFileSchema>
export type InjuryModelFile = z.infer<typeof InjuryModelFileSchema>
export type Manifest = z.infer<typeof ManifestSchema>

/** Everything loaded once per app session. */
export interface StaticData {
  manifest: Manifest
  teams: Record<TeamId, TeamInfo>
  cap: CapFile
  curves: CurvesFile
  injuryModel: InjuryModelFile
}

// --- per-season chunks ------------------------------------------------------------------------
export type SeasonPlayer = z.infer<typeof SeasonPlayerSchema>
export type SeasonPlayersFile = z.infer<typeof SeasonPlayersFileSchema>
export type RosterEntry = z.infer<typeof RosterEntrySchema>
export type SeasonRostersFile = z.infer<typeof SeasonRostersFileSchema>
export type DraftOrderEntry = z.infer<typeof DraftOrderEntrySchema>
export type Prospect = z.infer<typeof ProspectSchema>
export type SeasonDraftFile = z.infer<typeof SeasonDraftFileSchema>
export type ScheduledGame = z.infer<typeof ScheduledGameSchema>
export type SeasonScheduleFile = z.infer<typeof SeasonScheduleFileSchema>

/** One real season's chunk, loaded before the engine enters that season. */
export interface SeasonData {
  players: SeasonPlayersFile
  rosters: SeasonRostersFile
  draft: SeasonDraftFile
  schedule: SeasonScheduleFile
}

export type CompactTrajectory = z.infer<typeof CompactTrajectorySchema>
export type TrajectoriesFile = z.infer<typeof TrajectoriesFileSchema>
export type TrajectoryTable = TrajectoriesFile['byPlayer']

// --- derived views (engine outputs) -----------------------------------------------------------
export interface TeamStrength {
  off: number
  def: number
  st: number
  overall: number
}

/** Positional need. Higher = bigger hole. `top` lists the 2–3 neediest positions. */
export interface NeedProfile {
  byPos: Record<Position, number>
  top: Position[]
  saturated: Position[]
}

export interface TradeEvaluation {
  valueIn: number
  valueOut: number
  needAdj: number
  margin: number
  /** Acceptance probability shown as the bar. 0 when `valid` is false. */
  p: number
  valid: boolean
  reasons: string[]
}

export interface RosterValidation {
  ok: boolean
  size: number
  payroll: number
  capSpace: number
  errors: string[]
}

/** One suggested release from fa.suggestCutdown. Money is $M, this season. */
export interface CutdownSuggestion {
  playerId: PlayerId
  /** Why the player is on the list: to reach the roster limit, or to get under the cap. */
  reason: 'size' | 'cap'
  /** Dead money charged this season if released. */
  deadMoney: number
  /** APY freed minus the dead-money charge; negative for heavily guaranteed deals. */
  netSavings: number
}

/** fa.suggestCutdown result: the cuts in order, and where the roster stands once all are made. */
export interface CutdownPlan {
  cuts: CutdownSuggestion[]
  sizeAfter: number
  payrollAfter: number
  capSpaceAfter: number
  /** True when the cuts alone make the roster legal: at or under the limit and under the cap. */
  ok: boolean
}
```

## `app/src/contracts/teams.ts`

```ts
/**
 * Canonical franchise identities. ORCHESTRATOR-OWNED.
 *
 * A TeamId is the franchise's CURRENT nflverse abbreviation and is stable across relocations and
 * renames. The pipeline maps every historical code to the canonical id via TEAM_ALIASES; the UI shows
 * the era-appropriate city/name from TeamInfo.eras.
 */
import type { Conference, Division, TeamId } from './types'

export const TEAM_IDS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LAR',
  'LAC',
  'LV',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
] as const satisfies readonly TeamId[]

export type CanonicalTeamId = (typeof TEAM_IDS)[number]

/**
 * Historical nflverse codes → canonical id. Codes not listed map to themselves. nflverse spells teams
 * three ways across its own releases (relocation codes, alternate roster codes such as ARZ/BLT/CLV/HST,
 * and PFR-style codes in draft_picks such as GNB/KAN/NWE); pipeline/.../build/teams.py mirrors this table.
 */
export const TEAM_ALIASES: Record<string, CanonicalTeamId> = {
  STL: 'LAR',
  LA: 'LAR',
  LAR: 'LAR',
  SL: 'LAR',
  RAM: 'LAR',
  SD: 'LAC',
  LAC: 'LAC',
  SDG: 'LAC',
  OAK: 'LV',
  LV: 'LV',
  LVR: 'LV',
  RAI: 'LV',
  WSH: 'WAS',
  WAS: 'WAS',
  JAC: 'JAX',
  JAX: 'JAX',
  ARZ: 'ARI',
  PHO: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
  GNB: 'GB',
  KAN: 'KC',
  NOR: 'NO',
  NWE: 'NE',
  SFO: 'SF',
  TAM: 'TB',
}

export function canonicalTeamId(code: string): CanonicalTeamId {
  const upper = code.toUpperCase()
  const mapped = TEAM_ALIASES[upper] ?? upper
  if (!(TEAM_IDS as readonly string[]).includes(mapped))
    throw new Error(`Unknown team code: ${code}`)
  return mapped as CanonicalTeamId
}

export const DIVISIONS: Record<CanonicalTeamId, { conf: Conference; div: Division }> = {
  BUF: { conf: 'AFC', div: 'East' },
  MIA: { conf: 'AFC', div: 'East' },
  NE: { conf: 'AFC', div: 'East' },
  NYJ: { conf: 'AFC', div: 'East' },
  BAL: { conf: 'AFC', div: 'North' },
  CIN: { conf: 'AFC', div: 'North' },
  CLE: { conf: 'AFC', div: 'North' },
  PIT: { conf: 'AFC', div: 'North' },
  HOU: { conf: 'AFC', div: 'South' },
  IND: { conf: 'AFC', div: 'South' },
  JAX: { conf: 'AFC', div: 'South' },
  TEN: { conf: 'AFC', div: 'South' },
  DEN: { conf: 'AFC', div: 'West' },
  KC: { conf: 'AFC', div: 'West' },
  LV: { conf: 'AFC', div: 'West' },
  LAC: { conf: 'AFC', div: 'West' },
  DAL: { conf: 'NFC', div: 'East' },
  NYG: { conf: 'NFC', div: 'East' },
  PHI: { conf: 'NFC', div: 'East' },
  WAS: { conf: 'NFC', div: 'East' },
  CHI: { conf: 'NFC', div: 'North' },
  DET: { conf: 'NFC', div: 'North' },
  GB: { conf: 'NFC', div: 'North' },
  MIN: { conf: 'NFC', div: 'North' },
  ATL: { conf: 'NFC', div: 'South' },
  CAR: { conf: 'NFC', div: 'South' },
  NO: { conf: 'NFC', div: 'South' },
  TB: { conf: 'NFC', div: 'South' },
  ARI: { conf: 'NFC', div: 'West' },
  LAR: { conf: 'NFC', div: 'West' },
  SF: { conf: 'NFC', div: 'West' },
  SEA: { conf: 'NFC', div: 'West' },
}

/** Era-correct league structure (docs/HANDOFF.md §4). */
export function leagueFormat(season: number): {
  regularSeasonGames: 16 | 17
  playoffTeams: 12 | 14
  byesPerConf: 1 | 2
} {
  return {
    regularSeasonGames: season >= 2021 ? 17 : 16,
    playoffTeams: season >= 2020 ? 14 : 12,
    byesPerConf: season >= 2020 ? 1 : 2,
  }
}

/** Positional roster template used for need computation and depth charts (starters). */
export const STARTER_TEMPLATE: Record<string, number> = {
  QB: 1,
  RB: 1,
  WR: 3,
  TE: 1,
  OL: 5,
  DL: 4,
  LB: 3,
  CB: 3,
  S: 2,
  K: 1,
  P: 1,
}

/** Typical 53-man distribution used by the mock fixture and procedural class sizing. */
export const ROSTER_TEMPLATE_53: Record<string, number> = {
  QB: 3,
  RB: 4,
  WR: 6,
  TE: 3,
  OL: 9,
  DL: 9,
  LB: 7,
  CB: 6,
  S: 4,
  K: 1,
  P: 1,
}
```

## `app/src/contracts/data.ts`

```ts
/**
 * Data-layer contract: loaders for app/public/data chunks (§6.10). Owned by league-engine (1C, app/src/data).
 *
 * Every loader validates against the zod schema in ./schemas.ts (dev builds always; prod builds may
 * skip validation for speed behind a flag). Loaders cache by URL. Base URL comes from import.meta.env.BASE_URL.
 */
import type { Manifest, Season, SeasonData, StaticData, TrajectoryTable } from './types'

export interface DataSource {
  loadManifest(): Promise<Manifest>
  loadStatic(): Promise<StaticData>
  loadSeason(season: Season): Promise<SeasonData>
  /** The hidden truth. Only the engine context should hold the result; never hand it to the UI layer. */
  loadTrajectories(): Promise<TrajectoryTable>
  /** Drop caches (tests). */
  clear(): void
}

/** A DataSource over an in-memory bundle, used by tests and the headless harness. */
export interface MemoryBundle {
  static: StaticData
  seasons: Record<Season, SeasonData>
  trajectories: TrajectoryTable
}
```

## `app/src/contracts/engine/context.ts`

```ts
/**
 * Shared engine plumbing. ORCHESTRATOR-OWNED.
 *
 * Every engine module is a plain object of pure functions that take `LeagueState` and return a new
 * `LeagueState` (never mutate the input). Cross-module calls go through `ctx.modules` so modules can
 * be developed and tested against stubs, and so there are no import cycles between engine folders.
 */
import type { Season, SeasonData, StaticData, TrajectoryTable } from '../types'
import type { DraftModule } from './draft'
import type { FaModule } from './fa'
import type { HistoryModule } from './history'
import type { LeagueModule } from './league'
import type { LifecycleModule } from './lifecycle'
import type { RngModule } from './rng'
import type { SimModule } from './sim'
import type { TradeModule } from './trade'

export interface EngineModules {
  rng: RngModule
  league: LeagueModule
  sim: SimModule
  draft: DraftModule
  trade: TradeModule
  fa: FaModule
  lifecycle: LifecycleModule
  history: HistoryModule
}

export interface EngineContext {
  data: StaticData
  /** The hidden truth for every real player. Only engine code may read it. */
  trajectories: TrajectoryTable
  /**
   * Real-season chunks already loaded by the data layer. Returns undefined when the season is past
   * `data.manifest.latestRealSeason` (procedural era). For an in-history season that is simply not
   * loaded yet, implementations must throw SeasonNotLoadedError — never silently go procedural.
   */
  seasonData: (season: Season) => SeasonData | undefined
  modules: EngineModules
}

export function isInHistory(ctx: EngineContext, season: Season): boolean {
  return season <= ctx.data.manifest.latestRealSeason
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`)
    this.name = 'NotImplementedError'
  }
}

export class SeasonNotLoadedError extends Error {
  constructor(season: Season) {
    super(`season ${season} is in history but its data chunk is not loaded`)
    this.name = 'SeasonNotLoadedError'
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what)
}
```

## `app/src/contracts/engine/rng.ts`

```ts
/**
 * engine/rng — seeded PRNG (docs/HANDOFF.md §6.3 "Determinism"). Owned by league-engine (1C).
 *
 * ALL randomness in the engine flows through an Rng derived from `LeagueState.seed` plus a scope
 * (season, week, gameId, "draft", pick number…). Same seed + same inputs ⇒ identical league.
 * Math.random is forbidden under app/src/engine (lint).
 */
import { notImplemented } from './context'

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number
  /** Gaussian sample. */
  normal(mean: number, sd: number): number
  /** True with probability p. */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  /** Returns a new shuffled array; does not mutate. */
  shuffle<T>(items: readonly T[]): T[]
  /** Deterministic child stream, independent of how many draws the parent has made. */
  fork(label: string | number): Rng
}

export interface RngModule {
  /** Build an Rng from the league seed and a scope, e.g. fromSeed(seed, 2015, 3, gameId). */
  fromSeed(seed: string, ...scope: (string | number)[]): Rng
  /** Stable 32-bit string hash (used for per-player deterministic noise, e.g. consensus jitter). */
  hash(input: string): number
}

export const rngStub: RngModule = {
  fromSeed: () => notImplemented('rng.fromSeed'),
  hash: () => notImplemented('rng.hash'),
}
```

## `app/src/contracts/engine/league.ts`

```ts
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
```

## `app/src/contracts/engine/sim.ts`

```ts
/**
 * engine/sim — game simulation + box scores (§6.3). Owned by sim-engine (1D).
 *
 * Pure per-game functions. The league module applies results to state. Sim reads `state.truth`
 * (current-season true values) for strength — that is the point of the hindsight model: games are
 * decided by who players really are, not by what scouts think.
 */
import type { Game, GameResult, LeagueState, TeamId, TeamStrength } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface SimConstants {
  /** Points of expected margin per point of overall-rating difference. Calibrated so sd(wins) ≈ 3.0 over 17 games. */
  k: number
  /** Home-field advantage in points (≈2.0). */
  hfa: number
  /** σ of the game margin (≈13.5). */
  marginSd: number
  /** Mean and σ of total points (≈45, 10). */
  totalMean: number
  totalSd: number
  /** Probability a game inside the OT window ends tied (era-dependent, small). */
  tieP: number
  offenseWeights: { QB: number; OL: number; WRTE: number; RB: number }
  defenseWeights: { DL: number; LB: number; CB: number; S: number }
  stWeight: number
  /** How much bench quality matters (0–1). */
  benchFactor: number
}

export interface SimModule {
  /** Tunable constants; qa-balance (Phase 5) may edit the values file, not the shape. */
  constants: SimConstants

  /**
   * Strength from the team's depth chart using TRUE current-season values (state.truth[id].bySeason[season]),
   * excluding injured players; falls back to league.autoDepthChart when the chart is missing slots.
   * offense: QB ~0.35, OL(5) ~0.25, WR/TE ~0.25, RB ~0.15; defense: DL/LB/CB/S ~equal with edge for
   * pass rush and CB; special teams small. Returns 40–99-scale numbers.
   */
  teamStrength(state: LeagueState, teamId: TeamId, ctx: EngineContext): TeamStrength

  /**
   * Simulate one game. margin ~ N(k·(home − away) + HFA, σ); total ~ N(45, 10) clipped; scores snapped
   * to realistic football scores; OT/ties per era. Box score allocated by usage weights. Injury events
   * sampled from ctx.data.injuryModel when settings.injuries. All randomness from `rng`.
   */
  simulateGame(state: LeagueState, game: Game, ctx: EngineContext, rng: Rng): GameResult

  /** Rng scope convention so league and calibration agree: rng.fromSeed(seed, season, week, game.id). */
  gameRng(state: LeagueState, game: Game, ctx: EngineContext): Rng
}

export const simStub: SimModule = {
  constants: {
    k: 0.9,
    hfa: 2.0,
    marginSd: 13.5,
    totalMean: 45,
    totalSd: 10,
    tieP: 0.003,
    offenseWeights: { QB: 0.35, OL: 0.25, WRTE: 0.25, RB: 0.15 },
    defenseWeights: { DL: 0.3, LB: 0.2, CB: 0.3, S: 0.2 },
    stWeight: 0.05,
    benchFactor: 0.15,
  },
  teamStrength: () => notImplemented('sim.teamStrength'),
  simulateGame: () => notImplemented('sim.simulateGame'),
  gameRng: () => notImplemented('sim.gameRng'),
}
```

## `app/src/contracts/engine/draft.ts`

```ts
/**
 * engine/draft — draft order, AI picking, draft-room state machine, UDFA (§6.4). Owned by draft-ai (3A).
 *
 * The AI NEVER reads `state.truth`. It ranks by `state.scouting[id].pot` and need. Enforced by lint.
 *
 * Draft-year convention: the draft held in season S's DRAFT phase (before TRAINING_CAMP increments the
 * season) is the S+1 class. `DraftPick.season`, `draftRoom.season` and the chunk read by loadProspects /
 * buildDraftOrder are all S+1; `league.newGame(S)` owns picks for S+1 and S+2 (the next two drafts).
 */
import type {
  DraftPick,
  DraftRoomState,
  LeagueState,
  NeedProfile,
  PlayerId,
  Season,
  TeamId,
  TradeProposal,
} from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface DraftModule {
  /**
   * Picks for `season`: in history, the real order from the season chunk (comp/traded picks as they
   * happened), with owner overridden by in-game trades already recorded in state.picks. Post-history:
   * reverse standings with playoff ordering, 7 rounds × 32, no comp picks.
   */
  buildDraftOrder(state: LeagueState, season: Season, ctx: EngineContext): DraftPick[]

  /**
   * Add the season's prospects to state.players/scouting (and truth from trajectories when real),
   * returning the new state. In history: real class + real UDFAs from the chunk. Post-history:
   * lifecycle.generateDraftClass.
   */
  loadProspects(state: LeagueState, ctx: EngineContext): LeagueState

  /** Enter DRAFT phase: state.draftRoom = ON_CLOCK at pick index 0, board sorted by consensus pot. */
  startDraft(state: LeagueState, ctx: EngineContext): LeagueState

  /**
   * AI selection for the team on the clock:
   *  1. If the historical pick at this slot is available and the team is not saturated there, take them.
   *  2. Else best of `pot × needWeight(pos) × ageAdj` + small seeded noise; 10% of the time ignore need.
   */
  aiPick(state: LeagueState, ctx: EngineContext, rng: Rng): PlayerId

  /**
   * User selection while on the clock. Throws if not the user's pick or player unavailable. Needs ctx for
   * the rookie contract (fa.rookieContract) and the divergence mark (history.markDiverged).
   */
  userPick(state: LeagueState, playerId: PlayerId, ctx: EngineContext): LeagueState

  /**
   * Resolve the current pick (AI: aiPick; user: must have picked or auto-picks best available when
   * `auto`), log it, advance to the next pick; when the user comes on the clock, populate
   * draftRoom.pendingOffers via trade.generateAiOffers(…, 'draft'). Runs consecutive AI picks until
   * the user is on the clock or the draft is COMPLETE. Returns the new state.
   */
  advance(state: LeagueState, ctx: EngineContext, opts?: { auto?: boolean }): LeagueState

  /** Sim the rest of the draft with the user auto-picking; convenience for headless/tests. */
  autoDraftToEnd(state: LeagueState, ctx: EngineContext): LeagueState

  /**
   * UDFA phase: user signings applied first (up to 90 roster), then AI teams sign from the pool using
   * the same anchored logic (real UDFA team when known). Clears draftRoom, moves unsigned to freeAgents.
   */
  runUdfa(state: LeagueState, ctx: EngineContext, userSignings: PlayerId[]): LeagueState

  /** Need profile vs STARTER_TEMPLATE and starter quality. Uses consensus only. */
  teamNeeds(state: LeagueState, teamId: TeamId): NeedProfile

  /** Offers targeted at the user's current pick; convenience over trade.generateAiOffers. */
  offersForCurrentPick(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[]

  /** Read-only view of the room for the UI. */
  room(state: LeagueState): DraftRoomState | null
}

export const draftStub: DraftModule = {
  buildDraftOrder: () => notImplemented('draft.buildDraftOrder'),
  loadProspects: () => notImplemented('draft.loadProspects'),
  startDraft: () => notImplemented('draft.startDraft'),
  aiPick: () => notImplemented('draft.aiPick'),
  userPick: () => notImplemented('draft.userPick'),
  advance: () => notImplemented('draft.advance'),
  autoDraftToEnd: () => notImplemented('draft.autoDraftToEnd'),
  runUdfa: () => notImplemented('draft.runUdfa'),
  teamNeeds: () => notImplemented('draft.teamNeeds'),
  offersForCurrentPick: () => notImplemented('draft.offersForCurrentPick'),
  room: () => notImplemented('draft.room'),
}
```

## `app/src/contracts/engine/trade.ts`

```ts
/**
 * engine/trade — valuation, acceptance, AI offers (§6.5). Owned by trade-ai (3B).
 *
 * Values are computed from CONSENSUS (scouting) only. The AI never reads truth.
 */
import type { LeagueState, PickRef, PlayerId, TradeEvaluation, TradeProposal } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface TradeConstants {
  /** Margin as a fraction of valueOut per strictness (lenient −0.03, balanced 0.05, strict 0.15, ruthless 0.30). */
  marginByStrictness: Record<'lenient' | 'balanced' | 'strict' | 'ruthless', number>
  /** Sigmoid scale on (valueIn − valueOut − needAdj − margin). */
  scale: number
  /** Future-pick discount per year (0.85). */
  futurePickDiscount: number
  /** Max first-round picks the AI gives up in one deal (2). */
  maxFirstsPerDeal: number
  /** Annoyance added per declined lowball and its effect on margin. */
  annoyancePerLowball: number
  annoyanceMarginPerPoint: number
}

export interface TradeOutcome {
  accepted: boolean
  evaluation: TradeEvaluation
  /** When declined, the AI may ask for one more asset from the user's side. */
  counter: TradeProposal | null
  state: LeagueState
}

export interface TradeModule {
  constants: TradeConstants

  /** f(consensus.ovr, pot, age, pos, contract): steep above 80 ovr, youth+pot premium, age and cost discounts. */
  playerValue(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** Pick chart (Rich Hill–style exponential decay) × 0.85^yearsOut × owner-strength adjustment. */
  pickValue(state: LeagueState, pick: PickRef, ctx: EngineContext): number

  /**
   * Evaluate from the counterparty's (request.teamId) perspective. Hard gates → valid=false, p=0:
   * cap after trade, roster size 46–53 (offseason ≤90), >2 firsts, unknown assets. needAdj rewards
   * filling top-2 needs and penalizes saturated positions. Injured incoming players discounted.
   * Re-values players whose consensus dropped sharply this season. Pure.
   */
  evaluate(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): TradeEvaluation

  /**
   * Roll against p. Accepted → execute. Declined → raise counterparty tradeAnnoyance and maybe counter.
   * AI-initiated proposals are always accepted by the AI (the bar shows fairness).
   */
  submit(state: LeagueState, proposal: TradeProposal, ctx: EngineContext, rng: Rng): TradeOutcome

  /** Move players and picks; mark all involved players diverged (history.markDiverged). Pure. */
  execute(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): LeagueState

  /**
   * AI-initiated offers to the user: 0–3 in the draft when the user is on the clock (teams whose top
   * need matches the best available prospect), and per settings.aiOfferFrequency in-season. Each has
   * the AI's own p ≥ 0.5 and value within a plausible band.
   */
  generateAiOffers(
    state: LeagueState,
    ctx: EngineContext,
    rng: Rng,
    context: 'draft' | 'season',
  ): TradeProposal[]

  /**
   * Proactive suggestions for the user (Phase 6): AI-initiated deals that send the user a player at one
   * of their top consensus needs from a team that is not short there, priced so the AI's own p ≥ 0.5
   * and the user's side sits inside the plausibility band. AI-initiated, so accepting one always
   * executes while its assets are still in place. Consensus only — never reads truth.
   */
  suggestTrades(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[]
}

export const tradeStub: TradeModule = {
  constants: {
    marginByStrictness: { lenient: -0.03, balanced: 0.05, strict: 0.15, ruthless: 0.3 },
    scale: 12,
    futurePickDiscount: 0.85,
    maxFirstsPerDeal: 2,
    annoyancePerLowball: 1,
    annoyanceMarginPerPoint: 0.02,
  },
  playerValue: () => notImplemented('trade.playerValue'),
  pickValue: () => notImplemented('trade.pickValue'),
  evaluate: () => notImplemented('trade.evaluate'),
  submit: () => notImplemented('trade.submit'),
  execute: () => notImplemented('trade.execute'),
  generateAiOffers: () => notImplemented('trade.generateAiOffers'),
  suggestTrades: () => notImplemented('trade.suggestTrades'),
}
```

## `app/src/contracts/engine/fa.ts`

```ts
/**
 * engine/fa — free agency, contracts, cap (§6.6). Owned by fa-cap (3C).
 */
import type {
  Contract,
  CutdownPlan,
  LeagueState,
  PlayerId,
  RosterValidation,
  Season,
  TeamId,
} from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface FaModule {
  /** Cap in $M for a season: real table, then growthAfterData compounding beyond the last real season. */
  capFor(season: Season, ctx: EngineContext): number

  /** Sum of roster apy + deadMoney. */
  payroll(state: LeagueState, teamId: TeamId): number
  capSpace(state: LeagueState, teamId: TeamId, ctx: EngineContext): number

  /** capPct(pos, consensus.ovr, age) × cap, fit to APY-at-position percentiles. Min ≈ 0.3% of cap. */
  marketApy(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** 4 years, apy from slot table (fit to real rookie scale % of cap); UDFA = minimum, 3 years. */
  rookieContract(
    pick: { round: number; pick: number } | null,
    season: Season,
    ctx: EngineContext,
  ): Contract

  /** Veteran contract synthesized from market apy; length by age (younger → longer, max 5). */
  synthesizeContract(
    state: LeagueState,
    playerId: PlayerId,
    season: Season,
    ctx: EngineContext,
    hint?: { apy?: number; years?: number },
  ): Contract

  /** Expiring players' asks for the OFFSEASON_RESIGN phase: marketApy × (1 ± 10%), seeded per player. */
  resignAsk(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** User re-signs at `apy` ≥ ask. Throws if below ask or over cap. */
  resign(
    state: LeagueState,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
  ): LeagueState

  /** AI teams re-sign: history-anchored when the player is on their real next-season roster, else by value/need under cap. Unsigned → freeAgents. */
  runAiResign(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /** Unsigned players, sorted by consensus ovr desc. */
  freeAgentPool(state: LeagueState): PlayerId[]

  /**
   * User offer with 1-day simulated bidding: P(accept) rises with offer/ask and team quality.
   * Hard gates: cap, roster ≤ 90 (offseason) / 53 (in-season). Marks the player diverged on success.
   */
  offer(
    state: LeagueState,
    teamId: TeamId,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
    rng: Rng,
  ): { accepted: boolean; state: LeagueState }

  /** P(accept) the offer would face before any hard gate (cap, roster size); pure, for UI previews. */
  offerOdds(
    state: LeagueState,
    teamId: TeamId,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
  ): number

  /** AI signings: history-anchored (real team for that season) with value/need fallback under cap. */
  runAiFreeAgency(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /**
   * PRESEASON → REGULAR: every AI team over 53 releases down to 53 (release() dead-money rules), keeping
   * STARTER_TEMPLATE minimums; in history prefer the players on the real opening-day roster
   * (seasonData(season).rosters), otherwise cut lowest consensus value first. The user's team is left
   * alone — league.advancePhase throws if it is still over 53. Called by league before validateRoster.
   */
  runAiCutdowns(state: LeagueState, ctx: EngineContext): LeagueState

  /** Release: dead money = 25% of remaining guaranteed apy × years, charged this season. Marks diverged. */
  release(state: LeagueState, teamId: TeamId, playerId: PlayerId, ctx: EngineContext): LeagueState

  /**
   * Pure suggestion for the user's cutdown (docs/DECISIONS.md 2026-09-20): first to the roster limit by
   * lowest consensus ovr, then under the cap by most net savings per rating point above 40, never
   * dropping a position below STARTER_TEMPLATE or the roster below the game minimum. `protect` players
   * are never suggested. Consensus and contracts only — no history anchoring, no truth. Deterministic;
   * does not mutate state. Empty `cuts` with `ok: true` when the roster is already legal.
   */
  suggestCutdown(
    state: LeagueState,
    teamId: TeamId,
    ctx: EngineContext,
    protect?: readonly PlayerId[],
  ): CutdownPlan

  /** 46–53 to sim a game (≤90 in the offseason), under cap, ≥1 QB/K/P etc. per STARTER_TEMPLATE. */
  validateRoster(state: LeagueState, teamId: TeamId, ctx: EngineContext): RosterValidation

  /** Decrement contract years at season rollover; expiring → returned for the re-sign phase. */
  rolloverContracts(
    state: LeagueState,
    ctx: EngineContext,
  ): { state: LeagueState; expiring: Record<TeamId, PlayerId[]> }
}

export const faStub: FaModule = {
  capFor: () => notImplemented('fa.capFor'),
  payroll: () => notImplemented('fa.payroll'),
  capSpace: () => notImplemented('fa.capSpace'),
  marketApy: () => notImplemented('fa.marketApy'),
  rookieContract: () => notImplemented('fa.rookieContract'),
  synthesizeContract: () => notImplemented('fa.synthesizeContract'),
  resignAsk: () => notImplemented('fa.resignAsk'),
  resign: () => notImplemented('fa.resign'),
  runAiResign: () => notImplemented('fa.runAiResign'),
  freeAgentPool: () => notImplemented('fa.freeAgentPool'),
  offer: () => notImplemented('fa.offer'),
  offerOdds: () => notImplemented('fa.offerOdds'),
  runAiFreeAgency: () => notImplemented('fa.runAiFreeAgency'),
  runAiCutdowns: () => notImplemented('fa.runAiCutdowns'),
  release: () => notImplemented('fa.release'),
  suggestCutdown: () => notImplemented('fa.suggestCutdown'),
  validateRoster: () => notImplemented('fa.validateRoster'),
  rolloverContracts: () => notImplemented('fa.rolloverContracts'),
}
```

## `app/src/contracts/engine/lifecycle.ts`

```ts
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
}

export const lifecycleStub: LifecycleModule = {
  progressSeason: () => notImplemented('lifecycle.progressSeason'),
  retirements: () => notImplemented('lifecycle.retirements'),
  refreshScouting: () => notImplemented('lifecycle.refreshScouting'),
  tickInjuries: () => notImplemented('lifecycle.tickInjuries'),
  applyInjuryEvents: () => notImplemented('lifecycle.applyInjuryEvents'),
  generateDraftClass: () => notImplemented('lifecycle.generateDraftClass'),
  age: () => notImplemented('lifecycle.age'),
}
```

## `app/src/contracts/engine/history.ts`

```ts
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
```

## `app/src/contracts/engine/persistence.ts`

```ts
/**
 * engine/persistence — save/load, migrations, export/import (§6.9). Owned by league-engine (1C).
 *
 * IndexedDB via `idb`. Save = SavedLeague (LeagueState with divergence as array). Autosave at every
 * phase transition and every 4 weeks (the store calls `save`). Multiple slots. Schema version + migrations.
 */
import type { LeagueState, SavedLeague } from '../types'
import { notImplemented } from './context'

export interface SaveSlotMeta {
  slot: string
  userTeam: string
  season: number
  week: number
  phase: string
  startSeason: number
  horizonEnd: number
  savedAt: string
  schemaVersion: number
}

export interface PersistenceModule {
  readonly SCHEMA_VERSION: number
  listSaves(): Promise<SaveSlotMeta[]>
  save(slot: string, state: LeagueState): Promise<SaveSlotMeta>
  load(slot: string): Promise<LeagueState>
  remove(slot: string): Promise<void>
  /** JSON string of SavedLeague, validated against SavedLeagueSchema. */
  exportJson(state: LeagueState): string
  /** Parse, migrate, validate, hydrate. Throws with a readable message on a bad file. */
  importJson(json: string): LeagueState
  /** Bring any older SavedLeague up to SCHEMA_VERSION. Identity for current version. */
  migrate(saved: unknown): SavedLeague
}

export const persistenceStub: PersistenceModule = {
  SCHEMA_VERSION: 1,
  listSaves: () => notImplemented('persistence.listSaves'),
  save: () => notImplemented('persistence.save'),
  load: () => notImplemented('persistence.load'),
  remove: () => notImplemented('persistence.remove'),
  exportJson: () => notImplemented('persistence.exportJson'),
  importJson: () => notImplemented('persistence.importJson'),
  migrate: () => notImplemented('persistence.migrate'),
}
```
