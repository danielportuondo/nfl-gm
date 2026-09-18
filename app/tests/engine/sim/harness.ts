/**
 * Shared scaffolding for sim tests and `scripts/calibrate.ts`: an EngineContext over the mock data,
 * a minimal regular-season runner (engine/league is a different agent's module), and the calibration
 * statistics that tell us whether a simulated season looks like a real one.
 */
import {
  draftStub, faStub, historyStub, leagueStub, lifecycleStub, tradeStub,
  type EngineContext, type GameResult, type LeagueState, type StaticData, type TeamId, type TrajectoryTable,
} from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { computeTeamStrength, resetTruthFallbackCount, truthFallbackCount } from '@engine/sim/strength'
import { testRng } from './testRng'

export function makeCtx(data: StaticData = mockStatic(), trajectories: TrajectoryTable = {}): EngineContext {
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

/** Simulate every REG game on the schedule once. Nothing is applied to state; sim is pure. */
export function runSeason(state: LeagueState, ctx: EngineContext, onResult?: (r: GameResult) => void): SeasonTotals {
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

  for (const game of state.schedule) {
    if (game.type !== 'REG') continue
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
  }
  return totals
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

  for (let i = 0; i < sims; i++) {
    const totals = runSeason({ ...base, seed: `${base.seed}#${i}` }, ctx)
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
    realWinCorrelation: opts.realWins ? correlation(teamIds.map((id) => opts.realWins![id] ?? 0), meanWins) : null,
    winSd: winSds.reduce((a, b) => a + b, 0) / Math.max(1, winSds.length),
    homeWinPct: (100 * (homeWins + ties / 2)) / games,
    meanTotalPoints: points / games,
    tieRate: ties / games,
    overtimeRate: overtimes / games,
    oneMarginRate: oneMargin / games,
    injuriesPerTeamGame: injuries / teamGames,
    multiWeekInjuriesPerTeamGame: multiWeek / teamGames,
    truthFallbacks: truthFallbackCount(),
    seconds: (performance.now() - started) / 1000,
  }
}
