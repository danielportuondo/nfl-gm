/**
 * Shared scaffolding for sim tests and `scripts/calibrate.ts`: an EngineContext over the mock data,
 * a minimal regular-season runner (engine/league is a different agent's module), and the calibration
 * statistics that tell us whether a simulated season looks like a real one.
 */
import {
  draftStub,
  faStub,
  historyStub,
  leagueStub,
  lifecycleStub,
  tradeStub,
  type EngineContext,
  type GameResult,
  type LeagueState,
  type PlayerGameLine,
  type StaticData,
  type TeamId,
  type TrajectoryTable,
} from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { lifecycle } from '@engine/lifecycle/index'
import { sim } from '@engine/sim/index'
import {
  computeTeamStrength,
  resetTruthFallbackCount,
  truthFallbackCount,
} from '@engine/sim/strength'
import { testRng } from './testRng'

export function makeCtx(
  data: StaticData = mockStatic(),
  trajectories: TrajectoryTable = {},
): EngineContext {
  return {
    data,
    trajectories,
    seasonData: () => undefined,
    modules: {
      rng: testRng,
      sim,
      league: leagueStub,
      draft: draftStub,
      trade: tradeStub,
      fa: faStub,
      lifecycle: lifecycleStub,
      history: historyStub,
    },
  }
}

/** Points a team's box score accounts for; equals the team's final score. */
export function boxPoints(lines: readonly PlayerGameLine[]): number {
  const stat = (key: keyof PlayerGameLine) =>
    lines.reduce((acc, line) => acc + ((line[key] as number | undefined) ?? 0), 0)
  const touchdowns = stat('passTd') + stat('rushTd') + stat('defTd') + stat('retTd')
  return 6 * touchdowns + stat('xpm') + 3 * stat('fgm') + 2 * stat('twoPt') + 2 * stat('safeties')
}

export interface SeasonTotals {
  wins: Record<TeamId, number>
  games: number
  homeWins: number
  ties: number
  overtimes: number
  points: number
  oneMarginGames: number
  injuries: number
  multiWeekInjuries: number
  teamGames: number
}

/**
 * Simulate every REG game on the schedule once, week by week. Injuries are applied and ticked between
 * weeks exactly as `league.simWeek` does, so depleted rosters feed later games and the calibration
 * table reflects a played season's variance (Phase 5 finding 6). The caller's state is not mutated.
 */
export function runSeason(
  state: LeagueState,
  ctx: EngineContext,
  onResult?: (r: GameResult) => void,
): SeasonTotals {
  const totals: SeasonTotals = {
    wins: {},
    games: 0,
    homeWins: 0,
    ties: 0,
    overtimes: 0,
    points: 0,
    oneMarginGames: 0,
    injuries: 0,
    multiWeekInjuries: 0,
    teamGames: 0,
  }
  for (const teamId of Object.keys(state.teams).sort()) totals.wins[teamId] = 0

  const regular = state.schedule.filter((g) => g.type === 'REG')
  const weeks = [...new Set(regular.map((g) => g.week))].sort((a, b) => a - b)
  let current = state
  for (const week of weeks) {
    // The week's real absences (announced on the state) go in before the games, as simWeek does.
    current = lifecycle.applyWeekAbsences({ ...current, week, phase: 'REGULAR' })
    const results = regular
      .filter((g) => g.week === week)
      .map((game) => tally(current, game, ctx, onResult, totals))
    current = lifecycle.tickInjuries(
      current,
      ctx,
      ctx.modules.rng.fromSeed(current.seed, current.season, week, 'injuries'),
    )
    current = lifecycle.applyInjuryEvents(
      current,
      results.flatMap((r) => r.injuries),
    )
  }
  return totals
}

function tally(
  state: LeagueState,
  game: LeagueState['schedule'][number],
  ctx: EngineContext,
  onResult: ((r: GameResult) => void) | undefined,
  totals: SeasonTotals,
): GameResult {
  const result = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
  onResult?.(result)
  totals.games++
  totals.teamGames += 2
  totals.points += result.homeScore + result.awayScore
  if (result.overtime) totals.overtimes++
  if (Math.abs(result.homeScore - result.awayScore) === 1) totals.oneMarginGames++
  if (result.homeScore > result.awayScore) {
    totals.homeWins++
    totals.wins[game.home] = (totals.wins[game.home] ?? 0) + 1
  } else if (result.awayScore > result.homeScore) {
    totals.wins[game.away] = (totals.wins[game.away] ?? 0) + 1
  } else {
    totals.ties++
    totals.wins[game.home] = (totals.wins[game.home] ?? 0) + 0.5
    totals.wins[game.away] = (totals.wins[game.away] ?? 0) + 0.5
  }
  totals.injuries += result.injuries.length
  totals.multiWeekInjuries += result.injuries.filter((i) => i.weeksOut >= 2).length
  return result
}

export interface CalibrationReport {
  sims: number
  teams: number
  gamesPerTeam: number
  /** Pearson r between a team's overall rating and its mean win total. */
  winCorrelation: number
  /** Pearson r between simulated mean wins and the real win totals (HANDOFF §6.3 target ≥ 0.5); null on mock data. */
  realWinCorrelation: number | null
  /** Mean over sims of the sd of the 32 win totals. */
  winSd: number
  homeWinPct: number
  meanTotalPoints: number
  tieRate: number
  overtimeRate: number
  oneMarginRate: number
  injuriesPerTeamGame: number
  multiWeekInjuriesPerTeamGame: number
  truthFallbacks: number
  box: BoxSeasonStats | null
  seconds: number
}

function sd(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1))
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx
    const b = ys[i]! - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy)
}

export interface CalibrationOptions {
  sims?: number
  season?: number
  seed?: string
  state?: LeagueState
  ctx?: EngineContext
  /** Real regular-season win totals by team, when calibrating against a real season. */
  realWins?: Record<TeamId, number>
  /** Collect box-score season stats over the first this-many sims (0 = skip; it costs runtime). */
  boxSims?: number
}

export function calibrate(opts: CalibrationOptions = {}): CalibrationReport {
  const sims = opts.sims ?? 500
  const season = opts.season ?? 2021
  const seed = opts.seed ?? 'calibrate'
  const base = opts.state ?? mockLeague({ seed, season })
  const ctx = opts.ctx ?? makeCtx()
  const started = performance.now()
  resetTruthFallbackCount()

  const teamIds = Object.keys(base.teams).sort()
  const overall = teamIds.map((id) => computeTeamStrength(base, id).overall)
  const meanWins = new Array<number>(teamIds.length).fill(0)
  const winSds: number[] = []

  let games = 0
  let homeWins = 0
  let ties = 0
  let overtimes = 0
  let points = 0
  let oneMargin = 0
  let injuries = 0
  let multiWeek = 0
  let teamGames = 0

  const boxSims = Math.min(sims, opts.boxSims ?? 0)
  const box = boxSims > 0 ? boxStatsCollector(base) : null

  for (let i = 0; i < sims; i++) {
    const collect = box !== null && i < boxSims
    const totals = runSeason(
      { ...base, seed: `${base.seed}#${i}` },
      ctx,
      collect ? box.onResult : undefined,
    )
    if (collect) box.endSeason()
    const wins = teamIds.map((id) => totals.wins[id] ?? 0)
    wins.forEach((w, t) => (meanWins[t]! += w / sims))
    winSds.push(sd(wins))
    games += totals.games
    homeWins += totals.homeWins
    ties += totals.ties
    overtimes += totals.overtimes
    points += totals.points
    oneMargin += totals.oneMarginGames
    injuries += totals.injuries
    multiWeek += totals.multiWeekInjuries
    teamGames += totals.teamGames
  }

  const regularGames = base.schedule.filter((g) => g.type === 'REG').length
  return {
    sims,
    teams: teamIds.length,
    gamesPerTeam: (regularGames * 2) / teamIds.length,
    winCorrelation: correlation(overall, meanWins),
    realWinCorrelation: opts.realWins
      ? correlation(
          teamIds.map((id) => opts.realWins![id] ?? 0),
          meanWins,
        )
      : null,
    winSd: winSds.reduce((a, b) => a + b, 0) / Math.max(1, winSds.length),
    homeWinPct: (100 * (homeWins + ties / 2)) / games,
    meanTotalPoints: points / games,
    tieRate: ties / games,
    overtimeRate: overtimes / games,
    oneMarginRate: oneMargin / games,
    injuriesPerTeamGame: injuries / teamGames,
    multiWeekInjuriesPerTeamGame: multiWeek / teamGames,
    truthFallbacks: truthFallbackCount(),
    box: box ? box.summary() : null,
    seconds: (performance.now() - started) / 1000,
  }
}

/** Season-level box-score shape: team rates per game and the leaderboard a real season produces. */
export interface BoxSeasonStats {
  seasons: number
  passAttPerTeamGame: number
  passYdsPerTeamGame: number
  rushAttPerTeamGame: number
  rushYdsPerTeamGame: number
  /** Means per season. */
  rushers1000: number
  passers4000: number
  receivers1000: number
  passLeader: number
  rushLeader: number
  recLeader: number
  /** Mean share of a team's receiving yards caught by its top receiver, and by its top tight end. */
  topReceiverShare: number
  topTeShare: number
}

type SeasonLeaders = Pick<
  BoxSeasonStats,
  'rushers1000' | 'passers4000' | 'receivers1000' | 'passLeader' | 'rushLeader' | 'recLeader'
>

/** Accumulates box scores fed through `runSeason`'s `onResult`; call `endSeason` after each season. */
export function boxStatsCollector(state: LeagueState) {
  const seasons: SeasonLeaders[] = []
  const team = { passAtt: 0, passYds: 0, rushAtt: 0, rushYds: 0, teamGames: 0 }
  const topShares: number[] = []
  const teShares: number[] = []
  let pass = new Map<string, number>()
  let rush = new Map<string, number>()
  let rec = new Map<string, number>()
  let recByTeam = new Map<TeamId, Map<string, number>>()

  const add = (m: Map<string, number>, id: string, v: number | undefined) => {
    if (v) m.set(id, (m.get(id) ?? 0) + v)
  }

  function onResult(r: GameResult): void {
    for (const lines of [r.box?.home ?? [], r.box?.away ?? []]) {
      team.teamGames++
      for (const line of lines) {
        team.passAtt += line.passAtt ?? 0
        team.passYds += line.passYds ?? 0
        team.rushAtt += line.rushAtt ?? 0
        team.rushYds += line.rushYds ?? 0
        add(pass, line.playerId, line.passYds)
        add(rush, line.playerId, line.rushYds)
        add(rec, line.playerId, line.recYds)
        if (line.recYds) {
          const byPlayer = recByTeam.get(line.teamId) ?? new Map<string, number>()
          add(byPlayer, line.playerId, line.recYds)
          recByTeam.set(line.teamId, byPlayer)
        }
      }
    }
  }

  function endSeason(): void {
    const values = (m: Map<string, number>) => [...m.values()]
    const atLeast = (m: Map<string, number>, line: number) =>
      values(m).filter((v) => v >= line).length
    const max = (m: Map<string, number>) => Math.max(0, ...values(m))
    seasons.push({
      rushers1000: atLeast(rush, 1000),
      passers4000: atLeast(pass, 4000),
      receivers1000: atLeast(rec, 1000),
      passLeader: max(pass),
      rushLeader: max(rush),
      recLeader: max(rec),
    })
    for (const byPlayer of recByTeam.values()) {
      const total = values(byPlayer).reduce((a, b) => a + b, 0)
      if (total === 0) continue
      topShares.push(max(byPlayer) / total)
      const te = [...byPlayer].filter(([id]) => state.players[id]?.pos === 'TE').map(([, v]) => v)
      teShares.push(Math.max(0, ...te) / total)
    }
    pass = new Map()
    rush = new Map()
    rec = new Map()
    recByTeam = new Map()
  }

  function summary(): BoxSeasonStats {
    const n = Math.max(1, seasons.length)
    const tg = Math.max(1, team.teamGames)
    const mean = (key: keyof SeasonLeaders) => seasons.reduce((a, s) => a + s[key], 0) / n
    const avg = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    return {
      seasons: seasons.length,
      passAttPerTeamGame: team.passAtt / tg,
      passYdsPerTeamGame: team.passYds / tg,
      rushAttPerTeamGame: team.rushAtt / tg,
      rushYdsPerTeamGame: team.rushYds / tg,
      rushers1000: mean('rushers1000'),
      passers4000: mean('passers4000'),
      receivers1000: mean('receivers1000'),
      passLeader: mean('passLeader'),
      rushLeader: mean('rushLeader'),
      recLeader: mean('recLeader'),
      topReceiverShare: avg(topShares),
      topTeShare: avg(teShares),
    }
  }

  return { onResult, endSeason, summary }
}
