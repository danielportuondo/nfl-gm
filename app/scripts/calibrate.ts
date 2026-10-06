/**
 * Sim calibration harness (HANDOFF §6.3).
 *
 *   pnpm --filter app calibrate -- --mock --sims 500
 *   pnpm --filter app calibrate -- --season 2015 --sims 500     (real ratings, compared with real wins)
 *
 * Simulates a full regular season N times and reports whether the season looks like a real one:
 * how strongly wins track team quality (and, on real data, the real standings), how wide the win
 * totals spread, home-field edge, scoring, and ties. Nothing is written; the league state is never mutated.
 */
import type { EngineContext, LeagueState, TeamId } from '../src/contracts/index'
import { mockLeague } from '../tests/fixtures/mockLeague'
import {
  calibrate,
  makeCtx,
  type BoxSeasonStats,
  type CalibrationReport,
} from '../tests/engine/sim/harness'
import { loadRealContext, readManifest, realWinTotals, seasonsForNewGame } from './lib/publicData'

interface Args {
  mock: boolean
  sims: number
  season: number
  seed: string
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mock: false, sims: 500, season: 2021, seed: 'calibrate' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mock') args.mock = true
    else if (arg === '--sims') args.sims = Number(argv[++i])
    else if (arg === '--season') args.season = Number(argv[++i])
    else if (arg === '--seed') args.seed = String(argv[++i])
  }
  if (!argv.includes('--season')) args.mock = true
  return args
}

/** Box-score stats come from the first few seasons only; collecting all 500 costs runtime. */
const BOX_SIMS = 50

const CALIBRATION_SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

/** A league at week 0 of a real season, built by the real engine from the shipped data chunks. */
async function loadRealLeague(
  season: number,
  seed: string,
): Promise<{ state: LeagueState; ctx: EngineContext; realWins: Record<TeamId, number> | null }> {
  const manifest = readManifest()
  if (!manifest.seasons.includes(season))
    throw new Error(
      `season ${season} is not in app/public/data (have ${manifest.seasons[0]}–${manifest.latestRealSeason})`,
    )
  const ctx = await loadRealContext(seasonsForNewGame(season, manifest.latestRealSeason))
  // Calibration measures the sim from the real opening-day rosters.
  const state = ctx.modules.league.newGame(
    {
      seed,
      startSeason: season,
      userTeam: 'IND',
      horizonSeasons: 1,
      settings: CALIBRATION_SETTINGS,
      startAt: 'PRESEASON',
    },
    ctx,
  )
  return { state, ctx, realWins: realWinTotals(ctx.seasonData(season)!.schedule) }
}

function report(r: CalibrationReport, label: string): void {
  const rows: [string, string, string][] = [
    ['win corr (rating)', r.winCorrelation.toFixed(3), '>= 0.50'],
    [
      'win corr (real)',
      r.realWinCorrelation === null ? 'n/a' : r.realWinCorrelation.toFixed(3),
      '>= 0.50',
    ],
    ['sd of team wins', r.winSd.toFixed(2), '2.4 - 3.6'],
    ['home win %', r.homeWinPct.toFixed(1), '54 - 60'],
    ['mean total points', r.meanTotalPoints.toFixed(1), '41 - 49'],
    ['tie rate %', (100 * r.tieRate).toFixed(2), '< 1.0'],
    ['overtime rate %', (100 * r.overtimeRate).toFixed(2), '~ 6'],
    ['1-point games %', (100 * r.oneMarginRate).toFixed(2), '~ 2'],
    ['injuries / team-game', r.injuriesPerTeamGame.toFixed(2), '0.6 - 1.6'],
    ['multi-week / team-game', r.multiWeekInjuriesPerTeamGame.toFixed(2), '0.35 - 0.8'],
    ['truth fallbacks', String(r.truthFallbacks), '0'],
  ]
  console.log(`\n${label}: ${r.sims} seasons x ${r.teams} teams x ${r.gamesPerTeam} games`)
  console.log('-'.repeat(52))
  for (const [name, value, target] of rows) {
    console.log(`${name.padEnd(24)}${value.padStart(9)}   ${target}`)
  }
  console.log('-'.repeat(52))
  if (r.box) reportBox(r.box)
  console.log(`${'runtime (s)'.padEnd(24)}${r.seconds.toFixed(1).padStart(9)}   < 60\n`)
}

/** Targets are real 2015–2019 regular seasons. */
function reportBox(b: BoxSeasonStats): void {
  const rows: [string, string, string][] = [
    ['pass att / team-game', b.passAttPerTeamGame.toFixed(1), '33 - 36'],
    ['pass yds / team-game', b.passYdsPerTeamGame.toFixed(1), '230 - 255'],
    ['rush yds / team-game', b.rushYdsPerTeamGame.toFixed(1), '108 - 120'],
    ['1,000-yd rushers', b.rushers1000.toFixed(1), '6 - 11'],
    ['4,000-yd passers', b.passers4000.toFixed(1), '8 - 14'],
    ['1,000-yd receivers', b.receivers1000.toFixed(1), '18 - 25'],
    ['passing leader', b.passLeader.toFixed(0), '4500 - 5200'],
    ['rushing leader', b.rushLeader.toFixed(0), '1300 - 1600'],
    ['receiving leader', b.recLeader.toFixed(0), '1400 - 1950'],
    ['top receiver share', b.topReceiverShare.toFixed(3), '0.24 - 0.34'],
    ['top TE share', b.topTeShare.toFixed(3), '0.10 - 0.20'],
  ]
  console.log(`box scores (first ${b.seasons} seasons)`)
  for (const [name, value, target] of rows) {
    console.log(`${name.padEnd(24)}${value.padStart(9)}   ${target}`)
  }
  console.log('-'.repeat(52))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  try {
    if (args.mock) {
      const state = mockLeague({ seed: args.seed, season: args.season })
      report(
        calibrate({ sims: args.sims, seed: args.seed, state, ctx: makeCtx() }),
        `mock league ${args.season}`,
      )
      return
    }
    const { state, ctx, realWins } = await loadRealLeague(args.season, args.seed)
    report(
      calibrate({
        sims: args.sims,
        seed: args.seed,
        state,
        ctx,
        realWins: realWins ?? undefined,
        boxSims: BOX_SIMS,
      }),
      `real league ${args.season}`,
    )
  } catch (error) {
    console.error(`calibrate: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

void main()
