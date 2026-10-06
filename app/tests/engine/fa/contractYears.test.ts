/**
 * Synthesized contract length by age (QA M11: Fitzgerald x7, Cutler x7, Brady x5 at 40). The real
 * rosters file records total contract length, not years remaining, so every veteran deal is capped to
 * run no later than about 36 (39 for QB/K/P) while APY stays as the data (or the market curve) says.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_IDS, type EngineContext, type LeagueState } from '@contracts/index'
import { faConstants } from '@engine/fa/constants'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017

function maxYearsFor(pos: string, age: number): number {
  const endAge = ['QB', 'K', 'P'].includes(pos)
    ? faConstants.contractEndAge.specialist
    : faConstants.contractEndAge.default
  return Math.max(1, endAge - age)
}

describe('veteran contract length on the real 2017 opening', () => {
  let ctx: EngineContext
  let state: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    state = ctx.modules.league.newGame(
      {
        seed: 'years',
        startSeason: START,
        userTeam: 'MIA',
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
  }, 60000)

  const slots = () =>
    TEAM_IDS.flatMap((t) => state.teams[t]!.roster).map((slot) => {
      const p = state.players[slot.playerId]!
      return { slot, pos: p.pos, age: state.season - p.birthYear }
    })

  it('no veteran deal runs past the end-of-career age for his position', () => {
    const over = slots()
      .filter(
        ({ slot, pos, age }) =>
          !slot.contract.rookie && slot.contract.years > maxYearsFor(pos, age),
      )
      .map(
        ({ slot, pos, age }) =>
          `${state.players[slot.playerId]!.name} ${pos} ${age}: ${slot.contract.years}y`,
      )
    expect(over).toEqual([])
  })

  it('years by age bucket look like the NFL: old players on short deals, prime players longer', () => {
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    const yearsIn = (lo: number, hi: number, specialists = true) =>
      slots()
        .filter(({ age }) => age >= lo && age <= hi)
        .filter(({ pos }) => specialists || !['QB', 'K', 'P'].includes(pos))
        .map(({ slot }) => slot.contract.years)
    const old = yearsIn(34, 60)
    expect(old.length).toBeGreaterThan(30)
    expect(Math.max(...yearsIn(34, 60, false))).toBeLessThanOrEqual(2)
    expect(Math.max(...yearsIn(36, 60))).toBeLessThanOrEqual(3)
    expect(mean(old)).toBeLessThan(1.8)
    expect(mean(yearsIn(26, 29))).toBeGreaterThan(2.2)
    expect(mean(yearsIn(30, 33))).toBeLessThan(mean(yearsIn(26, 29)) + 0.6)
  })
})
