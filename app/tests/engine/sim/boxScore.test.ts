import { describe, expect, it } from 'vitest'
import type { GameResult, PlayerGameLine } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { apportion, offenseTotals, teamLines } from '@engine/sim/boxScore'
import { isPlausibleScore } from '@engine/sim/score'
import { availableByPosition } from '@engine/sim/strength'
import { boxPoints, makeCtx } from './harness'
import { testRng } from './testRng'

const ctx = makeCtx()
const state = mockLeague({ seed: 'box', season: 2021 })
const games = state.schedule.filter((g) => g.type === 'REG').slice(0, 200)
const results: GameResult[] = games.map((g) =>
  sim.simulateGame(state, g, ctx, sim.gameRng(state, g, ctx)),
)

const sum = (lines: readonly PlayerGameLine[], key: keyof PlayerGameLine) =>
  lines.reduce((acc, line) => acc + ((line[key] as number | undefined) ?? 0), 0)

const COUNTS: (keyof PlayerGameLine)[] = [
  'passAtt',
  'passCmp',
  'passYds',
  'passTd',
  'passInt',
  'rushAtt',
  'rushYds',
  'rushTd',
  'targets',
  'rec',
  'recYds',
  'recTd',
  'tackles',
  'sacks',
  'ints',
  'forcedFumbles',
  'passesDefended',
  'fgm',
  'fga',
  'xpm',
  'xpa',
  'punts',
  'puntYds',
  'twoPt',
  'defTd',
  'retTd',
  'safeties',
]

describe('box score invariants over 200 games', () => {
  it('receiving mirrors passing exactly on both sides of every game', () => {
    for (const result of results) {
      for (const lines of [result.box!.home, result.box!.away]) {
        expect(sum(lines, 'recYds')).toBe(sum(lines, 'passYds'))
        expect(sum(lines, 'rec')).toBe(sum(lines, 'passCmp'))
        expect(sum(lines, 'targets')).toBe(sum(lines, 'passAtt'))
        expect(sum(lines, 'recTd')).toBe(sum(lines, 'passTd'))
      }
    }
  })

  it('no negative counts and no impossible per-player lines', () => {
    for (const result of results) {
      for (const lines of [result.box!.home, result.box!.away]) {
        for (const line of lines) {
          for (const key of COUNTS)
            expect((line[key] as number | undefined) ?? 0).toBeGreaterThanOrEqual(0)
          expect(line.passCmp ?? 0).toBeLessThanOrEqual(line.passAtt ?? 0)
          expect(line.rec ?? 0).toBeLessThanOrEqual(line.targets ?? 0)
          expect(line.recTd ?? 0).toBeLessThanOrEqual(line.rec ?? 0)
          expect(line.rushTd ?? 0).toBeLessThanOrEqual(line.rushAtt ?? 0)
          expect(line.fgm ?? 0).toBeLessThanOrEqual(line.fga ?? 0)
          expect(line.xpm ?? 0).toBeLessThanOrEqual(line.xpa ?? 0)
        }
      }
    }
  })

  it('lines belong to the team that played and to its roster', () => {
    results.forEach((result, i) => {
      const game = games[i]!
      for (const [teamId, lines] of [
        [game.home, result.box!.home],
        [game.away, result.box!.away],
      ] as const) {
        const roster = new Set(state.teams[teamId]!.roster.map((r) => r.playerId))
        for (const line of lines) {
          expect(line.teamId).toBe(teamId)
          expect(roster.has(line.playerId)).toBe(true)
        }
        expect(new Set(lines.map((l) => l.playerId)).size).toBe(lines.length)
      }
    })
  })

  it('scores are plausible football scores and the box adds up to them exactly', () => {
    for (const result of results) {
      expect(isPlausibleScore(result.homeScore)).toBe(true)
      expect(isPlausibleScore(result.awayScore)).toBe(true)
      expect(boxPoints(result.box!.home)).toBe(result.homeScore)
      expect(boxPoints(result.box!.away)).toBe(result.awayScore)
    }
  })

  it('statlines look like football', () => {
    const qbYards: number[] = []
    for (const result of results) {
      for (const lines of [result.box!.home, result.box!.away]) {
        qbYards.push(sum(lines, 'passYds'))
        expect(sum(lines, 'tackles')).toBeGreaterThan(20)
        expect(sum(lines, 'punts')).toBeGreaterThan(0)
      }
    }
    const mean = qbYards.reduce((a, b) => a + b, 0) / qbYards.length
    expect(mean).toBeGreaterThan(170)
    expect(mean).toBeLessThan(300)
  })

  it('a squad with no quarterback, kicker or backs still accounts for every point', () => {
    const teamId = Object.keys(state.teams).sort()[0]!
    const full = availableByPosition(state, teamId)
    const squads = [
      { ...full, QB: [], K: [], P: [] },
      { ...full, QB: [], RB: [], WR: full.WR.slice(0, 1), TE: [] },
      { ...full, QB: [], RB: [], WR: [], TE: [], K: [] },
    ]
    const rng = testRng.fromSeed('depleted')
    for (const byPos of squads) {
      for (let points = 0; points <= 59; points++) {
        if (!isPlausibleScore(points)) continue
        const totals = offenseTotals(points, rng)
        const lines = teamLines(state, { teamId, byPos, totals, takeaways: 0 }, rng)
        expect(boxPoints(lines)).toBe(points)
        expect(sum(lines, 'rec')).toBe(sum(lines, 'passCmp'))
        expect(sum(lines, 'recTd')).toBe(sum(lines, 'passTd'))
      }
    }
  })

  it('apportion splits a total exactly, weights or not', () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(apportion(0, [1, 2])).toEqual([0, 0])
    expect(apportion(7, [0, 0])).toEqual([7, 0])
    expect(apportion(31, [0.5, 0.25, 0.25]).reduce((a, b) => a + b, 0)).toBe(31)
  })
})
