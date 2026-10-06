import type { Game, GameResult, GameType, PlayerGameLine } from '@contracts/index'
import {
  headlineKeysFor,
  latestRegularSeason,
  playerSeasonStats,
  statColumnsFor,
} from '@screens/shared/playerStats'
import { describe, expect, it } from 'vitest'

const QB = 'qb-1'

function game(
  id: string,
  season: number,
  week: number,
  type: GameType,
  home: string,
  away: string,
) {
  return { id, season, week, type, home, away } as Game
}

function result(
  gameId: string,
  lines: { home?: PlayerGameLine[]; away?: PlayerGameLine[] },
  injuries: GameResult['injuries'] = [],
): GameResult {
  return {
    gameId,
    homeScore: 20,
    awayScore: 17,
    overtime: false,
    box: { home: lines.home ?? [], away: lines.away ?? [] },
    injuries,
  }
}

const qbLine = (teamId: string, over: Partial<PlayerGameLine>): PlayerGameLine => ({
  playerId: QB,
  teamId,
  ...over,
})

describe('playerSeasonStats', () => {
  const schedule = [
    game('g1', 2016, 1, 'REG', 'IND', 'KC'),
    game('g2', 2016, 2, 'REG', 'DEN', 'IND'),
    game('g3', 2016, 3, 'REG', 'IND', 'NE'),
    game('g4', 2016, 18, 'DIV', 'IND', 'NE'),
    game('g5', 2017, 1, 'REG', 'IND', 'KC'),
  ]

  it('sums box-score lines per season and keeps playoffs separate', () => {
    const results = [
      result('g1', {
        home: [qbLine('IND', { passAtt: 30, passCmp: 20, passYds: 250, passTd: 2, passInt: 1 })],
      }),
      result('g2', {
        away: [qbLine('IND', { passAtt: 40, passCmp: 25, passYds: 300, passTd: 1, rushYds: 12 })],
      }),
      result('g4', {
        home: [qbLine('IND', { passAtt: 20, passCmp: 10, passYds: 99, passTd: 0, passInt: 2 })],
      }),
      result('g5', { home: [qbLine('IND', { passYds: 111 })] }),
    ]
    const rows = playerSeasonStats({ schedule, results }, QB)
    expect(rows.map((r) => r.season)).toEqual([2016, 2017])

    const reg = rows[0]!.regular!
    expect(reg).toMatchObject({
      games: 2,
      passAtt: 70,
      passCmp: 45,
      passYds: 550,
      passTd: 3,
      passInt: 1,
      rushYds: 12,
    })
    const playoffs = rows[0]!.playoffs!
    expect(playoffs).toMatchObject({ games: 1, passYds: 99, passInt: 2 })
    expect(rows[1]!.playoffs).toBeNull()
    expect(rows[1]!.regular!.passYds).toBe(111)
  })

  it('ignores other players and games without a box score', () => {
    const results = [
      result('g1', { home: [{ playerId: 'someone-else', teamId: 'IND', passYds: 500 }] }),
      { gameId: 'g2', homeScore: 3, awayScore: 0, overtime: false, injuries: [] },
    ]
    expect(playerSeasonStats({ schedule, results }, QB)).toEqual([])
  })

  it('sums a player traded mid-season across both teams', () => {
    const results = [
      result('g1', { home: [qbLine('IND', { passYds: 200, passTd: 1 })] }),
      result('g2', { home: [], away: [qbLine('DEN', { passYds: 150, passTd: 2 })] }),
    ]
    const [row] = playerSeasonStats({ schedule, results }, QB)
    expect(row!.teams).toEqual(['IND', 'DEN'])
    expect(row!.regular).toMatchObject({ games: 2, passYds: 350, passTd: 3 })
  })

  it('counts games missed to injury from the team games inside the injury window', () => {
    const season = [
      game('a1', 2016, 1, 'REG', 'IND', 'KC'),
      game('a2', 2016, 2, 'REG', 'IND', 'NE'),
      // week 3 is a bye for IND
      game('a4', 2016, 4, 'REG', 'DEN', 'IND'),
      game('a5', 2016, 5, 'REG', 'IND', 'KC'),
      game('a6', 2016, 6, 'REG', 'IND', 'NE'),
      game('other', 2016, 2, 'REG', 'KC', 'NE'),
    ]
    const results = [
      result('a1', { home: [qbLine('IND', { passYds: 100 })] }),
      result('a2', { home: [qbLine('IND', { passYds: 100 })] }, [
        { playerId: QB, teamId: 'IND', weeksOut: 3, kind: 'knee' },
      ]),
      result('a4', {}),
      result('a5', {}),
      result('a6', { home: [qbLine('IND', { passYds: 100 })] }),
      result('other', {}),
    ]
    const [row] = playerSeasonStats({ schedule: season, results }, QB)
    expect(row!.regular).toMatchObject({ games: 3, gamesMissed: 2 })
  })
})

describe('latestRegularSeason', () => {
  it('returns the newest season that has a regular-season line', () => {
    const totals = playerSeasonStats(
      {
        schedule: [
          game('g1', 2016, 1, 'REG', 'IND', 'KC'),
          game('g2', 2017, 18, 'DIV', 'IND', 'KC'),
        ],
        results: [
          result('g1', { home: [qbLine('IND', { passYds: 1 })] }),
          result('g2', { home: [qbLine('IND', { passYds: 2 })] }),
        ],
      },
      QB,
    )
    expect(totals.map((r) => r.season)).toEqual([2016, 2017])
    expect(latestRegularSeason(totals)?.season).toBe(2016)
    expect(latestRegularSeason([])).toBeNull()
  })
})

describe('statColumnsFor', () => {
  it('gives each position group its own line', () => {
    const headers = (pos: Parameters<typeof statColumnsFor>[0]) =>
      statColumnsFor(pos).map((c) => c.header)
    expect(headers('QB')).toEqual(['Cmp/Att', 'Pass yds', 'TD', 'INT', 'Rush yds', 'Rush TD'])
    expect(headers('RB')).toEqual(['Att', 'Rush yds', 'Rush TD', 'Rec', 'Rec yds', 'Rec TD'])
    expect(headers('WR')).toEqual(['Rec', 'Tgt', 'Rec yds', 'Rec TD'])
    expect(headers('CB')).toEqual(['Tackles', 'Sacks', 'INT', 'PD', 'FF'])
    expect(headers('OL')).toEqual([])
    expect(headlineKeysFor('QB').length).toBeGreaterThan(0)
  })

  it('formats values from the totals', () => {
    const [row] = playerSeasonStats(
      {
        schedule: [game('g1', 2016, 1, 'REG', 'IND', 'KC')],
        results: [
          result('g1', {
            home: [qbLine('IND', { passAtt: 489, passCmp: 312, passYds: 3812 })],
          }),
        ],
      },
      QB,
    )
    const cols = statColumnsFor('QB')
    expect(cols[0]!.value(row!.regular!)).toBe('312/489')
    expect(cols[1]!.value(row!.regular!)).toBe('3,812')
  })
})
