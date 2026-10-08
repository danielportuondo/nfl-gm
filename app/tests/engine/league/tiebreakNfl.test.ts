/**
 * NFL tiebreak procedures (engine/league/tiebreak.ts): division and wild-card steps, the restart rule,
 * and a replay of real 2017 and 2018 results through the seeding.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TEAM_IDS, canonicalTeamId, DIVISIONS, type TeamId } from '@contracts/index'
import {
  buildTiebreakContext,
  orderTeams,
  seedConference,
  type TiebreakGame,
  type TiebreakRecord,
} from '@engine/league/tiebreak'

const AFC: TeamId[] = TEAM_IDS.filter((t) => DIVISIONS[t].conf === 'AFC')
const NFC: TeamId[] = TEAM_IDS.filter((t) => DIVISIONS[t].conf === 'NFC')

function record(wins: number, losses: number, diff = 0): TiebreakRecord {
  return { wins, losses, ties: 0, pointsFor: 300 + diff, pointsAgainst: 300 }
}

/** Hand-built season: add games, set the records the standings would carry, then order. */
class Scenario {
  games: TiebreakGame[] = []
  records: Record<string, TiebreakRecord> = {}

  beat(winner: TeamId, loser: TeamId, times = 1): this {
    for (let i = 0; i < times; i++)
      this.games.push({ home: winner, away: loser, homeScore: 24, awayScore: 17 })
    return this
  }

  set(team: TeamId, rec: TiebreakRecord): this {
    this.records[team] = rec
    return this
  }

  order(teams: TeamId[]): TeamId[] {
    return orderTeams(buildTiebreakContext(this.games, this.records), teams)
  }
}

const EAST: TeamId[] = ['NE', 'NYJ', 'BUF', 'MIA']

describe('division tiebreak', () => {
  it('2018 NYJ/NE: head-to-head split, division record beats point differential', () => {
    const s = new Scenario()
      .beat('NYJ', 'NE')
      .beat('NE', 'NYJ')
      .beat('NYJ', 'BUF', 2)
      .beat('NYJ', 'MIA')
      .beat('MIA', 'NYJ') // NYJ 4-2 in the division
      .beat('NE', 'BUF')
      .beat('BUF', 'NE')
      .beat('NE', 'MIA')
      .beat('MIA', 'NE') // NE 3-3 in the division
      .set('NYJ', record(11, 5, 61))
      .set('NE', record(11, 5, 107))
      .set('BUF', record(6, 10))
      .set('MIA', record(7, 9))
    expect(s.order(EAST).slice(0, 2)).toEqual(['NYJ', 'NE'])

    const seeds = seedConference(buildTiebreakContext(s.games, s.records), AFC, 6)
    expect(seeds[0]).toBe('NYJ') // the division winner takes the bye
    expect(seeds[4]).toBe('NE') // NE is the first wild card
  })

  it('falls to common games when head-to-head and division record are level', () => {
    const s = new Scenario()
      .beat('NYJ', 'NE')
      .beat('NE', 'NYJ')
      .beat('NYJ', 'BUF')
      .beat('BUF', 'NYJ')
      .beat('NE', 'BUF')
      .beat('BUF', 'NE') // both 2-2 in the division
      .beat('NYJ', 'PIT')
      .beat('NYJ', 'KC')
      .beat('DEN', 'NYJ') // NYJ 2-1 vs PIT, KC, DEN
      .beat('NE', 'PIT')
      .beat('KC', 'NE')
      .beat('DEN', 'NE') // NE 1-2 vs the same three
      .set('NYJ', record(10, 6))
      .set('NE', record(10, 6, 80)) // point differential and conference record would say NE
      .set('BUF', record(5, 11))
    expect(s.order(['NE', 'NYJ', 'BUF'])).toEqual(['NYJ', 'NE', 'BUF'])
  })

  it('three-way tie: a step cuts it to two, then head-to-head restarts between the two', () => {
    // HOU beat IND twice, IND beat TEN twice, TEN beat HOU twice: 2-2 each, so head-to-head is level.
    // Division record cuts TEN (it lost to JAX twice). The survivors, HOU and IND, restart at
    // head-to-head and HOU wins it, even though IND would win common games, the next step of the
    // three-club pass.
    const s = new Scenario()
      .beat('HOU', 'IND', 2)
      .beat('IND', 'TEN', 2)
      .beat('TEN', 'HOU', 2)
      .beat('HOU', 'JAX', 2)
      .beat('IND', 'JAX', 2)
      .beat('JAX', 'TEN', 2)
      .beat('IND', 'DEN') // IND beats a common opponent...
      .beat('DEN', 'HOU') // ...that HOU loses to
      .set('HOU', record(9, 7))
      .set('IND', record(9, 7))
      .set('TEN', record(9, 7))
      .set('JAX', record(3, 13))
    // Seed 1 goes to HOU, then the restart for the last two: IND beat TEN twice.
    expect(s.order(['HOU', 'IND', 'TEN', 'JAX'])).toEqual(['HOU', 'IND', 'TEN', 'JAX'])
  })
})

describe('wild-card tiebreak', () => {
  it('conference record decides when the clubs never met', () => {
    const s = new Scenario()
      .beat('KC', 'CLE', 8)
      .beat('CLE', 'KC', 4) // KC 8-4 in the conference
      .beat('TEN', 'CLE', 7)
      .beat('CLE', 'TEN', 5) // TEN 7-5
      .set('KC', record(10, 6))
      .set('TEN', record(10, 6, 90)) // point differential would say TEN
      .set('CLE', record(4, 12))
    expect(s.order(['TEN', 'KC'])).toEqual(['KC', 'TEN'])
  })

  it('keeps one club per division first, then restarts for the next seed', () => {
    // DEN has a better conference record than KC but lost the division tiebreak to it, so it cannot
    // take the first seed; TEN has the best conference record of the survivors. DEN comes back in
    // for the last seed against KC.
    const s = new Scenario()
      .beat('KC', 'DEN', 2)
      .beat('KC', 'CLE', 4)
      .beat('CLE', 'KC', 2) // KC is 6-2 in the conference, DEN 8-2, TEN 7-1
      .beat('DEN', 'CLE', 8)
      .beat('TEN', 'CLE', 7)
      .beat('CLE', 'TEN')
      .set('KC', record(10, 6))
      .set('DEN', record(10, 6))
      .set('TEN', record(10, 6))
      .set('CLE', record(3, 13))
    expect(s.order(['DEN', 'KC', 'TEN'])).toEqual(['TEN', 'KC', 'DEN'])
  })

  it('strength of victory, then strength of schedule, when everything before is level', () => {
    // LAC and BAL never met, are 1-1 in conference play with no common opponent beyond TEN (fewer
    // than four common games). Team id and point differential both point the other way.
    const victory = new Scenario()
      .beat('LAC', 'TEN')
      .beat('BAL', 'CLE')
      .beat('PIT', 'LAC')
      .beat('KC', 'BAL')
      .set('LAC', record(10, 6))
      .set('BAL', record(10, 6, 70))
      .set('TEN', record(12, 4))
      .set('CLE', record(4, 12))
      .set('PIT', record(8, 8))
      .set('KC', record(8, 8))
    expect(victory.order(['BAL', 'LAC'])).toEqual(['LAC', 'BAL'])

    const schedule = new Scenario()
      .beat('LAC', 'TEN')
      .beat('BAL', 'TEN')
      .beat('PIT', 'LAC')
      .beat('CLE', 'BAL')
      .set('LAC', record(10, 6))
      .set('BAL', record(10, 6, 70))
      .set('TEN', record(12, 4))
      .set('PIT', record(12, 4))
      .set('CLE', record(4, 12))
    expect(schedule.order(['BAL', 'LAC'])).toEqual(['LAC', 'BAL'])
  })

  it('counts a tie as half a win when ordering by record', () => {
    const s = new Scenario()
      .set('NYG', { wins: 9, losses: 6, ties: 1, pointsFor: 1, pointsAgainst: 0 })
      .set('DAL', { wins: 9, losses: 7, ties: 0, pointsFor: 9, pointsAgainst: 0 })
    expect(s.order(['DAL', 'NYG'])).toEqual(['NYG', 'DAL'])
  })
})

describe('replaying real results through the seeding', () => {
  interface ScheduleGame {
    id: string
    type: string
    home: string
    away: string
    homeScore: number | null
    awayScore: number | null
  }

  function replay(season: number): {
    games: TiebreakGame[]
    records: Record<string, TiebreakRecord>
  } {
    const path = fileURLToPath(
      new URL(`../../../public/data/season/${season}/schedule.json`, import.meta.url),
    )
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { games: ScheduleGame[] }
    const games: TiebreakGame[] = raw.games
      .filter((g) => g.type === 'REG' && g.homeScore !== null && g.awayScore !== null)
      .map((g) => ({
        home: canonicalTeamId(g.home),
        away: canonicalTeamId(g.away),
        homeScore: g.homeScore!,
        awayScore: g.awayScore!,
      }))
    const records: Record<string, TiebreakRecord> = {}
    const rec = (t: TeamId) =>
      (records[t] ??= { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 })
    for (const g of games) {
      const home = rec(g.home)
      const away = rec(g.away)
      home.pointsFor += g.homeScore
      home.pointsAgainst += g.awayScore
      away.pointsFor += g.awayScore
      away.pointsAgainst += g.homeScore
      if (g.homeScore === g.awayScore) {
        home.ties += 1
        away.ties += 1
      } else if (g.homeScore > g.awayScore) {
        home.wins += 1
        away.losses += 1
      } else {
        away.wins += 1
        home.losses += 1
      }
    }
    return { games, records }
  }

  const REAL_SEEDS: Record<number, { AFC: TeamId[]; NFC: TeamId[] }> = {
    2017: {
      AFC: ['NE', 'PIT', 'JAX', 'KC', 'TEN', 'BUF'],
      NFC: ['PHI', 'MIN', 'LAR', 'NO', 'CAR', 'ATL'],
    },
    2018: {
      AFC: ['KC', 'NE', 'HOU', 'BAL', 'LAC', 'IND'],
      NFC: ['NO', 'LAR', 'CHI', 'DAL', 'SEA', 'PHI'],
    },
  }

  it.each([2017, 2018])('%i produces the seeds the NFL actually used', (season) => {
    const { games, records } = replay(season)
    const ctx = buildTiebreakContext(games, records)
    expect(seedConference(ctx, AFC, 6)).toEqual(REAL_SEEDS[season]!.AFC)
    expect(seedConference(ctx, NFC, 6)).toEqual(REAL_SEEDS[season]!.NFC)
  })
})
