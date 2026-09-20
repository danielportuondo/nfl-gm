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
