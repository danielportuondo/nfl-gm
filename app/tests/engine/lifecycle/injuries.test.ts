/**
 * lifecycle.tickInjuries — permanent loss after long injuries (HANDOFF §6.7): the only place lifecycle
 * edits truth mid-season. Short injuries never touch truth; long ones sometimes do, within the
 * injuryModel's own range.
 */
import { describe, expect, it } from 'vitest'
import type { LeagueState, Player, RosterSlot, TeamState, TrueTrajectory } from '@contracts/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { lifecycle } from '@engine/lifecycle'
import { makeFakeContext } from '../fakes'

const SEASON = 2015
const WEEK = 10

function injuredState(weeksOutAtInjury: number, value = 80): { ctx: ReturnType<typeof makeFakeContext>; state: LeagueState } {
  const bundle = mockBundle({ season: SEASON })
  const ctx = makeFakeContext(bundle, { lifecycle })
  const player: Player = { id: 'hurt-1', name: 'hurt-1', pos: 'RB', birthYear: SEASON - 25, draft: null, real: false, rookieSeason: SEASON - 3 }
  const truth: TrueTrajectory = { bySeason: { [String(SEASON)]: value }, retiresAfter: null }
  const roster: RosterSlot[] = [
    { playerId: 'hurt-1', teamId: 'IND', contract: { years: 1, apy: 1, guaranteedPct: 0, signedSeason: SEASON, rookie: false }, injured: { weeksOut: 1, kind: 'knee', season: SEASON, week: WEEK - weeksOutAtInjury + 1 } },
  ]
  const team: TeamState = {
    id: 'IND', roster, depthChart: {}, record: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    deadMoney: 0, tradeAnnoyance: 0, userControlled: true,
  }
  const base = mockLeague({ season: SEASON })
  const state: LeagueState = { ...base, week: WEEK, teams: { IND: team }, players: { 'hurt-1': player }, truth: { 'hurt-1': truth }, freeAgents: [] }
  return { ctx, state }
}

describe('lifecycle.tickInjuries', () => {
  it('clears a short injury (below permanentLoss.minWeeks) without ever touching truth', () => {
    const { ctx, state } = injuredState(1)
    let seenLoss = false
    for (let seed = 0; seed < 50; seed++) {
      const rng = ctx.modules.rng.fromSeed('short-injury', seed)
      const next = lifecycle.tickInjuries(state, ctx, rng)
      expect(next.teams.IND!.roster[0]!.injured).toBeUndefined()
      if (next.truth['hurt-1']!.bySeason[String(SEASON)] !== 80) seenLoss = true
    }
    expect(seenLoss).toBe(false)
  })

  it('sometimes applies a permanent loss in [1,3] after a long injury clears, and only ever helps or hurts within that range', () => {
    const model = mockBundle({ season: SEASON }).static.injuryModel.permanentLoss
    const { ctx, state } = injuredState(model.minWeeks)
    let anyLoss = false
    for (let seed = 0; seed < 200; seed++) {
      const rng = ctx.modules.rng.fromSeed('long-injury', seed)
      const next = lifecycle.tickInjuries(state, ctx, rng)
      const after = next.truth['hurt-1']!.bySeason[String(SEASON)]!
      const loss = 80 - after
      expect(loss).toBeGreaterThanOrEqual(0)
      expect(loss).toBeLessThanOrEqual(model.lossRange[1])
      if (loss > 0) {
        anyLoss = true
        expect(loss).toBeGreaterThanOrEqual(model.lossRange[0])
      }
    }
    expect(anyLoss).toBe(true)
  })

  it('is deterministic for the same seed', () => {
    const model = mockBundle({ season: SEASON }).static.injuryModel.permanentLoss
    const { ctx, state } = injuredState(model.minWeeks)
    const rngA = ctx.modules.rng.fromSeed('same-seed-injury')
    const rngB = ctx.modules.rng.fromSeed('same-seed-injury')
    const a = lifecycle.tickInjuries(state, ctx, rngA)
    const b = lifecycle.tickInjuries(state, ctx, rngB)
    expect(a.truth).toEqual(b.truth)
  })
})
