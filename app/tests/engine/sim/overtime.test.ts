import { describe, expect, it } from 'vitest'
import type { Game, GameResult } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { drawScore } from '@engine/sim/score'
import { makeCtx } from './harness'
import { testRng } from './testRng'

const DRAWS = 200_000

function overtimeStats(season: number, postseason: boolean, seed: string) {
  const rng = testRng.fromSeed(seed, season)
  let ties = 0
  let overtimes = 0
  const otMargins: number[] = []
  for (let i = 0; i < DRAWS; i++) {
    const score = drawScore(0, season, rng, postseason)
    if (score.home === score.away) ties++
    if (score.overtime) {
      overtimes++
      otMargins.push(Math.abs(score.home - score.away))
    }
  }
  return { tieRate: ties / DRAWS, otRate: overtimes / DRAWS, otMargins }
}

describe('overtime by game type', () => {
  it('evenly matched postseason games never end tied, in any overtime era', () => {
    for (const season of [2010, 2015, 2023]) {
      const { tieRate, otRate, otMargins } = overtimeStats(season, true, 'playoff-ot')
      expect(tieRate).toBe(0)
      expect(otRate).toBeGreaterThan(0.06)
      expect(otRate).toBeLessThan(0.09)
      // A playoff overtime is won by a field goal or a touchdown, nothing stranger.
      for (const margin of otMargins) expect([3, 7]).toContain(margin)
    }
  })

  it('regular-season ties keep their era-correct rate', () => {
    // P(|margin| < otWindow) ≈ 7.7 % at μ = 0, × tieP 0.07 (× 0.45 before the 10-minute period).
    const modern = overtimeStats(2023, false, 'regular-ot')
    expect(modern.tieRate).toBeGreaterThan(0.0045)
    expect(modern.tieRate).toBeLessThan(0.0065)
    const longPeriod = overtimeStats(2015, false, 'regular-ot')
    expect(longPeriod.tieRate).toBeGreaterThan(0.0018)
    expect(longPeriod.tieRate).toBeLessThan(0.0032)
  })

  it('the regular-season stream is unchanged by the postseason rule', () => {
    for (let i = 0; i < 20_000; i++) {
      const reg = drawScore(0.5, 2023, testRng.fromSeed('same', i), false)
      const post = drawScore(0.5, 2023, testRng.fromSeed('same', i), true)
      if (reg.home !== reg.away) expect(post).toEqual(reg)
      else expect(post.home).not.toBe(post.away)
    }
  })

  it('simulateGame gives every playoff round a winner', () => {
    const ctx = makeCtx()
    const state = mockLeague({ seed: 'playoff-sim', season: 2023 })
    const [home, away] = Object.keys(state.teams).sort()
    const types = ['WC', 'DIV', 'CONF', 'SB'] as const
    const results: GameResult[] = []
    for (let i = 0; i < 4000; i++) {
      const type = types[i % types.length]!
      const game: Game = {
        id: `P${i}`,
        season: 2023,
        week: 19 + (i % 4),
        type,
        home: home!,
        away: away!,
        neutralSite: type === 'SB',
      }
      results.push(sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx)))
    }
    expect(results.filter((r) => r.homeScore === r.awayScore)).toHaveLength(0)
    expect(results.filter((r) => r.overtime).length).toBeGreaterThan(100)
  })
})
