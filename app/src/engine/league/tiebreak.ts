/**
 * NFL standings tiebreaks (division and wild-card procedures), used by standings() and seedPlayoffs().
 * The division structure has been fixed since 2002 and the procedures are unchanged across the
 * 6-seed and 7-seed eras (only how many seeds a conference fills differs, which the caller decides).
 *
 * Division tie:  head-to-head, division record, common games, conference record, strength of victory,
 *                strength of schedule.
 * Wild-card tie: division tiebreak first (one club per division survives), then head-to-head (only
 *                when one club swept the others or all of them met), conference record, common games
 *                (minimum 4), strength of victory, strength of schedule.
 * Ties count as half a win everywhere.
 *
 * Multi-club ties follow the NFL's restart rules: a step keeps only the clubs with the best value; if
 * one club is left it takes the seed, if two are left the two-club procedure restarts at step 1. Once
 * a seed is taken the remaining clubs start over from step 1 for the next seed.
 *
 * Deliberate simplification: the deep steps after strength of schedule (combined points rankings, net
 * points in common games, net touchdowns, coin toss) are replaced by season point differential and
 * then team id, so the order is always strict and deterministic.
 */
import { DIVISIONS, type CanonicalTeamId, type Conference, type TeamId } from '@contracts/index'

export interface TiebreakGame {
  home: TeamId
  away: TeamId
  homeScore: number
  awayScore: number
}

export interface TiebreakRecord {
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
}

interface PlayedGame {
  opponent: TeamId
  /** 1 win, 0.5 tie, 0 loss. */
  points: 0 | 0.5 | 1
}

export interface TiebreakContext {
  records: Readonly<Record<string, TiebreakRecord>>
  gamesByTeam: ReadonlyMap<TeamId, readonly PlayedGame[]>
}

const EMPTY_RECORD: TiebreakRecord = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
const WILD_CARD_MIN_COMMON_GAMES = 4

function placeOf(team: TeamId): { conf: Conference; div: string } {
  const place = DIVISIONS[team as CanonicalTeamId]
  if (!place) throw new Error(`tiebreak: unknown team id "${team}"`)
  return place
}

function recordOf(ctx: TiebreakContext, team: TeamId): TiebreakRecord {
  return ctx.records[team] ?? EMPTY_RECORD
}

export function winPct(r: { wins: number; losses: number; ties: number }): number {
  const total = r.wins + r.losses + r.ties
  return total === 0 ? 0 : (r.wins + 0.5 * r.ties) / total
}

function pointDiff(ctx: TiebreakContext, team: TeamId): number {
  const r = recordOf(ctx, team)
  return r.pointsFor - r.pointsAgainst
}

export function buildTiebreakContext(
  games: readonly TiebreakGame[],
  records: Readonly<Record<string, TiebreakRecord>>,
): TiebreakContext {
  const gamesByTeam = new Map<TeamId, PlayedGame[]>()
  const add = (team: TeamId, opponent: TeamId, points: 0 | 0.5 | 1) => {
    const list = gamesByTeam.get(team)
    if (list) list.push({ opponent, points })
    else gamesByTeam.set(team, [{ opponent, points }])
  }
  for (const g of games) {
    const homePoints = g.homeScore === g.awayScore ? 0.5 : g.homeScore > g.awayScore ? 1 : 0
    add(g.home, g.away, homePoints)
    add(g.away, g.home, (1 - homePoints) as 0 | 0.5 | 1)
  }
  return { records, gamesByTeam }
}

function playedBy(ctx: TiebreakContext, team: TeamId): readonly PlayedGame[] {
  return ctx.gamesByTeam.get(team) ?? []
}

function pctOfGames(games: readonly PlayedGame[]): number {
  if (games.length === 0) return 0
  return games.reduce((sum, g) => sum + g.points, 0) / games.length
}

function sameDivision(teams: readonly TeamId[]): boolean {
  const first = teams[0]
  if (first === undefined) return true
  const { conf, div } = placeOf(first)
  return teams.every((t) => placeOf(t).conf === conf && placeOf(t).div === div)
}

/** Combined win pct of a list of opponents, counted once per game played against them. */
function combinedOpponentPct(ctx: TiebreakContext, opponents: readonly TeamId[]): number {
  let wins = 0
  let games = 0
  for (const opp of opponents) {
    const r = recordOf(ctx, opp)
    wins += r.wins + 0.5 * r.ties
    games += r.wins + r.losses + r.ties
  }
  return games === 0 ? 0 : wins / games
}

function commonGames(
  ctx: TiebreakContext,
  group: readonly TeamId[],
  team: TeamId,
): readonly PlayedGame[] {
  const opponentSets = group.map((t) => new Set(playedBy(ctx, t).map((g) => g.opponent)))
  return playedBy(ctx, team).filter((g) => opponentSets.every((set) => set.has(g.opponent)))
}

function headToHeadScore(ctx: TiebreakContext, group: readonly TeamId[], team: TeamId): number {
  const games = playedBy(ctx, team).filter((g) => g.opponent !== team && group.includes(g.opponent))
  return games.length === 0 ? 0.5 : pctOfGames(games)
}

/** Wild-card head-to-head only counts when one club swept the rest or every pair met. */
function headToHeadApplies(ctx: TiebreakContext, group: readonly TeamId[]): boolean {
  const met = (a: TeamId, b: TeamId) => playedBy(ctx, a).some((g) => g.opponent === b)
  const everyPairMet = group.every((a) => group.every((b) => a === b || met(a, b)))
  if (everyPairMet) return true
  return group.some((team) => {
    const others = group.filter((t) => t !== team)
    if (!others.every((o) => met(team, o))) return false
    const pct = pctOfGames(playedBy(ctx, team).filter((g) => others.includes(g.opponent)))
    return pct === 1 || pct === 0
  })
}

interface TiebreakStep {
  applies?: (ctx: TiebreakContext, group: readonly TeamId[]) => boolean
  score: (ctx: TiebreakContext, group: readonly TeamId[], team: TeamId) => number
}

const divisionRecordStep: TiebreakStep = {
  score: (ctx, _group, team) =>
    pctOfGames(
      playedBy(ctx, team).filter(
        (g) =>
          placeOf(g.opponent).div === placeOf(team).div &&
          placeOf(g.opponent).conf === placeOf(team).conf,
      ),
    ),
}

const conferenceRecordStep: TiebreakStep = {
  score: (ctx, _group, team) =>
    pctOfGames(playedBy(ctx, team).filter((g) => placeOf(g.opponent).conf === placeOf(team).conf)),
}

const strengthOfVictoryStep: TiebreakStep = {
  score: (ctx, _group, team) =>
    combinedOpponentPct(
      ctx,
      playedBy(ctx, team)
        .filter((g) => g.points === 1)
        .map((g) => g.opponent),
    ),
}

const strengthOfScheduleStep: TiebreakStep = {
  score: (ctx, _group, team) =>
    combinedOpponentPct(
      ctx,
      playedBy(ctx, team).map((g) => g.opponent),
    ),
}

const DIVISION_STEPS: readonly TiebreakStep[] = [
  { score: headToHeadScore },
  divisionRecordStep,
  { score: (ctx, group, team) => pctOfGames(commonGames(ctx, group, team)) },
  conferenceRecordStep,
  strengthOfVictoryStep,
  strengthOfScheduleStep,
]

const WILD_CARD_STEPS: readonly TiebreakStep[] = [
  { applies: headToHeadApplies, score: headToHeadScore },
  conferenceRecordStep,
  {
    applies: (ctx, group) =>
      group.every((t) => commonGames(ctx, group, t).length >= WILD_CARD_MIN_COMMON_GAMES),
    score: (ctx, group, team) => pctOfGames(commonGames(ctx, group, team)),
  },
  strengthOfVictoryStep,
  strengthOfScheduleStep,
]

function narrowByStep(
  ctx: TiebreakContext,
  step: TiebreakStep,
  pool: readonly TeamId[],
): readonly TeamId[] {
  if (step.applies && !step.applies(ctx, pool)) return pool
  const scores = pool.map((team) => step.score(ctx, pool, team))
  const best = Math.max(...scores)
  return pool.filter((_, i) => scores[i] === best)
}

/** Of the clubs tied from one division, only the division tiebreak winner stays in a wild-card tie. */
function oneClubPerDivision(ctx: TiebreakContext, tied: readonly TeamId[]): readonly TeamId[] {
  const byDivision = new Map<string, TeamId[]>()
  for (const team of tied) {
    const { conf, div } = placeOf(team)
    const key = `${conf}-${div}`
    const members = byDivision.get(key)
    if (members) members.push(team)
    else byDivision.set(key, [team])
  }
  return [...byDivision.values()].map((members) =>
    members.length === 1 ? members[0]! : bestOfTied(ctx, members),
  )
}

/** The single club that takes the next seed out of a group already tied on win pct. */
function bestOfTied(ctx: TiebreakContext, tied: readonly TeamId[]): TeamId {
  const inDivision = sameDivision(tied)
  let pool = inDivision ? [...tied] : [...oneClubPerDivision(ctx, tied)]
  const steps = inDivision ? DIVISION_STEPS : WILD_CARD_STEPS
  let i = 0
  while (pool.length > 1 && i < steps.length) {
    const before = pool.length
    pool = [...narrowByStep(ctx, steps[i]!, pool)]
    i = pool.length === 2 && before > 2 ? 0 : i + 1
  }
  return [...pool].sort((a, b) => pointDiff(ctx, b) - pointDiff(ctx, a) || a.localeCompare(b))[0]!
}

function orderTied(ctx: TiebreakContext, tied: readonly TeamId[]): TeamId[] {
  const remaining = [...tied].sort()
  const ordered: TeamId[] = []
  while (remaining.length > 0) {
    const next = remaining.length === 1 ? remaining[0]! : bestOfTied(ctx, remaining)
    ordered.push(next)
    remaining.splice(remaining.indexOf(next), 1)
  }
  return ordered
}

/**
 * Order teams best-first: win pct (from their records), then the division or wild-card procedure for
 * every group tied on pct. Independent of the order `teamIds` arrives in.
 */
export function orderTeams(ctx: TiebreakContext, teamIds: readonly TeamId[]): TeamId[] {
  const buckets = new Map<number, TeamId[]>()
  for (const team of teamIds) {
    const pct = winPct(recordOf(ctx, team))
    const bucket = buckets.get(pct)
    if (bucket) bucket.push(team)
    else buckets.set(pct, [team])
  }
  return [...buckets.keys()]
    .sort((a, b) => b - a)
    .flatMap((pct) => orderTied(ctx, buckets.get(pct)!))
}

/** One conference's playoff field in seed order: division winners first, then wild cards. */
export function seedConference(
  ctx: TiebreakContext,
  confTeams: readonly TeamId[],
  seedCount: number,
): TeamId[] {
  const byDivision = new Map<string, TeamId[]>()
  for (const team of confTeams) {
    const { div } = placeOf(team)
    const members = byDivision.get(div)
    if (members) members.push(team)
    else byDivision.set(div, [team])
  }
  const winners: TeamId[] = []
  const rest: TeamId[] = []
  for (const members of byDivision.values()) {
    const sorted = orderTeams(ctx, members)
    winners.push(sorted[0]!)
    rest.push(...sorted.slice(1))
  }
  const seededWinners = orderTeams(ctx, winners)
  const wildCards = orderTeams(ctx, rest).slice(0, Math.max(0, seedCount - seededWinners.length))
  return [...seededWinners, ...wildCards].slice(0, seedCount)
}
