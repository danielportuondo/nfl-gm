/**
 * engine/league — league state, season loop, standings, playoffs, schedule (docs/HANDOFF.md §6.1, §6.3).
 * Implements LeagueModule (contracts/engine/league.ts). The conductor: never simulates a game (sim),
 * never values a player (trade), never synthesizes a contract (fa), never changes a rating (lifecycle),
 * never snaps rosters (history) — all of that goes through ctx.modules.
 */
import {
  DIVISIONS, PHASES, POSITIONS, SAVE_SCHEMA_VERSION, STARTER_TEMPLATE, TEAM_IDS, canonicalTeamId,
  leagueFormat, isInHistory, SeasonNotLoadedError,
  type CanonicalTeamId, type CompactTrajectory, type Conference, type DepthChart, type EngineContext,
  type Game, type GameResult, type GameSettings, type GameType, type InjuryEvent, type LeagueModule,
  type LeagueState, type NewGameOptions, type Phase, type Player, type PlayerId, type PlayoffBracket,
  type PlayoffExit, type PlayoffFormat, type PlayoffSeed, type RosterSlot, type ScoutingView,
  type Season, type SeasonPlayer, type SeasonSummary, type StandingRow, type TeamId, type TeamState, type TeamStrength,
  type TrajectoryTable, type TrueTrajectory, type WeekReport,
} from '@contracts/index'
import { DIVISION_ROUND_TEMPLATE, DIVISION_ROUND_WEEKS } from './constants'

const EPOCH = '1970-01-01T00:00:00.000Z'
const ZERO_RECORD = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }

function teamDivision(teamId: TeamId): { conf: Conference; div: string } {
  const d = DIVISIONS[teamId as CanonicalTeamId]
  if (!d) throw new Error(`league: unknown team id "${teamId}"`)
  return d
}

// -------------------------------------------------------------------------------------------
// Player/roster construction (newGame)
// -------------------------------------------------------------------------------------------

function compactToTrajectory(compact: CompactTrajectory | undefined, season: Season, fallback: number): TrueTrajectory {
  if (!compact) return { bySeason: { [String(season)]: fallback }, retiresAfter: null }
  const bySeason: Record<string, number> = {}
  compact.values.forEach((v, i) => {
    if (v !== null) bySeason[String(compact.start + i)] = v
  })
  if (Object.keys(bySeason).length === 0) bySeason[String(season)] = fallback
  return { bySeason, retiresAfter: compact.retiresAfter }
}

function buildPlayersFromSeason(
  seasonPlayers: SeasonPlayer[],
  trajectories: TrajectoryTable,
  season: Season,
): { players: Record<PlayerId, Player>; scouting: Record<PlayerId, ScoutingView>; truth: Record<PlayerId, TrueTrajectory> } {
  const players: Record<PlayerId, Player> = {}
  const scouting: Record<PlayerId, ScoutingView> = {}
  const truth: Record<PlayerId, TrueTrajectory> = {}
  for (const sp of seasonPlayers) {
    const player: Player = {
      id: sp.id, name: sp.name, pos: sp.pos, birthYear: sp.birthYear, college: sp.college,
      heightIn: sp.heightIn, weightLb: sp.weightLb, draft: sp.draft, real: sp.real, rookieSeason: sp.rookieSeason,
    }
    players[player.id] = player
    scouting[player.id] = sp.scouting
    truth[player.id] = compactToTrajectory(trajectories[player.id], season, sp.trueValue)
  }
  return { players, scouting, truth }
}

function buildDepthChartFrom(roster: RosterSlot[], scouting: Record<PlayerId, ScoutingView>, players: Record<PlayerId, Player>): DepthChart {
  const chart: DepthChart = {}
  const injured = new Map(roster.map((r) => [r.playerId, Boolean(r.injured)]))
  for (const pos of POSITIONS) {
    const ids = roster.map((r) => r.playerId).filter((id) => players[id]?.pos === pos)
    ids.sort((a, b) => {
      const aHealthy = !injured.get(a)
      const bHealthy = !injured.get(b)
      if (aHealthy !== bHealthy) return aHealthy ? -1 : 1
      return (scouting[b]?.ovr ?? 0) - (scouting[a]?.ovr ?? 0)
    })
    chart[pos] = ids
  }
  return chart
}

function autoDepthChartImpl(state: LeagueState, teamId: TeamId): DepthChart {
  const team = state.teams[teamId]
  if (!team) throw new Error(`league.autoDepthChart: unknown team "${teamId}"`)
  const chart: DepthChart = {}
  for (const pos of POSITIONS) {
    const ids = team.roster.map((r) => r.playerId).filter((id) => state.players[id]?.pos === pos)
    ids.sort((a, b) => {
      const aHealthy = !team.roster.find((r) => r.playerId === a)?.injured
      const bHealthy = !team.roster.find((r) => r.playerId === b)?.injured
      if (aHealthy !== bHealthy) return aHealthy ? -1 : 1
      return (state.scouting[b]?.ovr ?? 0) - (state.scouting[a]?.ovr ?? 0)
    })
    chart[pos] = ids
  }
  return chart
}

// -------------------------------------------------------------------------------------------
// Cap fit
// -------------------------------------------------------------------------------------------

const CAP_FIT_TARGET = 0.97

/**
 * Real APY totals run past the cap in some seasons (proration, void years, 2021's COVID cap dip), and the
 * game charges apy as the cap hit. A roster that arrives from real data over the cap gets its veteran
 * deals scaled down together so payroll lands at 97% of the cap; rookie deals keep their slot value.
 * v1 simplification (HANDOFF §8): no restructures, so this stands in for them.
 */
function fitPayrollToCap(state: LeagueState, teamId: TeamId, ctx: EngineContext): LeagueState {
  const team = state.teams[teamId]
  if (!team) return state
  const cap = ctx.modules.fa.capFor(state.season, ctx)
  const payroll = ctx.modules.fa.payroll(state, teamId)
  if (payroll <= cap) return state
  const veteranSum = team.roster.reduce((sum, slot) => sum + (slot.contract.rookie ? 0 : slot.contract.apy), 0)
  if (veteranSum <= 0) return state
  const fixed = payroll - veteranSum
  const factor = Math.max(0, (cap * CAP_FIT_TARGET - fixed) / veteranSum)
  if (factor >= 1) return state
  const roster = team.roster.map((slot) =>
    slot.contract.rookie
      ? slot
      : { ...slot, contract: { ...slot.contract, apy: Math.round(slot.contract.apy * factor * 100) / 100 } },
  )
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster } } }
}

const AI_CAMP_ROSTER = 53

/**
 * An AI team that comes out of the offseason short (its expiring deals walked, it had no cap room in
 * free agency, and there is no real roster to snap to past the data) fills out with the best unsigned
 * players it can afford, starters-template positions first. Runs after cutdowns, before validation.
 */
function fillAiRosters(state: LeagueState, ctx: EngineContext): LeagueState {
  const { fa } = ctx.modules
  const short = TEAM_IDS.filter((id) => {
    const t = state.teams[id]
    return t !== undefined && !t.userControlled && t.roster.length < AI_CAMP_ROSTER
  })
  if (short.length === 0) return state

  let s = state
  const cap = fa.capFor(s.season, ctx)
  const minApy = fa.rookieContract(null, s.season, ctx).apy
  const pool = fa.freeAgentPool(s).filter((id) => s.players[id] !== undefined) // best consensus first
  const taken = new Set<PlayerId>()
  for (const teamId of short) {
    const team = s.teams[teamId]!
    const counts: Record<string, number> = {}
    for (const slot of team.roster) {
      const pos = s.players[slot.playerId]?.pos
      if (pos) counts[pos] = (counts[pos] ?? 0) + 1
    }
    const needs = (pos: string): boolean => (counts[pos] ?? 0) < (STARTER_TEMPLATE[pos] ?? 0)
    const open = pool.filter((id) => !taken.has(id))
    const candidates = [...open.filter((id) => needs(s.players[id]!.pos)), ...open.filter((id) => !needs(s.players[id]!.pos))]

    let roster = team.roster
    let payroll = fa.payroll(s, teamId)
    for (const id of candidates) {
      if (roster.length >= AI_CAMP_ROSTER || payroll + minApy > cap) break
      const contract = fa.synthesizeContract(s, id, s.season, ctx)
      if (payroll + contract.apy > cap) continue
      roster = [...roster, { playerId: id, teamId, contract }]
      payroll += contract.apy
      counts[s.players[id]!.pos] = (counts[s.players[id]!.pos] ?? 0) + 1
      taken.add(id)
    }
    if (roster.length !== team.roster.length) s = { ...s, teams: { ...s.teams, [teamId]: { ...team, roster } } }
  }
  if (taken.size === 0) return s
  return { ...s, freeAgents: s.freeAgents.filter((id) => !taken.has(id)) }
}

// -------------------------------------------------------------------------------------------
// Schedule
// -------------------------------------------------------------------------------------------

function makeGame(season: Season, week: number, type: GameType, home: TeamId, away: TeamId): Game {
  return { id: `${season}-${type}-${week}-${away}@${home}`, season, week, type, home, away }
}

function generateProceduralSchedule(state: LeagueState, ctx: EngineContext): Game[] {
  const season = state.season
  const fmt = leagueFormat(season)
  const games = fmt.regularSeasonGames
  const weeks = games + 1
  const rng = ctx.modules.rng.fromSeed(state.seed, season, 'schedule')

  const groups = new Map<string, TeamId[]>()
  for (const teamId of TEAM_IDS) {
    const d = teamDivision(teamId)
    const key = `${d.conf}-${d.div}`
    const arr = groups.get(key) ?? []
    arr.push(teamId)
    groups.set(key, arr)
  }

  const out: Game[] = []
  for (const [, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...members].sort()
    for (let w = 0; w < DIVISION_ROUND_WEEKS; w++) {
      for (const [hi, ai] of DIVISION_ROUND_TEMPLATE[w]!) {
        out.push(makeGame(season, w + 1, 'REG', sorted[hi]!, sorted[ai]!))
      }
    }
  }

  const remainingWeeksCount = weeks - DIVISION_ROUND_WEEKS
  const order = rng.shuffle(TEAM_IDS)
  const byeWeek = new Map<TeamId, number>()
  for (let j = 0; j < order.length / 2; j++) {
    const week = DIVISION_ROUND_WEEKS + 1 + (j % remainingWeeksCount)
    byeWeek.set(order[2 * j]!, week)
    byeWeek.set(order[2 * j + 1]!, week)
  }
  for (let w = DIVISION_ROUND_WEEKS + 1; w < DIVISION_ROUND_WEEKS + 1 + remainingWeeksCount; w++) {
    const playing = TEAM_IDS.filter((t) => byeWeek.get(t) !== w)
    const shuffled = rng.fork(`week:${w}`).shuffle(playing)
    for (let i = 0; i < shuffled.length; i += 2) {
      const a = shuffled[i]!
      const b = shuffled[i + 1]!
      const [home, away] = rng.chance(0.5) ? [a, b] : [b, a]
      out.push(makeGame(season, w, 'REG', home, away))
    }
  }
  return out
}

function buildScheduleImpl(state: LeagueState, ctx: EngineContext): Game[] {
  const season = state.season
  if (isInHistory(ctx, season)) {
    const sd = ctx.seasonData(season)
    if (!sd) throw new SeasonNotLoadedError(season)
    return sd.schedule.games
      .filter((g) => g.type === 'REG')
      .map((g) => {
        const home = canonicalTeamId(g.home)
        const away = canonicalTeamId(g.away)
        return makeGame(season, g.week, 'REG', home, away)
      })
  }
  return generateProceduralSchedule(state, ctx)
}

// -------------------------------------------------------------------------------------------
// Standings
// -------------------------------------------------------------------------------------------

function pct(r: { wins: number; losses: number; ties: number }): number {
  const total = r.wins + r.losses + r.ties
  return total === 0 ? 0 : (r.wins + 0.5 * r.ties) / total
}

/** In [-1, 1]: positive favors `a`. 0 when the teams haven't played this season. */
function headToHead(state: LeagueState, a: TeamId, b: TeamId): number {
  const gamesById = new Map(state.schedule.map((g) => [g.id, g]))
  let aWins = 0
  let total = 0
  for (const r of state.results) {
    const g = gamesById.get(r.gameId)
    if (!g || g.season !== state.season || g.type !== 'REG') continue
    const isPair = (g.home === a && g.away === b) || (g.home === b && g.away === a)
    if (!isPair) continue
    total += 1
    const homeWin = r.homeScore > r.awayScore
    const tie = r.homeScore === r.awayScore
    const aIsHome = g.home === a
    if (tie) aWins += 0.5
    else if ((aIsHome && homeWin) || (!aIsHome && !homeWin)) aWins += 1
  }
  return total === 0 ? 0 : (aWins / total - 0.5) * 2
}

function compareTeams(state: LeagueState, a: TeamId, b: TeamId): number {
  const ra = state.teams[a]?.record ?? ZERO_RECORD
  const rb = state.teams[b]?.record ?? ZERO_RECORD
  const pctDiff = pct(rb) - pct(ra)
  if (pctDiff !== 0) return pctDiff
  const h2h = headToHead(state, a, b)
  if (h2h !== 0) return -h2h
  const diffA = ra.pointsFor - ra.pointsAgainst
  const diffB = rb.pointsFor - rb.pointsAgainst
  if (diffA !== diffB) return diffB - diffA
  return a.localeCompare(b)
}

type ConfSeed = PlayoffSeed

function computeSeeds(state: LeagueState, _ctx: EngineContext, conf: Conference): ConfSeed[] {
  const fmt = leagueFormat(state.season)
  const perConf = fmt.playoffTeams / 2
  const confTeams: TeamId[] = TEAM_IDS.filter((t) => teamDivision(t).conf === conf)
  const byDivision = new Map<string, TeamId[]>()
  for (const t of confTeams) {
    const key = teamDivision(t).div
    const arr = byDivision.get(key) ?? []
    arr.push(t)
    byDivision.set(key, arr)
  }
  const winners: TeamId[] = []
  const rest: TeamId[] = []
  for (const [, members] of byDivision) {
    const sorted = [...members].sort((a, b) => compareTeams(state, a, b))
    winners.push(sorted[0]!)
    rest.push(...sorted.slice(1))
  }
  winners.sort((a, b) => compareTeams(state, a, b))
  rest.sort((a, b) => compareTeams(state, a, b))
  const wildcards = rest.slice(0, Math.max(0, perConf - winners.length))
  const ordered = [...winners, ...wildcards].slice(0, perConf)
  return ordered.map((teamId, i) => ({ teamId, conf, seed: i + 1 }))
}

function regularSeasonComplete(state: LeagueState): boolean {
  const resultIds = new Set(state.results.map((r) => r.gameId))
  const regGames = state.schedule.filter((g) => g.season === state.season && g.type === 'REG')
  return regGames.length > 0 && regGames.every((g) => resultIds.has(g.id))
}

function standingsImpl(state: LeagueState, ctx: EngineContext): StandingRow[] {
  const complete = regularSeasonComplete(state)
  const fmt = leagueFormat(state.season)
  const byTeam = new Map<TeamId, { seed: number; conf: Conference; bye: boolean } | null>()
  if (complete) {
    for (const conf of ['AFC', 'NFC'] as const) {
      for (const s of computeSeeds(state, ctx, conf)) byTeam.set(s.teamId, { seed: s.seed, conf, bye: s.seed <= fmt.byesPerConf })
    }
  }
  const rows: StandingRow[] = []
  for (const conf of ['AFC', 'NFC'] as const) {
    const confTeams: TeamId[] = TEAM_IDS.filter((t) => teamDivision(t).conf === conf)
    const confSorted = [...confTeams].sort((a, b) => compareTeams(state, a, b))
    const confRankOf = new Map<TeamId, number>(confSorted.map((t, i) => [t, i + 1]))
    const byDivision = new Map<string, TeamId[]>()
    for (const t of confTeams) {
      const key = teamDivision(t).div
      const arr = byDivision.get(key) ?? []
      arr.push(t)
      byDivision.set(key, arr)
    }
    for (const [, members] of byDivision) {
      const divSorted = [...members].sort((a, b) => compareTeams(state, a, b))
      divSorted.forEach((teamId, i) => {
        const record = state.teams[teamId]?.record ?? ZERO_RECORD
        const seedInfo = byTeam.get(teamId) ?? null
        let clinched: StandingRow['clinched'] = null
        if (complete) {
          if (seedInfo?.bye) clinched = 'BYE'
          else if (i === 0) clinched = 'DIV'
          else if (seedInfo) clinched = 'WC'
          else clinched = 'OUT'
        }
        rows.push({
          teamId,
          wins: record.wins, losses: record.losses, ties: record.ties,
          pct: pct(record),
          pointsFor: record.pointsFor, pointsAgainst: record.pointsAgainst,
          divRank: i + 1,
          confRank: confRankOf.get(teamId)!,
          clinched,
        })
      })
    }
  }
  return rows
}

// -------------------------------------------------------------------------------------------
// Playoffs
// -------------------------------------------------------------------------------------------

function pairSeeds(seeds: number[]): [number, number][] {
  const sorted = [...seeds].sort((a, b) => a - b)
  const pairs: [number, number][] = []
  for (let i = 0; i < sorted.length / 2; i++) pairs.push([sorted[i]!, sorted[sorted.length - 1 - i]!])
  return pairs
}

function winnerOf(state: LeagueState, gameId: string): TeamId | null {
  const game = state.schedule.find((g) => g.id === gameId)
  const result = state.results.find((r) => r.gameId === gameId)
  if (!game || !result) return null
  if (result.homeScore === result.awayScore) return game.home
  return result.homeScore > result.awayScore ? game.home : game.away
}

function buildBracketImpl(state: LeagueState, ctx: EngineContext): PlayoffBracket {
  const season = state.season
  const fmt = leagueFormat(season)
  const afc = computeSeeds(state, ctx, 'AFC')
  const nfc = computeSeeds(state, ctx, 'NFC')
  const seeds: PlayoffSeed[] = [...afc, ...nfc]
  const teamBySeed = new Map<string, TeamId>()
  for (const s of seeds) teamBySeed.set(`${s.conf}:${s.seed}`, s.teamId)

  const regWeeks = state.schedule.filter((g) => g.season === season && g.type === 'REG').map((g) => g.week)
  const lastRegWeek = regWeeks.length ? Math.max(...regWeeks) : 0
  const weekFor = (round: GameType): number => {
    const offset = round === 'WC' ? 1 : round === 'DIV' ? 2 : round === 'CONF' ? 3 : 4
    return lastRegWeek + offset
  }

  const rounds: { type: GameType; games: Game[] }[] = []
  const remainingByConf: Record<Conference, number[]> = {
    AFC: afc.map((s) => s.seed),
    NFC: nfc.map((s) => s.seed),
  }

  function roundGames(type: GameType, seedsThisRound: Record<Conference, number[]>): Game[] {
    const games: Game[] = []
    for (const conf of ['AFC', 'NFC'] as const) {
      for (const [better, worse] of pairSeeds(seedsThisRound[conf])) {
        const home = teamBySeed.get(`${conf}:${better}`)!
        const away = teamBySeed.get(`${conf}:${worse}`)!
        games.push(makeGame(season, weekFor(type), type, home, away))
      }
    }
    return games
  }

  // WC round: seeds beyond the bye line.
  const wcSeeds: Record<Conference, number[]> = {
    AFC: remainingByConf.AFC.filter((s) => s > fmt.byesPerConf),
    NFC: remainingByConf.NFC.filter((s) => s > fmt.byesPerConf),
  }
  const wcGames = roundGames('WC', wcSeeds)
  rounds.push({ type: 'WC', games: wcGames })
  if (!wcGames.every((g) => winnerOf(state, g.id) !== null)) return { season, seeds, rounds, champion: null }

  // DIV round: bye seeds + WC winners' seeds.
  const winnerSeed = (conf: Conference, game: Game): number => {
    const w = winnerOf(state, game.id)!
    return (conf === 'AFC' ? afc : nfc).find((s) => s.teamId === w)!.seed
  }
  const divSeeds: Record<Conference, number[]> = {
    AFC: [
      ...remainingByConf.AFC.filter((s) => s <= fmt.byesPerConf),
      ...wcGames.filter((g) => teamDivision(g.home).conf === 'AFC').map((g) => winnerSeed('AFC', g)),
    ],
    NFC: [
      ...remainingByConf.NFC.filter((s) => s <= fmt.byesPerConf),
      ...wcGames.filter((g) => teamDivision(g.home).conf === 'NFC').map((g) => winnerSeed('NFC', g)),
    ],
  }
  const divGames = roundGames('DIV', divSeeds)
  rounds.push({ type: 'DIV', games: divGames })
  if (!divGames.every((g) => winnerOf(state, g.id) !== null)) return { season, seeds, rounds, champion: null }

  // CONF round: DIV winners.
  const confSeeds: Record<Conference, number[]> = {
    AFC: divGames.filter((g) => teamDivision(g.home).conf === 'AFC').map((g) => winnerSeed('AFC', g)),
    NFC: divGames.filter((g) => teamDivision(g.home).conf === 'NFC').map((g) => winnerSeed('NFC', g)),
  }
  const confGames = roundGames('CONF', confSeeds)
  rounds.push({ type: 'CONF', games: confGames })
  if (!confGames.every((g) => winnerOf(state, g.id) !== null)) return { season, seeds, rounds, champion: null }

  // Super Bowl: the two conference champions.
  const afcChamp = winnerOf(state, confGames.find((g) => teamDivision(g.home).conf === 'AFC')!.id)!
  const nfcChamp = winnerOf(state, confGames.find((g) => teamDivision(g.home).conf === 'NFC')!.id)!
  const sbGame = { ...makeGame(season, weekFor('SB'), 'SB', afcChamp, nfcChamp), neutralSite: true }
  rounds.push({ type: 'SB', games: [sbGame] })
  const champion = winnerOf(state, sbGame.id)
  return { season, seeds, rounds, champion }
}

// -------------------------------------------------------------------------------------------
// Season summary
// -------------------------------------------------------------------------------------------

function computeUserExit(state: LeagueState, bracket: PlayoffBracket, champion: TeamId | null): PlayoffExit {
  if (champion === state.userTeam) return 'CHAMPION'
  const order: GameType[] = ['SB', 'CONF', 'DIV', 'WC']
  for (const type of order) {
    const round = bracket.rounds.find((r) => r.type === type)
    if (!round) continue
    const game = round.games.find((g) => g.home === state.userTeam || g.away === state.userTeam)
    if (game && state.results.some((r) => r.gameId === game.id)) {
      return type === 'SB' ? 'SB_LOSS' : (type as PlayoffExit)
    }
  }
  return 'MISSED'
}

function summarizeSeasonImpl(state: LeagueState, ctx: EngineContext): SeasonSummary {
  const rows = standingsImpl(state, ctx)
  const bracket = buildBracketImpl(state, ctx)
  const sbRound = bracket.rounds.find((r) => r.type === 'SB')
  const sbGame = sbRound?.games[0]
  let champion: TeamId | null = null
  let runnerUp: TeamId | null = null
  if (sbGame) {
    const winner = winnerOf(state, sbGame.id)
    if (winner) {
      champion = winner
      runnerUp = winner === sbGame.home ? sbGame.away : sbGame.home
    }
  }
  return {
    season: state.season,
    champion,
    runnerUp,
    standings: rows,
    awards: [],
    userTeam: state.userTeam,
    userRecord: state.teams[state.userTeam]?.record ?? ZERO_RECORD,
    userPlayoffExit: computeUserExit(state, bracket, champion),
  }
}

// -------------------------------------------------------------------------------------------
// simWeek
// -------------------------------------------------------------------------------------------

function applyRegResults(state: LeagueState, games: Game[], results: GameResult[]): LeagueState {
  let teams = state.teams
  games.forEach((g, i) => {
    if (g.type !== 'REG') return
    const r = results[i]!
    const home = teams[g.home]
    const away = teams[g.away]
    if (!home || !away) return
    const homeWin = r.homeScore > r.awayScore
    const tie = r.homeScore === r.awayScore
    teams = {
      ...teams,
      [g.home]: {
        ...home,
        record: {
          wins: home.record.wins + (homeWin ? 1 : 0),
          losses: home.record.losses + (!homeWin && !tie ? 1 : 0),
          ties: home.record.ties + (tie ? 1 : 0),
          pointsFor: home.record.pointsFor + r.homeScore,
          pointsAgainst: home.record.pointsAgainst + r.awayScore,
        },
      },
      [g.away]: {
        ...away,
        record: {
          wins: away.record.wins + (!homeWin && !tie ? 1 : 0),
          losses: away.record.losses + (homeWin ? 1 : 0),
          ties: away.record.ties + (tie ? 1 : 0),
          pointsFor: away.record.pointsFor + r.awayScore,
          pointsAgainst: away.record.pointsAgainst + r.homeScore,
        },
      },
    }
  })
  return { ...state, teams }
}

function simWeekImpl(state: LeagueState, ctx: EngineContext): WeekReport {
  if (state.phase !== 'REGULAR' && state.phase !== 'PLAYOFFS') {
    return { state, gamesPlayed: 0, events: [`simWeek: no-op — phase is ${state.phase}, not REGULAR/PLAYOFFS`] }
  }
  const gamesThisWeek = state.schedule.filter((g) => g.season === state.season && g.week === state.week)
  const events: string[] = []
  const results = gamesThisWeek.map((game) => {
    const rng = ctx.modules.sim.gameRng(state, game, ctx)
    const result = ctx.modules.sim.simulateGame(state, game, ctx, rng)
    if (result.injuries.length) events.push(`${game.away} @ ${game.home}: ${result.injuries.length} injury event(s)`)
    return result
  })

  let newState: LeagueState = { ...state, results: [...state.results, ...results] }
  newState = applyRegResults(newState, gamesThisWeek, results)

  const allInjuries: InjuryEvent[] = results.flatMap((r) => r.injuries)
  newState = ctx.modules.lifecycle.applyInjuryEvents(newState, allInjuries)
  const injuryRng = ctx.modules.rng.fromSeed(newState.seed, newState.season, newState.week, 'injuries')
  newState = ctx.modules.lifecycle.tickInjuries(newState, ctx, injuryRng)

  const tradeRng = ctx.modules.rng.fromSeed(newState.seed, newState.season, newState.week, 'aiOffers')
  const offers = ctx.modules.trade.generateAiOffers(newState, ctx, tradeRng, 'season')
  for (const o of offers) events.push(`AI trade offer from ${o.offer.teamId}`)

  const isPlayoffWeek = gamesThisWeek.some((g) => g.type !== 'REG')
  if (isPlayoffWeek) {
    const roundType = gamesThisWeek[0]!.type
    if (roundType === 'SB') {
      const summary = summarizeSeasonImpl(newState, ctx)
      newState = { ...newState, history: [...newState.history, summary], phase: 'OFFSEASON_RESIGN' }
      if (summary.champion === newState.userTeam) newState = { ...newState, outcome: 'CHAMPION' }
      else if (newState.season >= newState.horizonEnd) newState = { ...newState, outcome: 'HORIZON_EXPIRED' }
      events.push(`Super Bowl: ${summary.champion ?? '?'} defeats ${summary.runnerUp ?? '?'}`)
    } else {
      const nextType: GameType = roundType === 'WC' ? 'DIV' : roundType === 'DIV' ? 'CONF' : 'SB'
      const bracket = buildBracketImpl(newState, ctx)
      const nextRound = bracket.rounds.find((r) => r.type === nextType)
      if (nextRound && nextRound.games.length) {
        newState = { ...newState, schedule: [...newState.schedule, ...nextRound.games], week: nextRound.games[0]!.week }
      }
    }
  } else {
    const regWeeks = newState.schedule.filter((g) => g.season === newState.season && g.type === 'REG').map((g) => g.week)
    const lastRegWeek = regWeeks.length ? Math.max(...regWeeks) : 0
    if (newState.week >= lastRegWeek) {
      const bracket = buildBracketImpl(newState, ctx)
      const wcRound = bracket.rounds.find((r) => r.type === 'WC')!
      newState = { ...newState, schedule: [...newState.schedule, ...wcRound.games], phase: 'PLAYOFFS', week: wcRound.games[0]!.week }
      events.push('Regular season complete; playoffs begin.')
    } else {
      newState = { ...newState, week: newState.week + 1 }
    }
  }

  return { state: newState, gamesPlayed: gamesThisWeek.length, events }
}

// -------------------------------------------------------------------------------------------
// advancePhase
// -------------------------------------------------------------------------------------------

/** Records and trade annoyance (§6.5: "for the rest of the season") both start fresh each season. */
function resetSeasonCounters(teams: Record<TeamId, TeamState>): Record<TeamId, TeamState> {
  return Object.fromEntries(
    Object.entries(teams).map(([id, t]) => [id, { ...t, record: { ...ZERO_RECORD }, tradeAnnoyance: 0 }]),
  )
}

/**
 * The user's expiring players who were not re-signed during OFFSEASON_RESIGN hit the market with
 * everyone else's, so the AI can sign them in FREE_AGENCY. A contract signed this offseason (fa.resign
 * stamps signedSeason = season) is the re-signing itself and stays. No dead money, no divergence: this
 * is the natural end of a deal, same as fa.runAiResign's expireToFreeAgent for AI teams.
 */
function expireUserContracts(state: LeagueState): LeagueState {
  const team = state.teams[state.userTeam]
  if (!team) return state
  const expiring = team.roster
    .filter((slot) => slot.contract.years === 1 && slot.contract.signedSeason !== state.season)
    .map((slot) => slot.playerId)
  if (expiring.length === 0) return state
  const gone = new Set(expiring)
  return {
    ...state,
    teams: { ...state.teams, [state.userTeam]: { ...team, roster: team.roster.filter((r) => !gone.has(r.playerId)) } },
    freeAgents: [...new Set([...state.freeAgents, ...expiring])].sort(),
  }
}

/** Keep two drafts ahead in state.picks so trades can always deal next year's and the year after's picks. */
function ensureFuturePicks(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = state.season + 2
  if (state.picks.some((p) => p.season === season)) return state
  return { ...state, picks: [...state.picks, ...ctx.modules.draft.buildDraftOrder(state, season, ctx)] }
}

function advancePhaseImpl(state: LeagueState, ctx: EngineContext): LeagueState {
  switch (state.phase) {
    case 'REGULAR':
    case 'PLAYOFFS':
      throw new Error(`advancePhase: phase ${state.phase} advances week-by-week via simWeek, not advancePhase`)

    case 'OFFSEASON_RESIGN': {
      const rng = ctx.modules.rng.fromSeed(state.seed, state.season, 'resign')
      const s = expireUserContracts(ctx.modules.fa.runAiResign(state, ctx, rng))
      return { ...s, phase: 'DRAFT' }
    }

    case 'DRAFT': {
      if (state.draftRoom?.status !== 'COMPLETE') {
        throw new Error('advancePhase: cannot leave DRAFT until draftRoom.status is COMPLETE')
      }
      return { ...state, phase: 'UDFA' }
    }

    case 'UDFA': {
      const s = ctx.modules.draft.runUdfa(state, ctx, [])
      return { ...s, phase: 'FREE_AGENCY' }
    }

    case 'FREE_AGENCY': {
      const rng = ctx.modules.rng.fromSeed(state.seed, state.season, 'freeAgency')
      const s = ctx.modules.fa.runAiFreeAgency(state, ctx, rng)
      return { ...s, phase: 'TRAINING_CAMP' }
    }

    case 'TRAINING_CAMP': {
      const newSeason = state.season + 1
      let s: LeagueState = { ...state, season: newSeason, week: 0 }
      const rolled = ctx.modules.fa.rolloverContracts(s, ctx)
      s = rolled.state
      const progressRng = ctx.modules.rng.fromSeed(s.seed, newSeason, 'progress')
      s = ctx.modules.lifecycle.progressSeason(s, ctx, progressRng)
      const retireRng = ctx.modules.rng.fromSeed(s.seed, newSeason, 'retirements')
      const retired = ctx.modules.lifecycle.retirements(s, ctx, retireRng)
      s = retired.state
      s = ctx.modules.lifecycle.refreshScouting(s, ctx)
      if (isInHistory(ctx, newSeason)) {
        s = ctx.modules.history.snapToHistory(s, ctx)
        for (const teamId of TEAM_IDS) if (teamId !== s.userTeam) s = fitPayrollToCap(s, teamId, ctx)
      }
      s = { ...s, teams: resetSeasonCounters(s.teams) }
      s = ensureFuturePicks(s, ctx)
      const newGames = buildScheduleImpl(s, ctx)
      s = { ...s, schedule: [...s.schedule, ...newGames], phase: 'PRESEASON' }
      return s
    }

    case 'PRESEASON': {
      let s = fillAiRosters(ctx.modules.fa.runAiCutdowns(state, ctx), ctx)
      const updatedTeams: Record<TeamId, TeamState> = { ...s.teams }
      for (const teamId of Object.keys(updatedTeams)) {
        if (teamId === s.userTeam) continue
        updatedTeams[teamId] = { ...updatedTeams[teamId]!, depthChart: autoDepthChartImpl(s, teamId) }
      }
      s = { ...s, teams: updatedTeams }
      const problems: string[] = []
      for (const teamId of Object.keys(s.teams)) {
        const v = ctx.modules.fa.validateRoster(s, teamId, ctx)
        if (!v.ok) problems.push(`${teamId}: ${v.errors.join(', ') || 'invalid roster'}`)
      }
      if (problems.length) throw new Error(`advancePhase: invalid rosters — ${problems.join('; ')}`)
      return { ...s, phase: 'REGULAR', week: 1 }
    }

    default: {
      const _exhaustive: never = state.phase
      throw new Error(`advancePhase: unknown phase ${String(_exhaustive)}`)
    }
  }
}

// -------------------------------------------------------------------------------------------
// newGame
// -------------------------------------------------------------------------------------------

function newGameImpl(opts: NewGameOptions, ctx: EngineContext): LeagueState {
  const sd = ctx.seasonData(opts.startSeason)
  if (!sd) throw new SeasonNotLoadedError(opts.startSeason)

  const { players, scouting, truth } = buildPlayersFromSeason(sd.players.players, ctx.trajectories, opts.startSeason)

  let draft: LeagueState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: opts.seed,
    season: opts.startSeason,
    week: 0,
    phase: 'PRESEASON',
    userTeam: opts.userTeam,
    horizonEnd: opts.startSeason + opts.horizonSeasons - 1,
    startSeason: opts.startSeason,
    settings: opts.settings,
    teams: {},
    players, scouting, truth,
    picks: [],
    schedule: [], results: [], history: [],
    divergence: new Set<PlayerId>(),
    freeAgents: sd.players.players.filter((p) => p.team === null).map((p) => p.id),
    draftRoom: null, snapLog: [],
    outcome: 'IN_PROGRESS',
    savedAt: EPOCH,
  }

  const teams: Record<TeamId, TeamState> = {}
  for (const teamId of TEAM_IDS) {
    const entries = sd.rosters.rosters[teamId] ?? []
    const roster: RosterSlot[] = entries.map((e) => ({
      playerId: e.playerId,
      teamId,
      contract: ctx.modules.fa.synthesizeContract({ ...draft, teams }, e.playerId, opts.startSeason, ctx, { apy: e.apy, years: e.years }),
    }))
    teams[teamId] = {
      id: teamId,
      roster,
      depthChart: buildDepthChartFrom(roster, scouting, players),
      record: { ...ZERO_RECORD },
      deadMoney: 0,
      tradeAnnoyance: 0,
      userControlled: teamId === opts.userTeam,
    }
  }
  draft = { ...draft, teams }
  for (const teamId of TEAM_IDS) draft = fitPayrollToCap(draft, teamId, ctx)

  // The startSeason draft already happened (its rookies are on the rosters); the next two drafts are
  // the S+1 and S+2 classes (draft-year convention in contracts/engine/draft.ts).
  const picks = [
    ...ctx.modules.draft.buildDraftOrder(draft, opts.startSeason + 1, ctx),
    ...ctx.modules.draft.buildDraftOrder(draft, opts.startSeason + 2, ctx),
  ]
  draft = { ...draft, picks }

  const schedule = buildScheduleImpl(draft, ctx)
  draft = { ...draft, schedule }

  return draft
}

// -------------------------------------------------------------------------------------------
// Module
// -------------------------------------------------------------------------------------------

export const league: LeagueModule = {
  newGame: newGameImpl,
  simWeek: simWeekImpl,
  advancePhase: advancePhaseImpl,
  standings: standingsImpl,
  playoffFormat: (season: Season): PlayoffFormat => {
    const fmt = leagueFormat(season)
    return { teams: fmt.playoffTeams, byesPerConf: fmt.byesPerConf, regularSeasonGames: fmt.regularSeasonGames }
  },
  seedPlayoffs: buildBracketImpl,
  buildSchedule: buildScheduleImpl,
  autoDepthChart: autoDepthChartImpl,
  teamStrength: (state: LeagueState, teamId: TeamId, ctx: EngineContext): TeamStrength => ctx.modules.sim.teamStrength(state, teamId, ctx),
  summarizeSeason: summarizeSeasonImpl,
}

export { PHASES }
export type { Phase, GameSettings }
