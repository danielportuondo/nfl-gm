/**
 * Gridiron GM — data & save-file schemas. ORCHESTRATOR-OWNED (docs/HANDOFF.md §3).
 *
 * Single source of truth for every JSON file under app/public/data and for the save file.
 * `scripts/gen-contracts.ts` exports these to app/src/contracts/schemas/*.schema.json, which the
 * Python pipeline validates against. Domain types in ./types.ts are inferred from these schemas.
 *
 * Subagents: never edit this file. Request changes under "CONTRACT REQUESTS" in your report.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'] as const
export const PositionSchema = z
  .enum(POSITIONS)
  .describe(
    'Position group. Fine-grained nflverse positions are collapsed in the pipeline (T/G/C→OL, DE/DT/NT→DL, OLB/ILB/MLB→LB, FS/SS→S).',
  )

export const SeasonSchema = z
  .number()
  .int()
  .min(1920)
  .max(2200)
  .describe('NFL season year, e.g. 2015.')
export const WeekSchema = z.number().int().min(0).max(30)
export const TeamIdSchema = z
  .string()
  .min(2)
  .max(3)
  .describe('Canonical franchise id (current abbreviation, e.g. LAR for STL/LA). See teams.ts.')
export const PlayerIdSchema = z
  .string()
  .min(1)
  .describe('gsis_id for real players; "gen-<seed>-<n>" for procedural players.')
export const GameIdSchema = z.string().min(1).describe('"<season>-<type>-<week>-<away>@<home>"')
export const RatingSchema = z.number().min(40).max(99).describe('Rating on the shared 40–99 scale.')
export const ProbabilitySchema = z.number().min(0).max(1)
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const ATTRIBUTION =
  'Data courtesy of nflverse (CC BY 4.0). Unofficial fan-made project; not affiliated with the NFL.'
export const AttributionSchema = z.string().min(10).describe('Must mention nflverse and CC BY 4.0.')

// ---------------------------------------------------------------------------------------------
// Domain objects (also used inside the save file)
// ---------------------------------------------------------------------------------------------

export const DraftOriginSchema = z.object({
  season: SeasonSchema,
  round: z.number().int().min(1).max(7),
  pick: z.number().int().min(1).max(300).describe('Overall pick number.'),
  team: TeamIdSchema.describe('Team that made the pick.'),
})

export const PlayerSchema = z.object({
  id: PlayerIdSchema,
  name: z.string().min(1),
  pos: PositionSchema,
  birthYear: z.number().int().min(1900).max(2200),
  college: z.string().optional(),
  heightIn: z.number().optional(),
  weightLb: z.number().optional(),
  draft: DraftOriginSchema.nullable().describe('null = undrafted free agent.'),
  real: z.boolean().describe('false for procedurally generated players.'),
  rookieSeason: SeasonSchema.describe('First NFL season (nflverse rookie_year / entry_year).'),
})

export const ScoutingViewSchema = z.object({
  ovr: RatingSchema.describe('Consensus current ability — what the world believes right now.'),
  pot: RatingSchema.describe(
    'Consensus ceiling from age/draft slot/combine. NEVER derived from real future.',
  ),
  confidence: ProbabilitySchema.describe(
    '0–1. Low for rookies/UDFA, high for established veterans.',
  ),
})

export const TrueTrajectorySchema = z.object({
  bySeason: z
    .record(z.string(), RatingSchema)
    .describe(
      'Keys are season years as strings. True value per season from the real career (or generated once past data).',
    ),
  retiresAfter: SeasonSchema.nullable().describe(
    'Last season played; null = unknown/still active.',
  ),
})

export const ContractSchema = z.object({
  years: z.number().int().min(1).max(7).describe('Years remaining including the current season.'),
  apy: z.number().min(0).describe('Average per year in $M.'),
  guaranteedPct: ProbabilitySchema,
  signedSeason: SeasonSchema,
  rookie: z.boolean(),
})

export const InjurySchema = z.object({
  weeksOut: z.number().int().min(0),
  kind: z.string(),
  season: SeasonSchema,
  week: WeekSchema,
})

export const RosterSlotSchema = z.object({
  playerId: PlayerIdSchema,
  teamId: TeamIdSchema,
  contract: ContractSchema,
  injured: InjurySchema.optional(),
})

export const TeamRecordSchema = z.object({
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  ties: z.number().int().min(0),
  pointsFor: z.number().int().min(0),
  pointsAgainst: z.number().int().min(0),
})

export const DepthChartSchema = z
  .partialRecord(PositionSchema, z.array(PlayerIdSchema))
  .describe('Ordered player ids per position group; starters first.')

export const TeamStateSchema = z.object({
  id: TeamIdSchema,
  roster: z.array(RosterSlotSchema),
  depthChart: DepthChartSchema,
  record: TeamRecordSchema,
  deadMoney: z.number().min(0).describe("$M charged against this season's cap from releases."),
  tradeAnnoyance: z
    .number()
    .min(0)
    .describe(
      "Raised by declined lowballs; raises this team's trade margin for the season (§6.5).",
    ),
  userControlled: z.boolean(),
})

export const DraftPickSchema = z.object({
  season: SeasonSchema,
  round: z.number().int().min(1).max(7),
  pick: z
    .number()
    .int()
    .min(1)
    .max(300)
    .nullable()
    .describe('Overall pick number; null until the draft order for that season is set.'),
  originalTeam: TeamIdSchema,
  owner: TeamIdSchema,
  playerId: PlayerIdSchema.nullable().describe('Filled once the pick is used.'),
})

export const GameTypeSchema = z.enum(['REG', 'WC', 'DIV', 'CONF', 'SB'])

export const GameSchema = z.object({
  id: GameIdSchema,
  season: SeasonSchema,
  week: WeekSchema,
  type: GameTypeSchema,
  home: TeamIdSchema,
  away: TeamIdSchema,
  neutralSite: z.boolean().optional(),
})

export const PlayerGameLineSchema = z.object({
  playerId: PlayerIdSchema,
  teamId: TeamIdSchema,
  passAtt: z.number().int().optional(),
  passCmp: z.number().int().optional(),
  passYds: z.number().int().optional(),
  passTd: z.number().int().optional(),
  passInt: z.number().int().optional(),
  rushAtt: z.number().int().optional(),
  rushYds: z.number().int().optional(),
  rushTd: z.number().int().optional(),
  targets: z.number().int().optional(),
  rec: z.number().int().optional(),
  recYds: z.number().int().optional(),
  recTd: z.number().int().optional(),
  tackles: z.number().int().optional(),
  sacks: z.number().optional(),
  ints: z.number().int().optional(),
  forcedFumbles: z.number().int().optional(),
  passesDefended: z.number().int().optional(),
  fgm: z.number().int().optional(),
  fga: z.number().int().optional(),
  xpm: z.number().int().optional(),
  xpa: z.number().int().optional(),
  punts: z.number().int().optional(),
  puntYds: z.number().int().optional(),
  twoPt: z.number().int().optional().describe('Two-point conversions scored by this player.'),
  defTd: z.number().int().optional().describe('Interception/fumble-return touchdowns.'),
  retTd: z.number().int().optional().describe('Kick/punt-return touchdowns.'),
  safeties: z.number().int().optional().describe('Safeties credited to this defender.'),
})

export const BoxScoreSchema = z.object({
  home: z.array(PlayerGameLineSchema),
  away: z.array(PlayerGameLineSchema),
})

export const InjuryEventSchema = z.object({
  playerId: PlayerIdSchema,
  teamId: TeamIdSchema,
  weeksOut: z.number().int().min(1),
  kind: z.string(),
})

export const GameResultSchema = z.object({
  gameId: GameIdSchema,
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  overtime: z.boolean(),
  box: BoxScoreSchema.optional(),
  injuries: z.array(InjuryEventSchema),
})

export const StandingRowSchema = z.object({
  teamId: TeamIdSchema,
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
  pct: z.number().min(0).max(1),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
  divRank: z.number().int().min(1).max(4),
  confRank: z.number().int().min(1).max(16),
  clinched: z.enum(['DIV', 'WC', 'BYE', 'OUT']).nullable(),
})

export const PlayoffFormatSchema = z.object({
  teams: z.union([z.literal(12), z.literal(14)]),
  byesPerConf: z.union([z.literal(1), z.literal(2)]),
  regularSeasonGames: z.union([z.literal(16), z.literal(17)]),
})

export const PlayoffSeedSchema = z.object({
  teamId: TeamIdSchema,
  conf: z.enum(['AFC', 'NFC']),
  seed: z.number().int().min(1).max(7),
})

export const PlayoffBracketSchema = z.object({
  season: SeasonSchema,
  seeds: z.array(PlayoffSeedSchema),
  rounds: z.array(z.object({ type: GameTypeSchema, games: z.array(GameSchema) })),
  champion: TeamIdSchema.nullable(),
})

export const AwardSchema = z.object({
  name: z.string(),
  playerId: PlayerIdSchema.optional(),
  teamId: TeamIdSchema.optional(),
  note: z.string().optional(),
})

export const PlayoffExitSchema = z.enum(['MISSED', 'WC', 'DIV', 'CONF', 'SB_LOSS', 'CHAMPION'])

export const SeasonSummarySchema = z.object({
  season: SeasonSchema,
  champion: TeamIdSchema.nullable(),
  runnerUp: TeamIdSchema.nullable(),
  standings: z.array(StandingRowSchema),
  awards: z.array(AwardSchema),
  userTeam: TeamIdSchema,
  userRecord: TeamRecordSchema,
  userPlayoffExit: PlayoffExitSchema,
})

export const PHASES = [
  'PRESEASON',
  'REGULAR',
  'PLAYOFFS',
  'OFFSEASON_RESIGN',
  'DRAFT',
  'UDFA',
  'FREE_AGENCY',
  'TRAINING_CAMP',
] as const
export const PhaseSchema = z
  .enum(PHASES)
  .describe(
    'Season phases in order. After TRAINING_CAMP the season increments and PRESEASON begins.',
  )

export const GameSettingsSchema = z.object({
  tradeStrictness: z.enum(['lenient', 'balanced', 'strict', 'ruthless']),
  aiOfferFrequency: z.enum(['rare', 'normal', 'aggressive']),
  injuries: z.boolean(),
  difficultyNotes: z.string().optional(),
})

export const GameOutcomeSchema = z.enum(['IN_PROGRESS', 'CHAMPION', 'HORIZON_EXPIRED'])

export const PickRefSchema = z
  .object({
    season: SeasonSchema,
    round: z.number().int().min(1).max(7),
    originalTeam: TeamIdSchema,
    pick: z
      .number()
      .int()
      .min(1)
      .max(300)
      .nullable()
      .optional()
      .describe(
        "Overall pick number when known; needed to tell a compensatory pick from the same team's own pick in that round.",
      ),
  })
  .describe('Identifies a DraftPick regardless of current owner.')

export const TradeSideSchema = z.object({
  teamId: TeamIdSchema,
  players: z.array(PlayerIdSchema),
  picks: z.array(PickRefSchema),
})

export const TradeProposalSchema = z.object({
  id: z.string(),
  offer: TradeSideSchema.describe('What the proposer gives.'),
  request: TradeSideSchema.describe('What the proposer wants from the counterparty.'),
  initiatedBy: z.enum(['USER', 'AI']),
  season: SeasonSchema,
  week: WeekSchema,
})

export const DraftLogEntrySchema = z.object({
  pick: z.number().int(),
  round: z.number().int(),
  team: TeamIdSchema,
  playerId: PlayerIdSchema,
  historical: z.boolean().describe('true when the pick matched the real-life selection.'),
})

export const DraftRoomStateSchema = z.object({
  season: SeasonSchema,
  status: z.enum(['ON_CLOCK', 'COMPLETE']),
  currentPickIndex: z.number().int().min(0),
  order: z
    .array(DraftPickSchema)
    .describe('All picks of the season in order; playerId filled as they are made.'),
  available: z.array(PlayerIdSchema).describe('Undrafted prospects, sorted by consensus pot desc.'),
  udfaPool: z.array(PlayerIdSchema),
  log: z.array(DraftLogEntrySchema),
  pendingOffers: z
    .array(TradeProposalSchema)
    .describe('AI offers shown while the user is on the clock.'),
})

export const SnapEventSchema = z.object({
  season: SeasonSchema,
  playerId: PlayerIdSchema,
  fromTeam: TeamIdSchema.nullable(),
  toTeam: TeamIdSchema.nullable(),
  reason: z.enum(['HISTORY', 'RETIRED', 'DIVERGED_KEPT', 'NEW_ARRIVAL']),
})

// ---------------------------------------------------------------------------------------------
// Save file (LeagueState with Set → array). In memory, `divergence` is a Set<PlayerId>.
// ---------------------------------------------------------------------------------------------

export const SAVE_SCHEMA_VERSION = 1

export const SavedLeagueSchema = z.object({
  schemaVersion: z.number().int().min(1),
  seed: z.string().min(1),
  season: SeasonSchema,
  week: WeekSchema,
  phase: PhaseSchema,
  userTeam: TeamIdSchema,
  horizonEnd: SeasonSchema.describe('Last season in which a Super Bowl win counts.'),
  startSeason: SeasonSchema,
  settings: GameSettingsSchema,
  teams: z.record(TeamIdSchema, TeamStateSchema),
  players: z.record(PlayerIdSchema, PlayerSchema),
  scouting: z.record(PlayerIdSchema, ScoutingViewSchema),
  truth: z
    .record(PlayerIdSchema, TrueTrajectorySchema)
    .describe('HIDDEN. Present in state; nothing under screens/ or ui/ may read it.'),
  picks: z.array(DraftPickSchema),
  schedule: z.array(GameSchema),
  results: z.array(GameResultSchema),
  history: z.array(SeasonSummarySchema),
  divergence: z
    .array(PlayerIdSchema)
    .describe('Players whose ownership left the historical path (§6.8).'),
  freeAgents: z.array(PlayerIdSchema),
  draftRoom: DraftRoomStateSchema.nullable(),
  snapLog: z.array(SnapEventSchema),
  outcome: GameOutcomeSchema,
  savedAt: z.string().describe('ISO timestamp of the save.'),
})

// ---------------------------------------------------------------------------------------------
// Static data files (app/public/data/*.json)
// ---------------------------------------------------------------------------------------------

export const TeamInfoSchema = z.object({
  id: TeamIdSchema,
  city: z.string(),
  name: z.string(),
  abbr: z.string().describe('Display abbreviation for the current era.'),
  conf: z.enum(['AFC', 'NFC']),
  div: z.enum(['East', 'North', 'South', 'West']),
  colors: z.object({
    primary: HexColorSchema,
    secondary: HexColorSchema,
    tertiary: HexColorSchema.optional(),
  }),
  aliases: z
    .array(z.string())
    .describe(
      'nflverse team codes this franchise has used (e.g. ["STL","LA","LAR"]). No logo URLs — ever.',
    ),
  eras: z
    .array(
      z.object({
        from: SeasonSchema,
        to: SeasonSchema.nullable(),
        city: z.string(),
        name: z.string(),
        abbr: z.string(),
      }),
    )
    .optional(),
})

export const TeamsFileSchema = z.object({
  attribution: AttributionSchema,
  teams: z.array(TeamInfoSchema).length(32),
})

export const CapFileSchema = z.object({
  attribution: AttributionSchema,
  bySeason: z
    .record(z.string(), z.number().positive())
    .describe('Salary cap in $M keyed by season string. 2010 uncapped → 123.0 for game purposes.'),
  growthAfterData: z
    .number()
    .min(0)
    .max(0.2)
    .describe('Annual growth applied beyond the last real season (0.06).'),
})

export const AgingCurveSchema = z.object({
  pos: PositionSchema,
  byAge: z
    .record(z.string(), z.number())
    .describe('Expected true-value delta entering a season at this age (ages as string keys).'),
  sd: z.number().min(0).describe('σ of the yearly noise for this position.'),
})

export const SlotGradePointSchema = z.object({
  pick: z.number().int().min(1),
  ovr: RatingSchema,
  pot: RatingSchema,
  sd: z.number().min(0),
})

export const OutcomeTableSchema = z.object({
  bucket: z
    .string()
    .describe(
      'Pick-slot bucket label, e.g. "1-10", "11-32", "33-64", "65-105", "106-160", "161-260", "UDFA".',
    ),
  pickMin: z.number().int().min(0),
  pickMax: z.number().int().min(0),
  pos: z.union([PositionSchema, z.literal('ALL')]),
  years: z.array(z.number().int().min(1)).describe('Career year indices covered (1..8).'),
  quantiles: z.array(z.number()).describe('Quantile levels, e.g. [0.1,0.25,0.5,0.75,0.9].'),
  values: z.array(z.array(RatingSchema)).describe('values[yearIdx][quantileIdx] = true value.'),
  bustRate: ProbabilitySchema.describe('P(out of league by year 4).'),
})

export const RetirementCurveSchema = z.object({
  pos: PositionSchema,
  byAge: z
    .record(z.string(), ProbabilitySchema)
    .describe('P(retire after season) at this age, evaluated at position-mean value.'),
  valueSlope: z
    .number()
    .describe(
      'Logit slope per rating point above/below position mean (negative: better players retire later).',
    ),
})

export const CurvesFileSchema = z.object({
  attribution: AttributionSchema,
  fitSeasons: z.tuple([SeasonSchema, SeasonSchema]),
  aging: z.array(AgingCurveSchema),
  slotGrade: z
    .array(SlotGradePointSchema)
    .describe('Consensus ovr/pot by overall pick; interpolate between points.'),
  udfaGrade: z.object({
    ovrMean: RatingSchema,
    ovrSd: z.number().min(0),
    potQuantiles: z.array(RatingSchema),
  }),
  outcomes: z.array(OutcomeTableSchema),
  retirement: z.array(RetirementCurveSchema),
  positionMix: z
    .record(PositionSchema, ProbabilitySchema)
    .describe('Share of a draft class by position; sums to ~1.'),
  classSize: z.object({ drafted: z.number().int(), udfa: z.number().int() }),
  names: z
    .object({ first: z.array(z.string()).min(50), last: z.array(z.string()).min(50) })
    .describe('Generated names for procedural players. Never real player names.'),
})

export const InjuryModelFileSchema = z.object({
  attribution: AttributionSchema,
  fitSeasons: z.tuple([SeasonSchema, SeasonSchema]),
  ratePerPlayerGame: z
    .record(PositionSchema, ProbabilitySchema)
    .describe('P(new multi-week injury) per active player per game.'),
  duration: z
    .array(z.object({ weeks: z.number().int().min(1), p: ProbabilitySchema }))
    .describe('Discrete distribution of weeks out; sums to ~1.'),
  kinds: z.array(z.object({ kind: z.string(), p: ProbabilitySchema })),
  permanentLoss: z.object({
    minWeeks: z.number().int(),
    p: ProbabilitySchema,
    lossRange: z.tuple([z.number(), z.number()]),
  }),
})

export const ManifestSchema = z.object({
  schemaVersion: z.number().int().min(1),
  generatedAt: z.string(),
  attribution: AttributionSchema,
  seasons: z.array(SeasonSchema).min(1).describe('Seasons with a season/{yyyy}/ chunk.'),
  latestRealSeason: SeasonSchema.describe(
    'Last season with complete real data; procedural generation begins after it.',
  ),
  sizesBytes: z
    .record(z.string(), z.number().int())
    .optional()
    .describe('gzipped size per file, for the CI budget check.'),
})

// ---------------------------------------------------------------------------------------------
// Per-season chunks (app/public/data/season/{yyyy}/*.json)
// ---------------------------------------------------------------------------------------------

export const SeasonPlayerSchema = PlayerSchema.extend({
  scouting: ScoutingViewSchema.describe('Consensus at season start.'),
  trueValue: RatingSchema.describe(
    'True value for THIS season only. Loaded into truth by the engine; never shown.',
  ),
  team: TeamIdSchema.nullable().describe('Team at season start; null if unsigned.'),
})

export const SeasonPlayersFileSchema = z.object({
  attribution: AttributionSchema,
  season: SeasonSchema,
  players: z.array(SeasonPlayerSchema),
})

export const RosterEntrySchema = z.object({
  playerId: PlayerIdSchema,
  apy: z
    .number()
    .min(0)
    .optional()
    .describe('Real APY hint in $M when known (contracts data ~2011+).'),
  years: z.number().int().min(1).optional(),
  depth: z.number().int().min(1).optional().describe('Depth-chart order at position, 1 = starter.'),
})

export const SeasonRostersFileSchema = z.object({
  attribution: AttributionSchema,
  season: SeasonSchema,
  rosters: z.record(TeamIdSchema, z.array(RosterEntrySchema)),
})

export const DraftOrderEntrySchema = z.object({
  round: z.number().int().min(1).max(7),
  pick: z.number().int().min(1).max(300),
  team: TeamIdSchema.describe('Team that actually made the pick (after real trades/comp picks).'),
  originalTeam: TeamIdSchema.describe(
    'Team the pick originally belonged to (best effort; = team when unknown).',
  ),
  playerId: PlayerIdSchema.nullable().describe('Real selection; null if unmatched to a roster id.'),
})

export const ProspectSchema = PlayerSchema.extend({
  scouting: ScoutingViewSchema.describe('Pre-draft consensus from slot/combine/age only.'),
  combine: z.record(z.string(), z.number()).optional(),
})

export const SeasonDraftFileSchema = z.object({
  attribution: AttributionSchema,
  season: SeasonSchema,
  order: z.array(DraftOrderEntrySchema),
  prospects: z
    .array(ProspectSchema)
    .describe('Every drafted player + every real UDFA of the class.'),
  udfa: z.array(PlayerIdSchema),
})

export const ScheduledGameSchema = GameSchema.extend({
  homeScore: z.number().int().nullable().optional().describe('Real result, for calibration only.'),
  awayScore: z.number().int().nullable().optional(),
})

export const SeasonScheduleFileSchema = z.object({
  attribution: AttributionSchema,
  season: SeasonSchema,
  weeks: z.number().int().min(17).max(19).describe('Regular-season week count incl. byes.'),
  playoffFormat: PlayoffFormatSchema,
  games: z.array(ScheduledGameSchema),
})

// ---------------------------------------------------------------------------------------------
// Trajectories (the only cross-season file). Compact: values[i] is the season start+i; null = not in league.
// ---------------------------------------------------------------------------------------------

export const CompactTrajectorySchema = z.object({
  start: SeasonSchema,
  values: z.array(RatingSchema.nullable()),
  retiresAfter: SeasonSchema.nullable(),
})

export const TrajectoriesFileSchema = z.object({
  attribution: AttributionSchema,
  seasons: z.tuple([SeasonSchema, SeasonSchema]),
  byPlayer: z.record(PlayerIdSchema, CompactTrajectorySchema),
})

// ---------------------------------------------------------------------------------------------
// Registry consumed by scripts/gen-contracts.ts and by pipeline/gridiron_pipeline/schemas.py
// ---------------------------------------------------------------------------------------------

export const DATA_SCHEMAS = {
  manifest: ManifestSchema,
  teams: TeamsFileSchema,
  cap: CapFileSchema,
  curves: CurvesFileSchema,
  injuryModel: InjuryModelFileSchema,
  seasonPlayers: SeasonPlayersFileSchema,
  seasonRosters: SeasonRostersFileSchema,
  seasonDraft: SeasonDraftFileSchema,
  seasonSchedule: SeasonScheduleFileSchema,
  trajectories: TrajectoriesFileSchema,
  savedLeague: SavedLeagueSchema,
} as const

export type DataSchemaName = keyof typeof DATA_SCHEMAS

/** File path (relative to app/public/data) for each schema; `{yyyy}` is the season. */
export const DATA_FILES: Record<DataSchemaName, string> = {
  manifest: 'manifest.json',
  teams: 'teams.json',
  cap: 'cap.json',
  curves: 'curves.json',
  injuryModel: 'injuryModel.json',
  seasonPlayers: 'season/{yyyy}/players.json',
  seasonRosters: 'season/{yyyy}/rosters.json',
  seasonDraft: 'season/{yyyy}/draft.json',
  seasonSchedule: 'season/{yyyy}/schedule.json',
  trajectories: 'trajectories.json',
  savedLeague: '(IndexedDB / exported .json — not a data file)',
}
