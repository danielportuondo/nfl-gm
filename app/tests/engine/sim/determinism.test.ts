import { describe, expect, it } from 'vitest'
import { mockLeague } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { makeCtx } from './harness'

const ctx = makeCtx()

describe('sim determinism', () => {
  const state = mockLeague({ seed: 'determinism', season: 2021 })
  const game = state.schedule.find((g) => g.type === 'REG')!

  it('same seed gives a byte-identical result, box score and injuries', () => {
    const a = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
    const b = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.box!.home.length).toBeGreaterThan(10)
  })

  it('a different league seed gives a different result', () => {
    const other = { ...state, seed: 'determinism-2' }
    const a = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
    const b = sim.simulateGame(other, game, ctx, sim.gameRng(other, game, ctx))
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('a full week of games is reproducible and never mutates state', () => {
    const before = JSON.stringify({ ...state, divergence: [...state.divergence] })
    const week = state.schedule.filter((g) => g.week === 1)
    const run = () => week.map((g) => sim.simulateGame(state, g, ctx, sim.gameRng(state, g, ctx)))
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
    expect(JSON.stringify({ ...state, divergence: [...state.divergence] })).toBe(before)
  })

  it('every game in a week gets its own stream', () => {
    const week = state.schedule.filter((g) => g.week === 1)
    const scores = week.map((g) => {
      const r = sim.simulateGame(state, g, ctx, sim.gameRng(state, g, ctx))
      return `${r.homeScore}-${r.awayScore}`
    })
    expect(new Set(scores).size).toBeGreaterThan(week.length / 2)
  })
})
