/**
 * Multi-season league-health probe (HANDOFF §6.3 sd-of-wins target, §6.7 lifecycle).
 *
 *   pnpm tsx scripts/qa/leagueHealth.ts [--team SEA] [--start 2023] [--seasons 5] [--seed x]
 *
 * Plays the same loop as scripts/headless.ts but reports the distributions the balance pass needs:
 * team strength spread (the direct driver of sd(wins) via margin = k·Δoverall), payroll, roster sizes,
 * retirements, the procedural share of rostered players, and the consensus grades of each rookie class.
 * The last two are what separates a historical season from a procedural one.
 */
import { TEAM_IDS, type EngineContext, type LeagueState, type PlayerId } from '../../src/contracts/index'
import { emptyLog, userCutdowns, userDraft, userFreeAgency, userResign } from '../lib/scriptedGm'
import { mean, newRealGame, quantile, sd, table } from './lib'

interface Args {
  team: string
  start: number
  seasons: number
  seed: string
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { team: 'SEA', start: 2023, seasons: 5, seed: 'health' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--team') args.team = String(argv[++i]).toUpperCase()
    else if (argv[i] === '--start') args.start = Number(argv[++i])
    else if (argv[i] === '--seasons') args.seasons = Number(argv[++i])
    else if (argv[i] === '--seed') args.seed = String(argv[++i])
  }
  return args
}

interface SeasonRow {
  season: number
  overallSd: number
  overallMean: number
  overallRange: string
  winSd: number
  payrollMean: number
  payrollSd: number
  deadMean: number
  rosterRange: string
  generatedShare: number
  retired: number
  rookieOvr: string
}

function strengthStats(state: LeagueState, ctx: EngineContext): { sd: number; mean: number; min: number; max: number } {
  const overalls = TEAM_IDS.map((t) => ctx.modules.sim.teamStrength(state, t, ctx).overall)
  return { sd: sd(overalls), mean: mean(overalls), min: Math.min(...overalls), max: Math.max(...overalls) }
}

function rookieGrades(state: LeagueState, season: number): string {
  const rookies = Object.keys(state.players)
    .filter((id) => state.players[id]!.rookieSeason === season)
    .map((id) => state.scouting[id]?.ovr ?? 0)
  if (rookies.length === 0) return 'n/a'
  return `n=${rookies.length} p10 ${quantile(rookies, 0.1).toFixed(0)} med ${quantile(rookies, 0.5).toFixed(0)} p90 ${quantile(rookies, 0.9).toFixed(0)}`
}

function rosteredIds(state: LeagueState): Set<PlayerId> {
  const out = new Set<PlayerId>()
  for (const t of TEAM_IDS) for (const slot of state.teams[t]!.roster) out.add(slot.playerId)
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const { state: initial, ctx } = await newRealGame({
    season: args.start,
    userTeam: args.team,
    seed: args.seed,
    seasons: args.seasons,
  })
  const { league, draft, fa } = ctx.modules
  let state = initial
  const rows: SeasonRow[] = []

  for (let i = 0; i < args.seasons; i++) {
    const season = state.season
    state = league.advancePhase(state, ctx) // PRESEASON -> REGULAR, rosters gated
    const strength = strengthStats(state, ctx)
    const beforeIds = rosteredIds(state)
    const payrolls = TEAM_IDS.map((t) => fa.payroll(state, t))
    const dead = TEAM_IDS.map((t) => state.teams[t]!.deadMoney)
    const sizes = TEAM_IDS.map((t) => state.teams[t]!.roster.length)
    const generated = TEAM_IDS.flatMap((t) => state.teams[t]!.roster).filter((r) => !state.players[r.playerId]?.real).length

    while (state.phase === 'REGULAR' || state.phase === 'PLAYOFFS') state = league.simWeek(state, ctx).state
    const wins = TEAM_IDS.map((t) => state.teams[t]!.record.wins)

    let retired = 0
    if (i < args.seasons - 1) {
      const log = emptyLog()
      state = userResign(state, ctx, log)
      state = league.advancePhase(state, ctx)
      state = draft.startDraft(state, ctx)
      state = userDraft(state, ctx, log)
      state = league.advancePhase(state, ctx)
      state = league.advancePhase(state, ctx)
      state = userFreeAgency(state, ctx, log)
      state = league.advancePhase(state, ctx)
      state = league.advancePhase(state, ctx) // TRAINING_CAMP -> PRESEASON (rollover, progression, retirements)
      state = userCutdowns(state, ctx, log)
      const after = rosteredIds(state)
      const stillAround = new Set([...after, ...state.freeAgents])
      retired = [...beforeIds].filter((id) => !stillAround.has(id)).length
    }

    rows.push({
      season,
      overallSd: strength.sd,
      overallMean: strength.mean,
      overallRange: `${strength.min.toFixed(1)}–${strength.max.toFixed(1)}`,
      winSd: sd(wins),
      payrollMean: mean(payrolls),
      payrollSd: sd(payrolls),
      deadMean: mean(dead),
      rosterRange: `${Math.min(...sizes)}–${Math.max(...sizes)}`,
      generatedShare: generated / Math.max(1, sizes.reduce((s, v) => s + v, 0)),
      retired,
      rookieOvr: rookieGrades(state, season + 1),
    })
  }

  console.log(`\nleague health — ${args.team} ${args.start}, ${args.seasons} seasons, seed "${args.seed}"\n`)
  console.log(
    table([
      ['season', 'sd(ovr)', 'mean ovr', 'ovr range', 'sd(wins)', 'payroll $M', 'sd(pay)', 'dead $M', 'rosters', 'gen %', 'retired', `rookie class (consensus ovr)`],
      ...rows.map((r) => [
        String(r.season),
        r.overallSd.toFixed(2),
        r.overallMean.toFixed(1),
        r.overallRange,
        r.winSd.toFixed(2),
        r.payrollMean.toFixed(0),
        r.payrollSd.toFixed(1),
        r.deadMean.toFixed(1),
        r.rosterRange,
        `${(100 * r.generatedShare).toFixed(0)}%`,
        String(r.retired),
        r.rookieOvr,
      ]),
    ]),
  )
  console.log('\n  sd(wins) ≈ f(k · sd(ovr)); §6.3 wants ≈ 3.0 over a 17-game season.\n')
}

main().catch((err: unknown) => {
  console.error(`leagueHealth: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exitCode = 1
})
