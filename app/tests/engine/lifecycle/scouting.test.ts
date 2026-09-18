/**
 * lifecycle.refreshScouting — acceptance #5: in-history seasons copy the chunk's own consensus;
 * post-history/procedural seasons derive a noisy view of last season's truth that never reaches into
 * a season beyond the one being refreshed; and the result is deterministic for a given seed.
 */
import { describe, expect, it } from 'vitest'
import type { LeagueState, Player, TrueTrajectory } from '@contracts/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { lifecycle } from '@engine/lifecycle'
import { makeFakeContext } from '../fakes'

describe('lifecycle.refreshScouting — in history', () => {
  it('copies the season chunk consensus exactly for a player present in that chunk', () => {
    const SEASON = 2015
    const bundle = mockBundle({ season: SEASON })
    const ctx = makeFakeContext(bundle, { lifecycle })
    // Pick a clear veteran (not a rookieSeason-adjacent edge case) so refreshScouting doesn't skip it.
    const chunkPlayer = bundle.seasons[SEASON]!.players.players.find((p) => p.rookieSeason <= SEASON - 3)!

    const base = mockLeague({ season: SEASON })
    const state: LeagueState = {
      ...base,
      players: { [chunkPlayer.id]: base.players[chunkPlayer.id] ?? { ...chunkPlayer } },
      truth: { [chunkPlayer.id]: { bySeason: { [String(SEASON - 1)]: chunkPlayer.trueValue }, retiresAfter: null } },
      scouting: {},
    }

    const next = lifecycle.refreshScouting(state, ctx)
    expect(next.scouting[chunkPlayer.id]).toEqual(chunkPlayer.scouting)
  })
})

describe('lifecycle.refreshScouting — beyond data / procedural', () => {
  const SEASON = 2018 // mockBundle's manifest.latestRealSeason defaults to the bundle's season (2015)

  function veteranState(): { ctx: ReturnType<typeof makeFakeContext>; state: LeagueState } {
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle, { lifecycle })
    const player: Player = { id: 'vet-1', name: 'vet-1', pos: 'WR', birthYear: SEASON - 27, draft: null, real: false, rookieSeason: 2010 }
    const truth: TrueTrajectory = {
      bySeason: { '2016': 50, '2017': 70, '2019': 99 }, // 2019 is beyond SEASON=2018 and must never be read
      retiresAfter: null,
    }
    const base = mockLeague({ season: SEASON })
    const state: LeagueState = { ...base, season: SEASON, players: { 'vet-1': player }, truth: { 'vet-1': truth }, scouting: {} }
    return { ctx, state }
  }

  it('derives ovr from the prior completed season only, never a season beyond state.season', () => {
    const { ctx, state } = veteranState()
    const next = lifecycle.refreshScouting(state, ctx)
    const view = next.scouting['vet-1']
    expect(view).toBeDefined()
    // Centered on 70 (season 2017's true value) with a small noise band; nowhere near the "future" 99.
    expect(view!.ovr).toBeGreaterThan(55)
    expect(view!.ovr).toBeLessThan(85)
    expect(view!.pot).toBeGreaterThanOrEqual(view!.ovr)
    expect(view!.pot).toBeLessThanOrEqual(99)
  })

  it('is deterministic for the same seed', () => {
    const { ctx, state } = veteranState()
    const a = lifecycle.refreshScouting(state, ctx)
    const b = lifecycle.refreshScouting(state, ctx)
    expect(a.scouting).toEqual(b.scouting)
  })

  it('leaves a rookie (rookieSeason === state.season) scouting untouched', () => {
    const { ctx, state } = veteranState()
    const rookie: Player = { id: 'rookie-1', name: 'rookie-1', pos: 'QB', birthYear: SEASON - 22, draft: null, real: false, rookieSeason: SEASON }
    const preDraftView = { ovr: 55, pot: 80, confidence: 0.2 }
    const withRookie: LeagueState = {
      ...state,
      players: { ...state.players, 'rookie-1': rookie },
      truth: { ...state.truth, 'rookie-1': { bySeason: {}, retiresAfter: null } },
      scouting: { 'rookie-1': preDraftView },
    }
    const next = lifecycle.refreshScouting(withRookie, ctx)
    expect(next.scouting['rookie-1']).toEqual(preDraftView)
  })
})
