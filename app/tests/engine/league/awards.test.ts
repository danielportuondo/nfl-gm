import { describe, expect, it } from 'vitest'
import type {
  Contract,
  Game,
  GameResult,
  LeagueState,
  Player,
  PlayerGameLine,
  RosterSlot,
  ScoutingView,
  TeamRecord,
  TeamState,
} from '@contracts/index'
import { league } from '@engine/league'
import { defenseNote, offenseNote, seasonAwards } from '@engine/league/awards'
import { mockBundle } from '@fixtures/mockLeague'
import { makeFakeContext } from '../fakes'

const SEASON = 2020

const flatContract: Contract = {
  years: 1,
  apy: 1,
  guaranteedPct: 0,
  signedSeason: SEASON,
  rookie: false,
}

function makePlayer(id: string, name: string, pos: Player['pos'], rookieSeason: number): Player {
  return {
    id,
    name,
    pos,
    birthYear: 1995,
    draft: null,
    real: false,
    rookieSeason,
  }
}

function makeSlot(playerId: string, teamId: string): RosterSlot {
  return { playerId, teamId, contract: flatContract }
}

function makeTeam(id: string, roster: RosterSlot[], record: TeamRecord): TeamState {
  return {
    id,
    roster,
    depthChart: {},
    record,
    deadMoney: 0,
    tradeAnnoyance: 0,
    userControlled: false,
  }
}

function makeGame(id: string, week: number, home: string, away: string): Game {
  return { id, season: SEASON, week, type: 'REG', home, away }
}

function makeResult(gameId: string, home: PlayerGameLine[], away: PlayerGameLine[]): GameResult {
  return {
    gameId,
    homeScore: 20,
    awayScore: 10,
    overtime: false,
    box: { home, away },
    injuries: [],
  }
}

/**
 * Five teams built to exercise every major award at once:
 * - AAA (14-3): qb1, the MVP (best offense score weighted by a winning record).
 * - BBB (6-11): qb2, the OPOY (higher raw offense score, but a losing record costs it MVP).
 * - CCC (9-8): dl1 (DPOY, sack/INT leader) and rook1 (a rookie defender, DROY).
 * - DDD (11-1): lb1 (a weak defender) and the league's worst starter consensus -> COY.
 * - EEE (12-5): no box-score players; the league's best starter consensus, to keep DDD's COY
 *   case honest (DDD must beat a team whose actual wins track its high projection).
 * Depth-chart "mean ovr" per team is fixed by giving each team five same-rated filler starters
 * (one per position used below), so autoDepthChart's mean is exactly that team's rating.
 */
function buildState(): LeagueState {
  const players: Record<string, Player> = {}
  const scouting: Record<string, ScoutingView> = {}
  const teams: Record<string, TeamState> = {}

  const addFiller = (
    teamId: string,
    ovr: number,
    roster: RosterSlot[],
    positions: Player['pos'][],
  ): void => {
    positions.forEach((pos, i) => {
      const id = `${teamId.toLowerCase()}-filler-${i}`
      players[id] = makePlayer(id, `${teamId} Filler ${i}`, pos, 2010)
      scouting[id] = { ovr, pot: ovr, confidence: 1 }
      roster.push(makeSlot(id, teamId))
    })
  }

  // AAA: qb1 (MVP) + filler roster rated 70.
  players.qb1 = makePlayer('qb1', 'Alpha Quarterback', 'QB', 2010)
  scouting.qb1 = { ovr: 70, pot: 70, confidence: 1 }
  const aaaRoster: RosterSlot[] = [makeSlot('qb1', 'AAA')]
  addFiller('AAA', 70, aaaRoster, ['WR', 'DL', 'LB', 'CB'])
  teams.AAA = makeTeam('AAA', aaaRoster, {
    wins: 14,
    losses: 3,
    ties: 0,
    pointsFor: 400,
    pointsAgainst: 300,
  })

  // BBB: qb2 (OPOY) + filler roster rated 65.
  players.qb2 = makePlayer('qb2', 'Beta Quarterback', 'QB', 2010)
  scouting.qb2 = { ovr: 65, pot: 65, confidence: 1 }
  const bbbRoster: RosterSlot[] = [makeSlot('qb2', 'BBB')]
  addFiller('BBB', 65, bbbRoster, ['WR', 'DL', 'LB', 'CB'])
  teams.BBB = makeTeam('BBB', bbbRoster, {
    wins: 6,
    losses: 11,
    ties: 0,
    pointsFor: 300,
    pointsAgainst: 400,
  })

  // CCC: dl1 (DPOY) + rook1 (rookie, DROY) + filler roster rated 75.
  players.dl1 = makePlayer('dl1', 'Gamma Rusher', 'DL', 2015)
  scouting.dl1 = { ovr: 75, pot: 75, confidence: 1 }
  players.rook1 = makePlayer('rook1', 'Rookie Linebacker', 'LB', SEASON)
  scouting.rook1 = { ovr: 75, pot: 75, confidence: 0.4 }
  const cccRoster: RosterSlot[] = [makeSlot('dl1', 'CCC'), makeSlot('rook1', 'CCC')]
  addFiller('CCC', 75, cccRoster, ['QB', 'WR', 'CB'])
  teams.CCC = makeTeam('CCC', cccRoster, {
    wins: 9,
    losses: 8,
    ties: 0,
    pointsFor: 350,
    pointsAgainst: 340,
  })

  // DDD: lb1 (weak defender) + filler roster rated 40 (worst consensus), but 11-1 -> COY.
  players.lb1 = makePlayer('lb1', 'Delta Linebacker', 'LB', 2012)
  scouting.lb1 = { ovr: 40, pot: 40, confidence: 1 }
  const dddRoster: RosterSlot[] = [makeSlot('lb1', 'DDD')]
  addFiller('DDD', 40, dddRoster, ['QB', 'WR', 'DL', 'CB'])
  teams.DDD = makeTeam('DDD', dddRoster, {
    wins: 11,
    losses: 1,
    ties: 0,
    pointsFor: 300,
    pointsAgainst: 150,
  })

  // EEE: no box-score players, best consensus (90), record tracks its high projection.
  const eeeRoster: RosterSlot[] = []
  addFiller('EEE', 90, eeeRoster, ['QB', 'WR', 'DL', 'LB', 'CB'])
  teams.EEE = makeTeam('EEE', eeeRoster, {
    wins: 12,
    losses: 5,
    ties: 0,
    pointsFor: 400,
    pointsAgainst: 250,
  })

  const qb1Line: PlayerGameLine = {
    playerId: 'qb1',
    teamId: 'AAA',
    passYds: 4000,
    passTd: 30,
    passInt: 10,
  }
  const qb2Line: PlayerGameLine = {
    playerId: 'qb2',
    teamId: 'BBB',
    passYds: 4200,
    passTd: 32,
    passInt: 10,
  }
  const dl1Line: PlayerGameLine = {
    playerId: 'dl1',
    teamId: 'CCC',
    sacks: 17.5,
    ints: 3,
  }
  const lb1Line: PlayerGameLine = {
    playerId: 'lb1',
    teamId: 'DDD',
    sacks: 5,
    ints: 1,
  }
  const rook1Line: PlayerGameLine = {
    playerId: 'rook1',
    teamId: 'CCC',
    sacks: 2,
    ints: 2,
  }

  const schedule: Game[] = [makeGame('g1', 1, 'AAA', 'BBB'), makeGame('g2', 1, 'CCC', 'DDD')]
  const results: GameResult[] = [
    makeResult('g1', [qb1Line], [qb2Line]),
    makeResult('g2', [dl1Line], [lb1Line, rook1Line]),
  ]

  return {
    schemaVersion: 1,
    seed: 'awards-test',
    season: SEASON,
    week: 18,
    phase: 'OFFSEASON_RESIGN',
    userTeam: 'AAA',
    horizonEnd: SEASON + 5,
    startSeason: SEASON,
    settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
    teams,
    players,
    scouting,
    truth: {},
    picks: [],
    schedule,
    results,
    history: [],
    divergence: new Set(),
    freeAgents: [],
    draftRoom: null,
    snapLog: [],
    outcome: 'IN_PROGRESS',
    savedAt: new Date(0).toISOString(),
  }
}

function ctx() {
  return makeFakeContext(mockBundle({ season: SEASON }))
}

describe('offenseNote / defenseNote — zero-stat fragments are omitted', () => {
  it('omits "0 TD" when there are no touchdowns', () => {
    const totals = { passYds: 0, passTd: 0, passInt: 0, rushYds: 0, rushTd: 0, recYds: 0, recTd: 0 }
    expect(offenseNote('QB', { ...totals, passYds: 250 })).toBe('250 yds')
    expect(offenseNote('WR', { ...totals, recYds: 80 })).toBe('80 yds')
  })

  it('shows only the non-zero counting stats, in sacks/INT/FF order', () => {
    const zero = { sacks: 0, ints: 0, forcedFumbles: 0, passesDefended: 0, tackles: 0, defTd: 0 }
    expect(defenseNote({ ...zero, sacks: 16, forcedFumbles: 2 })).toBe('16 sacks, 2 FF')
    expect(defenseNote({ ...zero, ints: 11 })).toBe('11 INT') // zero sacks: no "0 sacks" fragment
  })

  it('falls back to tackles when sacks, INT and forced fumbles are all zero', () => {
    const zero = { sacks: 0, ints: 0, forcedFumbles: 0, passesDefended: 0, tackles: 94, defTd: 0 }
    expect(defenseNote(zero)).toBe('94 tackles')
  })
})

describe('seasonAwards — major awards', () => {
  it('MVP goes to the best offense score weighted by team win pct, not raw score', () => {
    const state = buildState()
    const awards = seasonAwards(state, ctx())
    const mvp = awards.find((a) => a.id === 'MVP')
    expect(mvp?.playerId).toBe('qb1')
    expect(mvp?.teamId).toBe('AAA')
    expect(mvp?.note).toMatch(/^4,000 yds, 30 TD, 14-3$/)
  })

  it('OPOY is the highest raw offense score excluding the MVP winner, and is not the MVP', () => {
    const state = buildState()
    const awards = seasonAwards(state, ctx())
    const mvp = awards.find((a) => a.id === 'MVP')
    const opoy = awards.find((a) => a.id === 'OPOY')
    expect(opoy?.playerId).toBe('qb2')
    expect(opoy?.playerId).not.toBe(mvp?.playerId)
  })

  it('DPOY goes to the sack/INT leader with the expected note', () => {
    const state = buildState()
    const awards = seasonAwards(state, ctx())
    const dpoy = awards.find((a) => a.id === 'DPOY')
    expect(dpoy?.playerId).toBe('dl1')
    expect(dpoy?.note).toBe('17.5 sacks, 3 INT')
  })

  it('DROY goes to the rookie defender; OROY is absent with no rookie offense lines', () => {
    const state = buildState()
    const awards = seasonAwards(state, ctx())
    const droy = awards.find((a) => a.id === 'DROY')
    const oroy = awards.find((a) => a.id === 'OROY')
    expect(droy?.playerId).toBe('rook1')
    expect(oroy).toBeUndefined()
  })

  it('a season with no rookie lines at all has neither OROY nor DROY', () => {
    const state = buildState()
    for (const p of Object.values(state.players)) {
      ;(p as { rookieSeason: number }).rookieSeason = SEASON - 10
    }
    const awards = seasonAwards(state, ctx())
    expect(awards.find((a) => a.id === 'OROY')).toBeUndefined()
    expect(awards.find((a) => a.id === 'DROY')).toBeUndefined()
  })

  it('COY goes to the team with the worst starter consensus but a top record', () => {
    const state = buildState()
    const awards = seasonAwards(state, ctx())
    const coy = awards.find((a) => a.id === 'COY')
    expect(coy?.teamId).toBe('DDD')
    expect(coy?.note).toMatch(/^\d+-\d+(-\d+)?, projected \d+ wins$/)
  })

  it('is deterministic across repeated calls on the same state', () => {
    const state = buildState()
    const c = ctx()
    const first = seasonAwards(state, c)
    const second = seasonAwards(state, c)
    expect(first).toEqual(second)
  })
})

describe('summarizeSeason — bracket', () => {
  function playFullSeason(season: number, seed: string) {
    const bundle = mockBundle({ season })
    const c = makeFakeContext(bundle)
    let state = league.newGame(
      {
        seed,
        startSeason: season,
        userTeam: 'IND',
        horizonSeasons: 3,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      },
      c,
    )
    state = league.advancePhase(state, c) // PRESEASON -> REGULAR week 1
    let guard = 0
    while (state.phase === 'REGULAR' || state.phase === 'PLAYOFFS') {
      state = league.simWeek(state, c).state
      guard++
      if (guard > 60) throw new Error('playFullSeason: simWeek did not terminate')
    }
    return { state, ctx: c }
  }

  it('carries a 12-seed, 4-round bracket whose champion matches the summary (season <= 2019)', () => {
    const { state, ctx: c } = playFullSeason(2015, 'awards-bracket-2015')
    const summary = league.summarizeSeason(state, c)
    expect(summary.bracket).toBeDefined()
    expect(summary.bracket!.seeds).toHaveLength(12)
    expect(summary.bracket!.rounds).toHaveLength(4)
    expect(summary.bracket!.champion).toBe(summary.champion)
  })

  it('carries a 14-seed, 4-round bracket whose champion matches the summary (season >= 2020)', () => {
    const { state, ctx: c } = playFullSeason(2021, 'awards-bracket-2021')
    const summary = league.summarizeSeason(state, c)
    expect(summary.bracket).toBeDefined()
    expect(summary.bracket!.seeds).toHaveLength(14)
    expect(summary.bracket!.rounds).toHaveLength(4)
    expect(summary.bracket!.champion).toBe(summary.champion)
  })
})
