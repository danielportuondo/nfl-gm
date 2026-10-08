/**
 * A healthy consensus starter who really sat (RG3 behind Cousins, 2015) sits on AI teams for exactly
 * his real weeks; the user's team plays whoever the user picks.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { availableByPosition } from '@engine/sim/strength'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

function benchAt(state: LeagueState, playerId: PlayerId, week: number): LeagueState {
  return {
    ...state,
    phase: 'REGULAR',
    week,
    absences: {
      season: state.season,
      byPlayer: { [playerId]: [{ from: 2, to: 22, reason: 'benched' }] },
    },
  }
}

describe('benched starters (unit)', () => {
  const base = mockLeague({ season: 2017 })
  const aiTeam = Object.keys(base.teams)
    .sort()
    .find((id) => id !== base.userTeam)!

  it('an AI team plays the next man up and keeps the benched starter as a backup', () => {
    const [starter, backup] = availableByPosition(base, aiTeam).QB
    const sat = availableByPosition(benchAt(base, starter!, 5), aiTeam).QB
    expect(sat[0]).toBe(backup)
    expect(sat).toContain(starter)
    expect(availableByPosition(benchAt(base, starter!, 1), aiTeam).QB[0]).toBe(starter)
  })

  it("the user's team ignores the mark", () => {
    const starter = availableByPosition(base, base.userTeam).QB[0]!
    expect(availableByPosition(benchAt(base, starter, 5), base.userTeam).QB[0]).toBe(starter)
  })
})

describe('2015 Washington (shipped data)', () => {
  let ctx: EngineContext
  const newGame = (userTeam: TeamId) =>
    ctx.modules.league.newGame(
      {
        seed: 'benched',
        startSeason: 2015,
        userTeam,
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
  const idOf = (state: LeagueState, name: string) =>
    Object.values(state.players).find((p) => p.name === name)!.id
  const startingQb = (state: LeagueState, week: number) =>
    availableByPosition({ ...state, phase: 'REGULAR', week }, 'WAS').QB[0]

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(2015, readManifest().latestRealSeason))
  }, 60_000)

  it('starts Cousins, not the higher-rated Griffin who really sat all year', () => {
    const state = newGame('IND')
    const cousins = idOf(state, 'Kirk Cousins')
    const griffin = idOf(state, 'Robert Griffin')
    expect(state.scouting[griffin]!.ovr).toBeGreaterThan(state.scouting[cousins]!.ovr)
    for (const week of [2, 9, 17]) expect(startingQb(state, week)).toBe(cousins)
  })

  it('as the user, Washington starts whoever its depth chart says', () => {
    const state = newGame('WAS')
    const griffin = idOf(state, 'Robert Griffin')
    const chart = state.teams.WAS!.depthChart.QB!
    const userChart = {
      ...state.teams.WAS!.depthChart,
      QB: [griffin, ...chart.filter((id) => id !== griffin)],
    }
    const mine = {
      ...state,
      teams: { ...state.teams, WAS: { ...state.teams.WAS!, depthChart: userChart } },
    }
    expect(startingQb(mine, 9)).toBe(griffin)
  })
})
