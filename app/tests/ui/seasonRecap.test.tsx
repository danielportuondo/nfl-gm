// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type {
  Award,
  Game,
  GameResult,
  GameType,
  LeagueState,
  PlayoffBracket,
  SeasonSummary,
  StandingRow,
} from '@contracts/index'
import { DIVISIONS, TEAM_IDS } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { SeasonRecap } from '@screens/SeasonRecap'
import { buildBracketTree } from '@screens/SeasonRecap/bracketTree'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

const AFC_TEAMS = TEAM_IDS.filter((t) => DIVISIONS[t].conf === 'AFC')
const NFC_TEAMS = TEAM_IDS.filter((t) => DIVISIONS[t].conf === 'NFC')

function makeGame(
  id: string,
  season: number,
  week: number,
  type: GameType,
  home: string,
  away: string,
): Game {
  return { id, season, week, type, home, away }
}

function makeResult(gameId: string, homeScore: number, awayScore: number): GameResult {
  return { gameId, homeScore, awayScore, overtime: false, injuries: [] }
}

interface ConferenceFixture {
  seeds: { teamId: string; conf: 'AFC' | 'NFC'; seed: number }[]
  games: Game[]
  results: GameResult[]
  champion: string
  /** WC-column leaves in seed-ascending order, for asserting DOM order against. */
  leaves: string[]
}

/** Builds one conference's postseason (byes + WC + DIV + CONF) from an ordered seed list. */
function buildConferenceFixture(
  conf: 'AFC' | 'NFC',
  seedTeams: string[],
  season: number,
): ConferenceFixture {
  const seeds = seedTeams.map((teamId, i) => ({ teamId, conf, seed: i + 1 }))
  const byes = seedTeams.length === 7 ? 1 : 2
  const wcSeeds = seedTeams.slice(byes)
  const games: Game[] = []
  const results: GameResult[] = []
  const wcWinners: string[] = []
  const half = wcSeeds.length / 2
  for (let i = 0; i < half; i++) {
    const better = wcSeeds[i]!
    const worse = wcSeeds[wcSeeds.length - 1 - i]!
    const id = `${season}-WC-19-${worse}@${better}`
    games.push(makeGame(id, season, 19, 'WC', better, worse))
    results.push(makeResult(id, 24, 17))
    wcWinners.push(better)
  }
  const byeTeams = seedTeams.slice(0, byes)
  const leaves = [...byeTeams, ...wcWinners]

  const div0Teams: [string, string] = [leaves[0]!, leaves[1]!]
  const div1Teams: [string, string] = [leaves[2]!, leaves[3]!]
  const div0Id = `${season}-DIV-20-${div0Teams[1]}@${div0Teams[0]}`
  games.push(makeGame(div0Id, season, 20, 'DIV', div0Teams[0], div0Teams[1]))
  results.push(makeResult(div0Id, 24, 17))
  const div1Id = `${season}-DIV-20-${div1Teams[1]}@${div1Teams[0]}`
  games.push(makeGame(div1Id, season, 20, 'DIV', div1Teams[0], div1Teams[1]))
  results.push(makeResult(div1Id, 24, 17))
  const div0Winner = div0Teams[0]!
  const div1Winner = div1Teams[0]!

  const confId = `${season}-CONF-21-${div1Winner}@${div0Winner}`
  games.push(makeGame(confId, season, 21, 'CONF', div0Winner, div1Winner))
  results.push(makeResult(confId, 27, 20))

  return { seeds, games, results, champion: div0Winner, leaves }
}

function buildBracketFixture(
  season: number,
  afcTeams: string[],
  nfcTeams: string[],
): {
  bracket: PlayoffBracket
  games: Game[]
  results: GameResult[]
  afc: ConferenceFixture
  nfc: ConferenceFixture
} {
  const afc = buildConferenceFixture('AFC', afcTeams, season)
  const nfc = buildConferenceFixture('NFC', nfcTeams, season)
  const sbId = `${season}-SB-22-${nfc.champion}@${afc.champion}`
  const sbGame = makeGame(sbId, season, 22, 'SB', afc.champion, nfc.champion)
  const sbResult = makeResult(sbId, 27, 20)
  const games = [...afc.games, ...nfc.games, sbGame]
  const results = [...afc.results, ...nfc.results, sbResult]
  const bracket: PlayoffBracket = {
    season,
    seeds: [...afc.seeds, ...nfc.seeds],
    rounds: [
      { type: 'WC', games: games.filter((g) => g.type === 'WC') },
      { type: 'DIV', games: games.filter((g) => g.type === 'DIV') },
      { type: 'CONF', games: games.filter((g) => g.type === 'CONF') },
      { type: 'SB', games: [sbGame] },
    ],
    champion: afc.champion,
  }
  return { bracket, games, results, afc, nfc }
}

/**
 * A 14-seed AFC bracket where reseeding crosses naive seed-adjacency: seed 6 upsets seed 3 in the
 * wild card round, so the 1 seed's divisional opponent is the winner of the 3v6 game, not 2v7.
 */
function buildCrossedAfcFixture(season: number, teams: string[]): ConferenceFixture {
  const [s1, s2, s3, s4, s5, s6, s7] = teams
  const seeds = teams.map((teamId, i) => ({ teamId, conf: 'AFC' as const, seed: i + 1 }))
  const games: Game[] = []
  const results: GameResult[] = []

  const wc27 = `${season}-WC-19-${s7}@${s2}`
  games.push(makeGame(wc27, season, 19, 'WC', s2!, s7!))
  results.push(makeResult(wc27, 24, 17)) // seed 2 wins

  const wc36 = `${season}-WC-19-${s6}@${s3}`
  games.push(makeGame(wc36, season, 19, 'WC', s3!, s6!))
  results.push(makeResult(wc36, 17, 24)) // seed 6 upsets seed 3 (away wins)

  const wc45 = `${season}-WC-19-${s5}@${s4}`
  games.push(makeGame(wc45, season, 19, 'WC', s4!, s5!))
  results.push(makeResult(wc45, 24, 17)) // seed 4 wins

  // Reseeding: the 1 seed hosts the lowest remaining seed (6); the other two winners (2, 4) meet.
  const divA = `${season}-DIV-20-${s6}@${s1}`
  games.push(makeGame(divA, season, 20, 'DIV', s1!, s6!))
  results.push(makeResult(divA, 24, 17)) // seed 1 wins

  const divB = `${season}-DIV-20-${s4}@${s2}`
  games.push(makeGame(divB, season, 20, 'DIV', s2!, s4!))
  results.push(makeResult(divB, 24, 17)) // seed 2 wins

  const conf = `${season}-CONF-21-${s2}@${s1}`
  games.push(makeGame(conf, season, 21, 'CONF', s1!, s2!))
  results.push(makeResult(conf, 27, 20)) // seed 1 wins

  return { seeds, games, results, champion: s1!, leaves: [s1!, s6!, s2!, s4!] }
}

function fixtureStandings(): StandingRow[] {
  return TEAM_IDS.map((teamId, i) => ({
    teamId,
    wins: 16 - (i % 16),
    losses: i % 16,
    ties: 0,
    pct: (16 - (i % 16)) / 16,
    pointsFor: 380,
    pointsAgainst: 320,
    divRank: (i % 4) + 1,
    confRank: (i % 16) + 1,
    clinched: null,
  }))
}

function buildSummary(
  state: LeagueState,
  season: number,
  bracket: PlayoffBracket | undefined,
  awards: Award[],
): SeasonSummary {
  return {
    season,
    champion: bracket?.champion ?? null,
    runnerUp: null,
    standings: fixtureStandings(),
    awards,
    bracket,
    userTeam: state.userTeam,
    userRecord: state.teams[state.userTeam]!.record,
    userPlayoffExit: 'MISSED',
  }
}

describe('SeasonRecap playoff bracket', () => {
  it('renders round headers, the champion in the Super Bowl cell, and two byes for a 14-seed bracket', () => {
    const state = mockLeague()
    const data = mockStatic()
    const { bracket, games, results } = buildBracketFixture(
      2021,
      AFC_TEAMS.slice(0, 7),
      NFC_TEAMS.slice(0, 7),
    )
    const summary = buildSummary(state, 2021, bracket, [])
    const withHistory: LeagueState = {
      ...state,
      schedule: [...state.schedule, ...games],
      results: [...state.results, ...results],
      history: [summary],
    }

    const { container } = render(<SeasonRecap state={withHistory} data={data} />)

    for (const label of ['Wild card', 'Divisional', 'Conference', 'Super Bowl']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Bye')).toHaveLength(2)

    const sbCard = container.querySelector('.gg-bracket__card--root')
    expect(sbCard).not.toBeNull()
    expect(sbCard!.textContent).toContain(data.teams[bracket.champion!]!.abbr)
  })

  it('renders four byes for a 12-seed (2015-style) bracket', () => {
    const state = mockLeague()
    const data = mockStatic()
    const { bracket, games, results } = buildBracketFixture(
      2015,
      AFC_TEAMS.slice(0, 6),
      NFC_TEAMS.slice(0, 6),
    )
    const summary = buildSummary(state, 2015, bracket, [])
    const withHistory: LeagueState = {
      ...state,
      schedule: [...state.schedule, ...games],
      results: [...state.results, ...results],
      history: [summary],
    }

    render(<SeasonRecap state={withHistory} data={data} />)
    expect(screen.getAllByText('Bye')).toHaveLength(4)
  })

  it('orders each conference so divisional games are preceded by their two feeders', () => {
    const state = mockLeague()
    const data = mockStatic()
    const afcTeams = AFC_TEAMS.slice(0, 7)
    const { bracket, games, results, afc } = buildBracketFixture(
      2021,
      afcTeams,
      NFC_TEAMS.slice(0, 7),
    )
    const summary = buildSummary(state, 2021, bracket, [])
    const withHistory: LeagueState = {
      ...state,
      schedule: [...state.schedule, ...games],
      results: [...state.results, ...results],
      history: [summary],
    }

    const { container } = render(<SeasonRecap state={withHistory} data={data} />)
    const cells = Array.from(container.querySelectorAll('.gg-bracket__cell'))
    // AFC occupies the first 7 cells in DOM order: leaf0, leaf1, div0, leaf2, leaf3, div1, conf.
    const afcCells = cells.slice(0, 7)
    const abbr = (teamId: string) => data.teams[teamId]!.abbr

    expect(afcCells[0]!.textContent).toContain(abbr(afc.leaves[0]!))
    expect(afcCells[0]!.textContent).toContain('Bye')
    expect(afcCells[1]!.textContent).toContain(abbr(afc.leaves[1]!))
    // div0 (index 2) is preceded by both of its feeders (leaves 0 and 1).
    expect(afcCells[2]!.textContent).toContain(abbr(afc.leaves[0]!))
    expect(afcCells[2]!.textContent).toContain(abbr(afc.leaves[1]!))
    expect(afcCells[3]!.textContent).toContain(abbr(afc.leaves[2]!))
    expect(afcCells[4]!.textContent).toContain(abbr(afc.leaves[3]!))
    // div1 (index 5) is preceded by both of its feeders (leaves 2 and 3).
    expect(afcCells[5]!.textContent).toContain(abbr(afc.leaves[2]!))
    expect(afcCells[5]!.textContent).toContain(abbr(afc.leaves[3]!))
    // conf (index 6) is preceded by both divisional winners.
    expect(afcCells[6]!.textContent).toContain(abbr(afc.champion))
  })

  it('resolves divisional pairing that crosses naive seed adjacency (reseeding)', () => {
    const state = mockLeague()
    const data = mockStatic()
    const season = 2021
    const afc = buildCrossedAfcFixture(season, AFC_TEAMS.slice(0, 7))
    const nfc = buildConferenceFixture('NFC', NFC_TEAMS.slice(0, 7), season)
    const sbId = `${season}-SB-22-${nfc.champion}@${afc.champion}`
    const sbGame = makeGame(sbId, season, 22, 'SB', afc.champion, nfc.champion)
    const sbResult = makeResult(sbId, 27, 20)
    const games = [...afc.games, ...nfc.games, sbGame]
    const results = [...afc.results, ...nfc.results, sbResult]
    const bracket: PlayoffBracket = {
      season,
      seeds: [...afc.seeds, ...nfc.seeds],
      rounds: [
        { type: 'WC', games: games.filter((g) => g.type === 'WC') },
        { type: 'DIV', games: games.filter((g) => g.type === 'DIV') },
        { type: 'CONF', games: games.filter((g) => g.type === 'CONF') },
        { type: 'SB', games: [sbGame] },
      ],
      champion: afc.champion,
    }

    // Pure unit assertion: the leaf order follows the actual DIV pairing, not raw seed adjacency.
    // Each leaf's `seed` is the best seed reachable through it (min of its two WC participants),
    // so the 3v6 leaf carries seed 3 even though seed 6 is the team that actually won it.
    const tree = buildBracketTree(bracket, results)
    expect(tree).not.toBeNull()
    expect(tree!.afc.leaves.map((l) => l.seed)).toEqual([1, 3, 2, 4])

    const summary = buildSummary(state, season, bracket, [])
    const withHistory: LeagueState = {
      ...state,
      schedule: [...state.schedule, ...games],
      results: [...state.results, ...results],
      history: [summary],
    }
    const { container } = render(<SeasonRecap state={withHistory} data={data} />)

    expect(container.querySelector('.gg-bracket')).not.toBeNull()
    expect(screen.queryByText(/No playoff games recorded/)).not.toBeInTheDocument()

    const cells = Array.from(container.querySelectorAll('.gg-bracket__cell'))
    const abbr = (teamId: string) => data.teams[teamId]!.abbr
    // AFC DOM order: leaf0 (seed1 bye), leaf1 (the 3v6 game), then div0 — the 1 seed's DIV cell —
    // which must be preceded by both of those feeders.
    expect(cells[0]!.textContent).toContain(abbr(afc.leaves[0]!))
    expect(cells[0]!.textContent).toContain('Bye')
    expect(cells[1]!.textContent).toContain(abbr(afc.leaves[1]!))
    expect(cells[2]!.textContent).toContain(abbr(afc.leaves[0]!))
    expect(cells[2]!.textContent).toContain(abbr(afc.leaves[1]!))
  })

  it('falls back to the text list when summary.bracket is undefined', () => {
    const state = mockLeague()
    const data = mockStatic()
    const summary = buildSummary(state, state.season, undefined, [])
    const withHistory: LeagueState = { ...state, history: [summary] }

    const { container } = render(<SeasonRecap state={withHistory} data={data} />)
    expect(container.querySelector('.gg-bracket')).toBeNull()
    expect(screen.getByText(/No playoff games recorded/)).toBeInTheDocument()
  })
})

describe('SeasonRecap awards', () => {
  it('renders majors as NamePlates/helmet blocks and leaves stat leaders in the list', () => {
    const state = mockLeague()
    const data = mockStatic()
    const mvpTeam = AFC_TEAMS[0]!
    const coyTeam = NFC_TEAMS[0]!
    const leaderPlayerId = state.teams[mvpTeam]!.roster[1]!.playerId

    const awards: Award[] = [
      {
        id: 'MVP',
        name: 'Most valuable player',
        playerName: 'Pat Speed',
        pos: 'QB',
        teamId: mvpTeam,
        note: '4,512 yds, 38 TD, 14-3',
      },
      {
        id: 'COY',
        name: 'Coach of the year',
        teamId: coyTeam,
        note: 'Turned a 12-loss season into a division title',
      },
      {
        name: 'Rushing yards leader',
        playerId: leaderPlayerId,
        note: '1,812 yds',
      },
    ]
    const summary = buildSummary(state, state.season, undefined, awards)
    const withHistory: LeagueState = { ...state, history: [summary] }

    const { container } = render(<SeasonRecap state={withHistory} data={data} />)

    expect(screen.getByText('Most valuable player')).toBeInTheDocument()
    const namePlates = container.querySelectorAll('.gg-nameplate')
    expect(namePlates).toHaveLength(1)
    expect(namePlates[0]!.textContent).toContain('Pat Speed')

    const team = data.teams[coyTeam]!
    expect(screen.getByText(`${team.city} ${team.name}`)).toBeInTheDocument()

    expect(screen.getByText('League leaders')).toBeInTheDocument()
    const leaderText = screen.getByText(/Rushing yards leader/)
    expect(leaderText.closest('li')).not.toBeNull()
    expect(leaderText.closest('.gg-nameplate')).toBeNull()
  })
})
