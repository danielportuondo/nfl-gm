import { describe, expect, it } from 'vitest'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { makeCtx, runSeason } from './harness'

const ctx = makeCtx()
const model = mockStatic().injuryModel

describe('injury sampling', () => {
  it('produces nothing when injuries are switched off', () => {
    const state = mockLeague({ seed: 'inj-off', season: 2021, settings: { injuries: false } })
    const totals = runSeason(state, ctx)
    expect(totals.games).toBeGreaterThan(200)
    expect(totals.injuries).toBe(0)
  })

  it('injures roughly one player per team per game when switched on', () => {
    const state = mockLeague({ seed: 'inj-on', season: 2021, settings: { injuries: true } })
    const totals = runSeason(state, ctx)
    const perTeamGame = totals.injuries / totals.teamGames
    const multiWeekPerTeamGame = totals.multiWeekInjuries / totals.teamGames
    expect(perTeamGame).toBeGreaterThan(0.6)
    expect(perTeamGame).toBeLessThan(1.6)
    expect(multiWeekPerTeamGame).toBeGreaterThan(0.6)
    expect(multiWeekPerTeamGame).toBeLessThan(1.6)
  })

  it('durations and kinds come from the fitted model, for players on the right team', () => {
    const state = mockLeague({ seed: 'inj-shape', season: 2021, settings: { injuries: true } })
    const weeks = new Set(model.duration.map((d) => d.weeks))
    const kinds = new Set(model.kinds.map((k) => k.kind))
    let seen = 0
    for (const game of state.schedule.filter((g) => g.type === 'REG').slice(0, 120)) {
      const result = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
      for (const event of result.injuries) {
        expect([game.home, game.away]).toContain(event.teamId)
        expect(state.teams[event.teamId]!.roster.some((r) => r.playerId === event.playerId)).toBe(true)
        expect(weeks.has(event.weeksOut)).toBe(true)
        expect(kinds.has(event.kind)).toBe(true)
        seen++
      }
    }
    expect(seen).toBeGreaterThan(100)
  })

  it('leaves already-injured players alone', () => {
    const base = mockLeague({ seed: 'inj-hurt', season: 2021, settings: { injuries: true } })
    const teamId = Object.keys(base.teams).sort()[0]!
    const hurt = new Set(base.teams[teamId]!.roster.slice(0, 20).map((r) => r.playerId))
    const state = {
      ...base,
      teams: {
        ...base.teams,
        [teamId]: {
          ...base.teams[teamId]!,
          roster: base.teams[teamId]!.roster.map((slot) =>
            hurt.has(slot.playerId)
              ? { ...slot, injured: { weeksOut: 4, kind: 'knee', season: base.season, week: 1 } }
              : slot,
          ),
        },
      },
    }
    for (const game of state.schedule.filter((g) => g.type === 'REG')) {
      if (game.home !== teamId && game.away !== teamId) continue
      const result = sim.simulateGame(state, game, ctx, sim.gameRng(state, game, ctx))
      for (const event of result.injuries) expect(hurt.has(event.playerId)).toBe(false)
    }
  })
})
