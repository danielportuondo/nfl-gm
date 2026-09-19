/**
 * Sim-constant sweeps and the 2016 correlation post-mortem (HANDOFF §6.3).
 *
 *   pnpm tsx scripts/qa/simSweep.ts [--sims 150] [--mode all|seasons|k|injuries|overtime]
 *
 * `seasons`   corr(team strength, real wins) for every shipped season. The sim reproduces its own
 *             ratings at r ≈ 0.98, so this correlation is a property of the RATINGS, not of any sim
 *             constant: whatever it is for a season is the ceiling the harness can report.
 * `k`         sd(wins) and correlation against `simConstants.k`.
 * `injuries`  total and multi-week injuries per team-game against `injuryConstants.rateScale`, plus
 *             the knock-on effect on sd(wins).
 * `overtime`  overtime rate and 1-point-game rate against `scoreConstants.otWindow` / `oneMarginFixP`.
 */
import { TEAM_IDS, type EngineContext, type LeagueState } from '../../src/contracts/index'
import { injuryConstants, scoreConstants, simConstants } from '../../src/engine/sim/constants'
import { calibrate } from '../../tests/engine/sim/harness'
import { loadRealContext, readManifest, realWinTotals, seasonsForNewGame } from '../lib/publicData'
import { DEFAULT_SETTINGS, mean, sd, table } from './lib'

interface Loaded {
  state: LeagueState
  ctx: EngineContext
  realWins: Record<string, number>
}

async function loadSeason(season: number, seed = 'sweep'): Promise<Loaded> {
  const manifest = readManifest()
  const ctx = await loadRealContext(seasonsForNewGame(season, manifest.latestRealSeason))
  const state = ctx.modules.league.newGame(
    { seed, startSeason: season, userTeam: 'IND', horizonSeasons: 1, settings: DEFAULT_SETTINGS },
    ctx,
  )
  return { state, ctx, realWins: realWinTotals(ctx.seasonData(season)!.schedule) ?? {} }
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length)
  const mx = mean(xs.slice(0, n))
  const my = mean(ys.slice(0, n))
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

async function seasonsMode(): Promise<void> {
  const manifest = readManifest()
  const rows: string[][] = [
    [
      'season',
      'corr(strength, real W)',
      'corr(mean consensus, real W)',
      'sd(strength)',
      'free agents',
      'rostered real',
    ],
  ]
  for (const season of manifest.seasons.filter((s) => s <= manifest.latestRealSeason - 1)) {
    const { state, ctx, realWins } = await loadSeason(season)
    const teams = TEAM_IDS.filter((t) => realWins[t] !== undefined)
    const strength = teams.map((t) => ctx.modules.sim.teamStrength(state, t, ctx).overall)
    const consensus = teams.map((t) =>
      mean(state.teams[t]!.roster.map((r) => state.scouting[r.playerId]?.ovr ?? 0)),
    )
    const real = teams.map((t) => realWins[t]!)
    rows.push([
      String(season),
      correlation(strength, real).toFixed(3),
      correlation(consensus, real).toFixed(3),
      sd(strength).toFixed(2),
      String(state.freeAgents.length),
      String(TEAM_IDS.reduce((n, t) => n + state.teams[t]!.roster.length, 0)),
    ])
  }
  console.log(
    '\ncorr(team strength, real wins) by season — the ceiling on what the sim can report\n',
  )
  console.log(table(rows))
}

async function kMode(sims: number): Promise<void> {
  const base = simConstants.k
  const rows: string[][] = [['k', 'season', 'sd(wins)', 'corr(rating)', 'corr(real)', 'home win %']]
  for (const season of [2015, 2023]) {
    const loaded = await loadSeason(season)
    for (const k of [2.5, 2.3, 2.1, 1.9]) {
      simConstants.k = k
      const r = calibrate({
        sims,
        seed: 'ksweep',
        state: loaded.state,
        ctx: loaded.ctx,
        realWins: loaded.realWins,
      })
      rows.push([
        k.toFixed(2),
        String(season),
        r.winSd.toFixed(2),
        r.winCorrelation.toFixed(3),
        (r.realWinCorrelation ?? 0).toFixed(3),
        r.homeWinPct.toFixed(1),
      ])
    }
  }
  simConstants.k = base
  console.log('\nsd(wins) against simConstants.k — §6.3 wants ≈ 3.0, harness band 2.4–3.6\n')
  console.log(table(rows))
}

async function injuriesMode(sims: number): Promise<void> {
  const base = injuryConstants.rateScale
  const loaded = await loadSeason(2015)
  const rows: string[][] = [
    ['rateScale', 'inj / team-game', 'multi-week / team-game', 'sd(wins)', 'corr(real)'],
  ]
  for (const scale of [2.8, 1.8, 1.7, 1.6, 1.5, 1.0]) {
    injuryConstants.rateScale = scale
    const r = calibrate({
      sims,
      seed: 'injsweep',
      state: loaded.state,
      ctx: loaded.ctx,
      realWins: loaded.realWins,
    })
    rows.push([
      scale.toFixed(1),
      r.injuriesPerTeamGame.toFixed(2),
      r.multiWeekInjuriesPerTeamGame.toFixed(2),
      r.winSd.toFixed(2),
      (r.realWinCorrelation ?? 0).toFixed(3),
    ])
  }
  injuryConstants.rateScale = base
  console.log(
    '\ninjuries against injuryConstants.rateScale (2015) — §6.3 wants 1.0–1.5 MULTI-WEEK per team-game\n',
  )
  console.log(table(rows))
}

async function overtimeMode(sims: number): Promise<void> {
  const baseWindow = scoreConstants.otWindow
  const baseFix = scoreConstants.oneMarginFixP
  const loaded = await loadSeason(2023)
  const rows: string[][] = [
    ['otWindow', 'oneMarginFixP', 'OT %', '1-pt games %', 'tie %', 'sd(wins)'],
  ]
  for (const [w, f] of [
    [1, 0.72],
    [1.15, 0.55],
    [1.25, 0.45],
    [1.35, 0.45],
    [1.25, 0.3],
  ] as const) {
    scoreConstants.otWindow = w
    scoreConstants.oneMarginFixP = f
    const r = calibrate({ sims, seed: 'otsweep', state: loaded.state, ctx: loaded.ctx })
    rows.push([
      w.toFixed(1),
      f.toFixed(2),
      (100 * r.overtimeRate).toFixed(2),
      (100 * r.oneMarginRate).toFixed(2),
      (100 * r.tieRate).toFixed(2),
      r.winSd.toFixed(2),
    ])
  }
  scoreConstants.otWindow = baseWindow
  scoreConstants.oneMarginFixP = baseFix
  console.log(
    '\novertime / 1-point games (2023) — real NFL is ≈ 6 % OT and ≈ 2 % one-point games\n',
  )
  console.log(table(rows))
}

async function main(): Promise<void> {
  let sims = 150
  let mode = 'all'
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sims') sims = Number(argv[++i])
    else if (argv[i] === '--mode') mode = String(argv[++i])
  }
  if (mode === 'all' || mode === 'seasons') await seasonsMode()
  if (mode === 'all' || mode === 'k') await kMode(sims)
  if (mode === 'all' || mode === 'injuries') await injuriesMode(sims)
  if (mode === 'all' || mode === 'overtime') await overtimeMode(sims)
  console.log('')
}

main().catch((err: unknown) => {
  console.error(`simSweep: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exitCode = 1
})
