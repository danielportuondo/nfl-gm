/**
 * Sim calibration harness (HANDOFF §6.3).
 *
 *   pnpm --filter app calibrate -- --mock --sims 500
 *   pnpm --filter app calibrate -- --season 2015          (Phase 2: real ratings)
 *
 * Simulates a full regular season N times and reports whether the season looks like a real one:
 * how strongly wins track team quality, how wide the win totals spread, home-field edge, scoring,
 * and ties. Nothing is written; the league state is never mutated.
 */
import type { LeagueState } from '../src/contracts/index'
import { mockLeague } from '../tests/fixtures/mockLeague'
import { calibrate, makeCtx, type CalibrationReport } from '../tests/engine/sim/harness'

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

/**
 * Phase 2 seam: build a league at week 0 of a real season from the shipped data chunks, so the harness
 * can be pointed at 2015 ratings and compared against the real standings. Until the data layer and
 * engine/league exist, only the mock league is available.
 */
function loadRealLeague(season: number): LeagueState {
  throw new Error(
    `--season ${season} needs real data: load app/public/data via @data loaders + league.newGame (Phase 2). Use --mock for now.`,
  )
}

function report(r: CalibrationReport, label: string): void {
  const rows: [string, string, string][] = [
    ['win correlation', r.winCorrelation.toFixed(3), '>= 0.50'],
    ['sd of team wins', r.winSd.toFixed(2), '2.4 - 3.6'],
    ['home win %', r.homeWinPct.toFixed(1), '54 - 60'],
    ['mean total points', r.meanTotalPoints.toFixed(1), '41 - 49'],
    ['tie rate %', (100 * r.tieRate).toFixed(2), '< 1.0'],
    ['overtime rate %', (100 * r.overtimeRate).toFixed(2), '~ 6'],
    ['1-point games %', (100 * r.oneMarginRate).toFixed(2), '~ 2'],
    ['injuries / team-game', r.injuriesPerTeamGame.toFixed(2), '0.6 - 1.6'],
    ['multi-week / team-game', r.multiWeekInjuriesPerTeamGame.toFixed(2), '0.6 - 1.6'],
    ['truth fallbacks', String(r.truthFallbacks), '0'],
  ]
  console.log(`\n${label}: ${r.sims} seasons x ${r.teams} teams x ${r.gamesPerTeam} games`)
  console.log('-'.repeat(52))
  for (const [name, value, target] of rows) {
    console.log(`${name.padEnd(24)}${value.padStart(9)}   ${target}`)
  }
  console.log('-'.repeat(52))
  console.log(`${'runtime (s)'.padEnd(24)}${r.seconds.toFixed(1).padStart(9)}   < 60\n`)
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))
  try {
    const state = args.mock ? mockLeague({ seed: args.seed, season: args.season }) : loadRealLeague(args.season)
    const label = args.mock ? `mock league ${args.season}` : `real league ${args.season}`
    report(calibrate({ sims: args.sims, seed: args.seed, state, ctx: makeCtx() }), label)
  } catch (error) {
    console.error(`calibrate: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

main()
