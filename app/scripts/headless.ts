/**
 * Headless integration harness (HANDOFF §7 Phase 2/4).
 *
 *   pnpm --filter app headless -- --team IND --start 2015 --seasons 1 [--seed x] [--no-injuries]
 *
 * New game on the shipped data → preseason → every week through the Super Bowl → standings, bracket and
 * the user's season, with roster/result/truth invariants checked along the way. With --seasons > 1 it
 * keeps going through the offseason and stops cleanly at the first module that is not built yet.
 */
import {
  DIVISIONS, NotImplementedError, TEAM_IDS, leagueFormat,
  type EngineContext, type GameResult, type LeagueState, type PlayoffBracket, type TeamId,
} from '../src/contracts/index'
import { truthFallbackCount, resetTruthFallbackCount } from '../src/engine/sim/index'
import { loadRealContext, readManifest, seasonsForNewGame } from './lib/publicData'

interface Args {
  team: TeamId
  start: number
  seasons: number
  seed: string
  injuries: boolean
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { team: 'IND', start: 2015, seasons: 1, seed: 'headless', injuries: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--team') args.team = String(argv[++i]).toUpperCase()
    else if (arg === '--start') args.start = Number(argv[++i])
    else if (arg === '--seasons') args.seasons = Number(argv[++i])
    else if (arg === '--seed') args.seed = String(argv[++i])
    else if (arg === '--no-injuries') args.injuries = false
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

function checkRosterInvariants(state: LeagueState, label: string): void {
  const seen = new Map<string, TeamId>()
  const freeAgents = new Set(state.freeAgents)
  for (const teamId of Object.keys(state.teams).sort()) {
    const team = state.teams[teamId]!
    check(team.roster.length >= 46 && team.roster.length <= 53, `${label}: ${teamId} roster has ${team.roster.length} players`)
    for (const slot of team.roster) {
      const other = seen.get(slot.playerId)
      check(other === undefined, `${label}: ${slot.playerId} is on both ${other} and ${teamId}`)
      check(!freeAgents.has(slot.playerId), `${label}: ${slot.playerId} is rostered by ${teamId} and a free agent`)
      check(state.players[slot.playerId] !== undefined, `${label}: ${slot.playerId} on ${teamId} is not in state.players`)
      seen.set(slot.playerId, teamId)
    }
  }
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

/** Offseason phases in order; the caller runs the draft between OFFSEASON_RESIGN and DRAFT (league conventions). */
function playOffseason(state: LeagueState, ctx: EngineContext): LeagueState {
  const { league, draft } = ctx.modules
  let s = league.advancePhase(state, ctx) // OFFSEASON_RESIGN → DRAFT
  s = draft.startDraft(s, ctx)
  s = draft.autoDraftToEnd(s, ctx)
  s = league.advancePhase(s, ctx) // DRAFT → UDFA
  s = league.advancePhase(s, ctx) // UDFA → FREE_AGENCY
  s = league.advancePhase(s, ctx) // FREE_AGENCY → TRAINING_CAMP
  s = league.advancePhase(s, ctx) // TRAINING_CAMP → PRESEASON (season + 1)
  return s
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
  checkRosterInvariants(state, 'newGame')

  for (let i = 0; i < args.seasons; i++) {
    const season = state.season
    const fmt = leagueFormat(season)
    resetTruthFallbackCount()
    try {
      state = ctx.modules.league.advancePhase(state, ctx) // PRESEASON → REGULAR
    } catch (err) {
      if (err instanceof NotImplementedError) {
        console.log(`\nstopped before ${season}: ${err.message} (lands in Phase 3/4)`)
        break
      }
      throw err
    }
    const played = playSeason(state, ctx)
    state = played.state

    console.log(`\n=== ${season} — ${played.weeks} weeks, ${played.injuries} weeks with injuries, ${played.offers} AI offers ===`)
    printStandings(state, ctx)
    console.log('\n  Playoffs')
    const bracket = ctx.modules.league.seedPlayoffs(state, ctx)
    printBracket(state, bracket)
    const summary = state.history[state.history.length - 1]
    console.log(`\n  ${args.team}: ${recordText(summary?.userRecord ?? { wins: 0, losses: 0, ties: 0 })}, playoffs: ${summary?.userPlayoffExit ?? '?'}`)
    printUserSeason(state)

    const seasonResults = state.results.filter((r) => r.gameId.startsWith(`${season}-`))
    const playoffGames = bracket.rounds.reduce((n, r) => n + r.games.length, 0)
    check(seasonResults.length === fmt.regularSeasonGames * 16 + playoffGames, `${season}: ${seasonResults.length} results for ${fmt.regularSeasonGames * 16 + playoffGames} games`)
    for (const teamId of TEAM_IDS) {
      const r = state.teams[teamId]!.record
      check(r.wins + r.losses + r.ties === fmt.regularSeasonGames, `${season}: ${teamId} played ${r.wins + r.losses + r.ties} regular-season games`)
    }
    check(bracket.champion !== null, `${season}: no champion`)
    check(state.phase === 'OFFSEASON_RESIGN', `${season}: phase after the Super Bowl is ${state.phase}`)
    check(truthFallbackCount() === 0, `${season}: ${truthFallbackCount()} truth fallbacks (a player had no true value this season)`)
    checkRosterInvariants(state, String(season))

    if (i < args.seasons - 1) {
      try {
        state = playOffseason(state, ctx)
        checkRosterInvariants(state, `${state.season} preseason`)
      } catch (err) {
        if (err instanceof NotImplementedError) {
          console.log(`\nstopped in the ${season} offseason: ${err.message} (lands in Phase 3/4)`)
          break
        }
        throw err
      }
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
