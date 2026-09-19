/**
 * lifecycle.progressSeason — acceptance #1 (inside real data, exact trajectory) and #2 (beyond data /
 * procedural, aging-curve sign and rating bounds). See lifecycle brief, HANDOFF §6.7.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, Player, PlayerId, TrueTrajectory } from '@contracts/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { lifecycle } from '@engine/lifecycle'
import { makeFakeContext } from '../fakes'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

describe('lifecycle.progressSeason — inside real data (2015 -> 2016)', () => {
  let ctx: EngineContext
  let state2016: LeagueState

  beforeAll(async () => {
    const manifest = readManifest()
    ctx = await loadRealContext(seasonsForNewGame(2015, manifest.latestRealSeason))
    const state2015 = ctx.modules.league.newGame(
      {
        seed: 'lifecycle-progression',
        startSeason: 2015,
        userTeam: 'IND',
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      },
      ctx,
    )
    const bumped: LeagueState = { ...state2015, season: 2016 }
    const rng = ctx.modules.rng.fromSeed(bumped.seed, 2016, 'progress')
    state2016 = ctx.modules.lifecycle.progressSeason(bumped, ctx, rng)
  })

  it('sets truth[id][2016] to exactly the trajectory value for every player who has one', () => {
    let checked = 0
    for (const [id, compact] of Object.entries(ctx.trajectories)) {
      if (!(id in state2016.players)) continue
      const idx = 2016 - compact.start
      const expected = idx >= 0 && idx < compact.values.length ? compact.values[idx] : null
      if (expected == null) continue
      expect(state2016.truth[id]?.bySeason['2016']).toBe(expected)
      checked++
    }
    // Sanity: the loop actually exercised a meaningful number of real players, not zero.
    expect(checked).toBeGreaterThan(500)
  })
})

// -------------------------------------------------------------------------------------------

function syntheticState(
  season: number,
  players: Record<PlayerId, Player>,
  truth: Record<PlayerId, TrueTrajectory>,
): LeagueState {
  const base = mockLeague({ season })
  return { ...base, players, truth, scouting: {} }
}

function makeSyntheticPlayer(
  id: PlayerId,
  pos: Player['pos'],
  age: number,
  season: number,
  value: number,
): { player: Player; truth: TrueTrajectory } {
  return {
    player: {
      id,
      name: id,
      pos,
      birthYear: season - age,
      draft: null,
      real: false,
      rookieSeason: season - age + 21,
    },
    truth: { bySeason: { [String(season)]: value }, retiresAfter: null },
  }
}

describe('lifecycle.progressSeason — beyond data / procedural (aging curves)', () => {
  const N = 40
  const startSeason = 2015

  it('young QBs trend up, 31+ RBs trend down, and every rating stays in [40,99] over 3 procedural seasons', () => {
    const players: Record<PlayerId, Player> = {}
    const truth: Record<PlayerId, TrueTrajectory> = {}
    for (let i = 0; i < N; i++) {
      const q = makeSyntheticPlayer(`qb-${i}`, 'QB', 24, startSeason, 65)
      const r = makeSyntheticPlayer(`rb-${i}`, 'RB', 32, startSeason, 65)
      players[q.player.id] = q.player
      truth[q.player.id] = q.truth
      players[r.player.id] = r.player
      truth[r.player.id] = r.truth
    }

    let state = syntheticState(startSeason, players, truth)
    const bundle = mockBundle({ season: startSeason })
    const ctx = makeFakeContext(bundle, { lifecycle })

    const qbDeltas: number[] = []
    const rbDeltas: number[] = []
    const allValues: number[] = []

    for (let step = 0; step < 3; step++) {
      const season = startSeason + step + 1
      state = { ...state, season }
      const rng = ctx.modules.rng.fromSeed('procedural-aging', season, 'progress')
      const next = lifecycle.progressSeason(state, ctx, rng)
      for (let i = 0; i < N; i++) {
        const qId = `qb-${i}`
        const rId = `rb-${i}`
        const qBefore = state.truth[qId]!.bySeason[String(season - 1)]!
        const qAfter = next.truth[qId]!.bySeason[String(season)]!
        const rBefore = state.truth[rId]!.bySeason[String(season - 1)]!
        const rAfter = next.truth[rId]!.bySeason[String(season)]!
        qbDeltas.push(qAfter - qBefore)
        rbDeltas.push(rAfter - rBefore)
        allValues.push(qAfter, rAfter)
      }
      state = next
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(qbDeltas)).toBeGreaterThan(0)
    expect(mean(rbDeltas)).toBeLessThan(0)
    for (const v of allValues) {
      expect(v).toBeGreaterThanOrEqual(40)
      expect(v).toBeLessThanOrEqual(99)
    }
  })

  it('is deterministic: the same seed reproduces the same progressed truth', () => {
    const players: Record<PlayerId, Player> = {}
    const truth: Record<PlayerId, TrueTrajectory> = {}
    for (let i = 0; i < 10; i++) {
      const p = makeSyntheticPlayer(`p-${i}`, 'WR', 25, startSeason, 60)
      players[p.player.id] = p.player
      truth[p.player.id] = p.truth
    }
    const bundle = mockBundle({ season: startSeason })
    const ctx = makeFakeContext(bundle, { lifecycle })
    const state = { ...syntheticState(startSeason, players, truth), season: startSeason + 1 }
    const rngA = ctx.modules.rng.fromSeed('same-seed', startSeason + 1, 'progress')
    const rngB = ctx.modules.rng.fromSeed('same-seed', startSeason + 1, 'progress')
    const a = lifecycle.progressSeason(state, ctx, rngA)
    const b = lifecycle.progressSeason(state, ctx, rngB)
    expect(a.truth).toEqual(b.truth)
  })
})
