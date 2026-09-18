/**
 * Headless integration harness (HANDOFF §7 Phase 2/4).
 *
 *   pnpm --filter app headless -- --team IND --start 2012 --seasons 6 [--seed x] [--no-injuries] [--quiet]
 *
 * New game on the shipped data → preseason → every week through the Super Bowl → standings, bracket and
 * the user's season; then a scripted GM (scripts/lib/scriptedGm.ts) plays the user's offseason and the
 * loop repeats. Roster, cap, result, truth and history-anchoring invariants are checked along the way
 * and a per-season report is printed.
 */
import {
  DIVISIONS, TEAM_IDS, isInHistory, leagueFormat,
  type EngineContext, type GameResult, type LeagueState, type PlayoffBracket, type TeamId,
} from '../src/contracts/index'
import { truthFallbackCount, resetTruthFallbackCount } from '../src/engine/sim/index'
import { loadRealContext, readManifest, realWinTotals, seasonsForNewGame } from './lib/publicData'
import { emptyLog, userCutdowns, userDraft, userFreeAgency, userResign, type OffseasonLog } from './lib/scriptedGm'

interface Args {
  team: TeamId
  start: number
  seasons: number
  seed: string
  injuries: boolean
  quiet: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { team: 'IND', start: 2015, seasons: 1, seed: 'headless', injuries: true, quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--team') args.team = String(argv[++i]).toUpperCase()
    else if (arg === '--start') args.start = Number(argv[++i])
    else if (arg === '--seasons') args.seasons = Number(argv[++i])
    else if (arg === '--seed') args.seed = String(argv[++i])
    else if (arg === '--no-injuries') args.injuries = false
    else if (arg === '--quiet') args.quiet = true
  }
  if (!(TEAM_IDS as readonly string[]).includes(args.team)) throw new Error(`unknown team ${args.team}`)
  return args
}

const failures: string[] = []
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function recordText(r: { wins: number; losses: number; ties: number }): string {
  return r.ties ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`
}

/** Size/uniqueness always; cap and truth coverage only for teams the engine has gated (`teams`). */
function checkRosterInvariants(state: LeagueState, ctx: EngineContext, label: string, gated: readonly TeamId[] = TEAM_IDS): void {
  const seen = new Map<string, TeamId>()
  const freeAgents = new Set(state.freeAgents)
  const cap = ctx.modules.fa.capFor(state.season, ctx)
  const gatedSet = new Set(gated)
  const missingTruth: string[] = []
  for (const teamId of Object.keys(state.teams).sort()) {
    const team = state.teams[teamId]!
    check(team.roster.length >= 46 && team.roster.length <= 53, `${label}: ${teamId} roster has ${team.roster.length} players`)
    if (gatedSet.has(teamId)) {
      const pay = ctx.modules.fa.payroll(state, teamId)
      check(pay <= cap + 1e-6, `${label}: ${teamId} payroll $${pay.toFixed(2)}M over the $${cap.toFixed(2)}M cap`)
      for (const slot of team.roster) {
        if (state.truth[slot.playerId]?.bySeason[String(state.season)] === undefined) {
          missingTruth.push(`${nameOf(state, slot.playerId)} on ${teamId}${state.divergence.has(slot.playerId) ? ' [diverged]' : ''}`)
        }
      }
    }
    for (const slot of team.roster) {
      const other = seen.get(slot.playerId)
      check(other === undefined, `${label}: ${slot.playerId} is on both ${other} and ${teamId}`)
      check(!freeAgents.has(slot.playerId), `${label}: ${slot.playerId} is rostered by ${teamId} and a free agent`)
      check(state.players[slot.playerId] !== undefined, `${label}: ${slot.playerId} on ${teamId} is not in state.players`)
      seen.set(slot.playerId, teamId)
    }
  }
  check(missingTruth.length === 0, `${label}: ${missingTruth.length} rostered player(s) without a true value this season: ${missingTruth.slice(0, 6).join('; ')}`)
}

function printStandings(state: LeagueState, ctx: EngineContext): void {
  const rows = ctx.modules.league.standings(state, ctx)
  const byDivision = new Map<string, typeof rows>()
  for (const row of rows) {
    const d = DIVISIONS[row.teamId as keyof typeof DIVISIONS]
    const key = `${d.conf} ${d.div}`
    byDivision.set(key, [...(byDivision.get(key) ?? []), row])
  }
  for (const key of [...byDivision.keys()].sort()) {
    console.log(`\n  ${key}`)
    for (const row of [...byDivision.get(key)!].sort((a, b) => a.divRank - b.divRank)) {
      const mark = row.teamId === state.userTeam ? '*' : ' '
      const diff = row.pointsFor - row.pointsAgainst
      console.log(
        `  ${mark} ${row.teamId.padEnd(4)} ${recordText(row).padEnd(7)} ${String(row.pointsFor).padStart(4)} ${String(row.pointsAgainst).padStart(4)} ${(diff >= 0 ? '+' : '') + diff}`.padEnd(40) +
          `${row.clinched ?? ''}`,
      )
    }
  }
}

function scoreLine(state: LeagueState, gameId: string): string {
  const game = state.schedule.find((g) => g.id === gameId)
  const result = state.results.find((r) => r.gameId === gameId)
  if (!game || !result) return `${gameId}: (not played)`
  const ot = result.overtime ? ' (OT)' : ''
  return `${game.away} ${result.awayScore} @ ${game.home} ${result.homeScore}${ot}`
}

function printBracket(state: LeagueState, bracket: PlayoffBracket): void {
  for (const round of bracket.rounds) {
    console.log(`  ${round.type}: ${round.games.map((g) => scoreLine(state, g.id)).join('  |  ')}`)
  }
  console.log(`  Champion: ${bracket.champion ?? '(none)'}`)
}

function printUserSeason(state: LeagueState): void {
  const games = state.schedule
    .filter((g) => g.season === state.season && (g.home === state.userTeam || g.away === state.userTeam))
    .sort((a, b) => a.week - b.week)
  const byId = new Map<string, GameResult>(state.results.map((r) => [r.gameId, r]))
  const lines = games.map((g) => {
    const r = byId.get(g.id)
    if (!r) return `wk${g.week} ${g.type} —`
    const home = g.home === state.userTeam
    const us = home ? r.homeScore : r.awayScore
    const them = home ? r.awayScore : r.homeScore
    const tag = us > them ? 'W' : us < them ? 'L' : 'T'
    return `wk${g.week}${g.type === 'REG' ? '' : ` ${g.type}`} ${tag} ${us}-${them} ${home ? 'vs' : 'at'} ${home ? g.away : g.home}`
  })
  console.log(`  ${lines.join('\n  ')}`)
}

function playSeason(state: LeagueState, ctx: EngineContext): { state: LeagueState; weeks: number; injuries: number; offers: number } {
  let s = state
  let weeks = 0
  let injuries = 0
  let offers = 0
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
    const report = ctx.modules.league.simWeek(s, ctx)
    s = report.state
    weeks++
    injuries += report.events.filter((e) => e.includes('injury')).length
    offers += report.events.filter((e) => e.includes('trade offer')).length
    if (weeks > 30) throw new Error('simWeek did not finish the season in 30 weeks')
  }
  return { state: s, weeks, injuries, offers }
}

/**
 * The user's offseason, phase by phase, in the order the store drives it: the scripted GM acts inside
 * each phase and league.advancePhase runs the AI side and moves on.
 */
function playOffseason(state: LeagueState, ctx: EngineContext, log: OffseasonLog): LeagueState {
  const { league, draft } = ctx.modules
  let s = userResign(state, ctx, log)
  s = league.advancePhase(s, ctx) // OFFSEASON_RESIGN → DRAFT (AI re-signs; unsigned expiring walk)
  s = draft.startDraft(s, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx) // DRAFT → UDFA
  s = league.advancePhase(s, ctx) // UDFA → FREE_AGENCY (AI UDFA signings)
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx) // FREE_AGENCY → TRAINING_CAMP (AI free agency)
  s = league.advancePhase(s, ctx) // TRAINING_CAMP → PRESEASON (season + 1: rollover, progression, snap)
  s = userCutdowns(s, ctx, log)
  return s
}

function nameOf(state: LeagueState, id: string): string {
  const p = state.players[id]
  return p ? `${p.name} (${p.pos})` : id
}

/** Share of each AI team's real opening-day roster that is on that team in-game; in-history only. */
function historyOverlap(state: LeagueState, ctx: EngineContext): { mean: number; min: number; minTeam: TeamId } | null {
  if (!isInHistory(ctx, state.season)) return null
  const sd = ctx.seasonData(state.season)
  if (!sd) return null
  let sum = 0
  let n = 0
  let min = 1
  let minTeam: TeamId = state.userTeam
  for (const teamId of TEAM_IDS) {
    if (teamId === state.userTeam) continue
    const real = new Set((sd.rosters.rosters[teamId] ?? []).map((e) => e.playerId))
    if (real.size === 0) continue
    const have = state.teams[teamId]!.roster.filter((r) => real.has(r.playerId)).length
    const share = have / real.size
    sum += share
    n++
    if (share < min) {
      min = share
      minTeam = teamId
    }
  }
  return n ? { mean: sum / n, min, minTeam } : null
}

function winCorrelation(state: LeagueState, ctx: EngineContext): number | null {
  if (!isInHistory(ctx, state.season)) return null
  const sd = ctx.seasonData(state.season)
  const real = sd ? realWinTotals(sd.schedule) : null
  if (!real) return null
  const xs: number[] = []
  const ys: number[] = []
  for (const teamId of TEAM_IDS) {
    const r = real[teamId]
    if (r === undefined) continue
    xs.push(r)
    ys.push(state.teams[teamId]!.record.wins + 0.5 * state.teams[teamId]!.record.ties)
  }
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
  const mx = mean(xs)
  const my = mean(ys)
  let cov = 0
  let vx = 0
  let vy = 0
  xs.forEach((x, i) => {
    cov += (x - mx) * (ys[i]! - my)
    vx += (x - mx) ** 2
    vy += (ys[i]! - my) ** 2
  })
  return vx && vy ? cov / Math.sqrt(vx * vy) : null
}

function sdOfWins(state: LeagueState): number {
  const wins = TEAM_IDS.map((t) => state.teams[t]!.record.wins)
  const mean = wins.reduce((s, v) => s + v, 0) / wins.length
  return Math.sqrt(wins.reduce((s, v) => s + (v - mean) ** 2, 0) / wins.length)
}

function seasonReport(state: LeagueState, ctx: EngineContext, season: number, offseason: OffseasonLog | null): void {
  const { fa } = ctx.modules
  const user = state.teams[state.userTeam]!
  const summary = state.history[state.history.length - 1]
  const cap = fa.capFor(season, ctx)
  const real = user.roster.filter((r) => state.players[r.playerId]?.real).length
  const generated = user.roster.length - real
  const allRostered = TEAM_IDS.flatMap((t) => state.teams[t]!.roster.map((r) => r.playerId))
  const generatedLeague = allRostered.filter((id) => !state.players[id]?.real).length
  const inHistory = isInHistory(ctx, season)
  const overlap = historyOverlap(state, ctx)
  const corr = winCorrelation(state, ctx)
  const snaps = state.snapLog.filter((e) => e.season === season)
  const byReason = new Map<string, number>()
  for (const e of snaps) byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1)

  console.log(`\n  --- ${season} report (${inHistory ? 'in history' : 'past data'}) ---`)
  console.log(
    `  ${state.userTeam}: ${recordText(summary?.userRecord ?? { wins: 0, losses: 0, ties: 0 })}, playoffs ${summary?.userPlayoffExit ?? '?'}; ` +
      `roster ${user.roster.length} (${real} real, ${generated} generated), payroll $${fa.payroll(state, state.userTeam).toFixed(1)}M / cap $${cap.toFixed(1)}M, dead $${user.deadMoney.toFixed(1)}M`,
  )
  console.log(
    `  league: sd(wins) ${sdOfWins(state).toFixed(2)}${corr !== null ? `, corr with real wins ${corr.toFixed(2)}` : ''}; ` +
      `${generatedLeague} generated players rostered; ${state.divergence.size} diverged; ${state.freeAgents.length} free agents`,
  )
  if (overlap) console.log(`  history: AI rosters match real opening-day rosters ${(overlap.mean * 100).toFixed(0)}% on average (min ${(overlap.min * 100).toFixed(0)}% ${overlap.minTeam})`)
  if (snaps.length) console.log(`  snap: ${[...byReason.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`)
  if (offseason) {
    const picks = offseason.drafted.map((d) => `R${d.round}#${d.pick} ${nameOf(state, d.playerId)}`).join(', ')
    console.log(
      `  offseason: re-signed ${offseason.resigned.length}, let go ${offseason.expired.length}, drafted ${offseason.drafted.length}, ` +
        `signed ${offseason.signed.length} (${offseason.faOffers} offers to a pool of ${offseason.faPool}), cut ${offseason.cut.length}`,
    )
    if (picks) console.log(`  drafted: ${picks}`)
    if (offseason.resigned.length) console.log(`  re-signed: ${offseason.resigned.map((id) => nameOf(state, id)).join(', ')}`)
    if (offseason.signed.length) console.log(`  signed: ${offseason.signed.slice(0, 8).map((id) => nameOf(state, id)).join(', ')}${offseason.signed.length > 8 ? ', …' : ''}`)
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const manifest = readManifest()
  if (!manifest.seasons.includes(args.start)) throw new Error(`season ${args.start} is not in app/public/data`)
  const started = performance.now()

  const wanted = new Set<number>()
  for (let s = args.start; s < args.start + args.seasons; s++) for (const x of seasonsForNewGame(s, manifest.latestRealSeason)) wanted.add(x)
  const ctx = await loadRealContext([...wanted].sort((a, b) => a - b))
  const loadedAt = performance.now()

  const settings = { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: args.injuries } as const
  let state = ctx.modules.league.newGame(
    { seed: args.seed, startSeason: args.start, userTeam: args.team, horizonSeasons: args.seasons, settings },
    ctx,
  )
  const rosterSizes = Object.values(state.teams).map((t) => t.roster.length)
  console.log(
    `new game: ${args.team} ${args.start}, horizon ${args.seasons}, seed "${args.seed}" — ` +
      `${Object.keys(state.players).length} players, ${state.freeAgents.length} free agents, ` +
      `rosters ${Math.min(...rosterSizes)}–${Math.max(...rosterSizes)}, ${state.picks.length} picks owned, ` +
      `${state.schedule.length} games scheduled (data loaded in ${((loadedAt - started) / 1000).toFixed(1)}s)`,
  )
  checkRosterInvariants(state, ctx, 'newGame', [])

  let offseason: OffseasonLog | null = null
  for (let i = 0; i < args.seasons; i++) {
    const season = state.season
    const fmt = leagueFormat(season)
    resetTruthFallbackCount()
    state = ctx.modules.league.advancePhase(state, ctx) // PRESEASON → REGULAR (AI cutdowns, then every roster validated)
    checkRosterInvariants(state, ctx, `${season} opening day`)
    const played = playSeason(state, ctx)
    state = played.state

    console.log(`\n=== ${season} — ${played.weeks} weeks, ${played.injuries} weeks with injuries, ${played.offers} AI offers ===`)
    const bracket = ctx.modules.league.seedPlayoffs(state, ctx)
    if (!args.quiet) {
      printStandings(state, ctx)
      console.log('\n  Playoffs')
      printBracket(state, bracket)
      console.log('')
      printUserSeason(state)
    } else {
      console.log(`  Champion: ${bracket.champion ?? '(none)'}`)
    }
    seasonReport(state, ctx, season, offseason)

    const seasonResults = state.results.filter((r) => r.gameId.startsWith(`${season}-`))
    const regGames = state.schedule.filter((g) => g.season === season && g.type === 'REG')
    const playoffGames = bracket.rounds.reduce((n, r) => n + r.games.length, 0)
    check(seasonResults.length === regGames.length + playoffGames, `${season}: ${seasonResults.length} results for ${regGames.length + playoffGames} games`)
    // A real schedule can be one game short (2022's cancelled BUF–CIN game); every scheduled game must be played.
    check(regGames.length >= fmt.regularSeasonGames * 16 - 1, `${season}: only ${regGames.length} regular-season games scheduled`)
    for (const teamId of TEAM_IDS) {
      const r = state.teams[teamId]!.record
      const scheduled = regGames.filter((g) => g.home === teamId || g.away === teamId).length
      check(r.wins + r.losses + r.ties === scheduled, `${season}: ${teamId} played ${r.wins + r.losses + r.ties} of ${scheduled} regular-season games`)
    }
    check(bracket.champion !== null, `${season}: no champion`)
    check(state.phase === 'OFFSEASON_RESIGN', `${season}: phase after the Super Bowl is ${state.phase}`)
    check(truthFallbackCount() === 0, `${season}: ${truthFallbackCount()} truth fallbacks (a player had no true value this season)`)
    checkRosterInvariants(state, ctx, String(season))
    const overlap = historyOverlap(state, ctx)
    if (overlap) check(overlap.mean >= 0.75, `${season}: AI rosters only ${(overlap.mean * 100).toFixed(0)}% anchored to real rosters`)
    if (!isInHistory(ctx, season)) {
      const generated = TEAM_IDS.flatMap((t) => state.teams[t]!.roster).filter((r) => !state.players[r.playerId]?.real).length
      check(generated > 0, `${season}: past the data but no procedural players are rostered`)
    }

    if (i < args.seasons - 1) {
      offseason = emptyLog()
      state = playOffseason(state, ctx, offseason)
      // AI teams are still at camp size here; the user's team must already be legal.
      const user = state.teams[state.userTeam]!
      check(user.roster.length >= 46 && user.roster.length <= 53, `${state.season} preseason: user roster has ${user.roster.length} players`)
      check(ctx.modules.fa.validateRoster(state, state.userTeam, ctx).ok, `${state.season} preseason: user roster invalid — ${ctx.modules.fa.validateRoster(state, state.userTeam, ctx).errors.join(', ')}`)
    }
  }

  console.log(`\nfinal: season ${state.season}, phase ${state.phase}, outcome ${state.outcome}, runtime ${((performance.now() - started) / 1000).toFixed(1)}s`)
  if (failures.length) {
    console.error(`\n${failures.length} invariant failure(s):\n  ${failures.slice(0, 20).join('\n  ')}`)
    process.exitCode = 1
  } else {
    console.log('invariants: ok')
  }
}

main().catch((err: unknown) => {
  console.error(`headless: ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
  process.exitCode = 1
})
