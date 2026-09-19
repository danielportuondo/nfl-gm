/**
 * Suggested trades (Phase 6): every suggestion fills one of the user's top consensus needs with a real
 * upgrade, the AI would take it, and accepting it is a done deal. Real 2015 data so the needs are
 * genuine rather than hand-built.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, TeamId } from '@contracts/index'
import { trade } from '@engine/trade'
import { mirror } from '@engine/trade/evaluate'
import { suggestionNeeds } from '@engine/trade/suggest'
import { loadRealContext } from '../../../scripts/lib/publicData'

const SETTINGS = { tradeStrictness: 'balanced' as const, aiOfferFrequency: 'normal' as const, injuries: true }
const TEAMS: TeamId[] = ['IND', 'CLE', 'SF', 'TEN', 'JAX']

describe('trade.suggestTrades (real 2015 league)', () => {
  let ctx: EngineContext

  beforeAll(async () => {
    ctx = await loadRealContext([2015, 2016, 2017])
  }, 30000)

  function league(userTeam: TeamId, seed = 'suggest'): LeagueState {
    return ctx.modules.league.newGame({ seed, startSeason: 2015, userTeam, horizonSeasons: 3, settings: SETTINGS }, ctx)
  }

  function bestOvrAt(state: LeagueState, teamId: TeamId, pos: string): number {
    return Math.max(
      0,
      ...state.teams[teamId]!.roster
        .filter((r) => state.players[r.playerId]!.pos === pos)
        .map((r) => state.scouting[r.playerId]!.ovr),
    )
  }

  it('fills a top need with an upgrade the AI would accept, and accepting is guaranteed', () => {
    let total = 0
    for (const team of TEAMS) {
      const state = league(team)
      const suggestions = trade.suggestTrades(state, ctx, ctx.modules.rng.fromSeed(state.seed, 2015, 0, 'suggest'))
      const needs = new Set(suggestionNeeds(state, team, ctx))
      expect(suggestions.length).toBeLessThanOrEqual(4)
      for (const s of suggestions) {
        expect(s.initiatedBy).toBe('AI')
        expect(s.request.teamId).toBe(team)
        expect(s.offer.players).toHaveLength(1)
        const incoming = s.offer.players[0]!
        const pos = state.players[incoming]!.pos
        expect(needs.has(pos)).toBe(true)
        expect(state.scouting[incoming]!.ovr).toBeGreaterThan(bestOvrAt(state, team, pos))
        for (const id of s.request.players) expect(needs.has(state.players[id]!.pos)).toBe(false)

        expect(trade.evaluate(state, mirror(s), ctx).p).toBeGreaterThanOrEqual(0.5)
        const user = trade.evaluate(state, s, ctx)
        expect(user.valid).toBe(true)
        expect(user.valueIn / user.valueOut).toBeGreaterThanOrEqual(0.85)

        const outcome = trade.submit(state, s, ctx, ctx.modules.rng.fromSeed('other', 2015, 0, 'roll'))
        expect(outcome.accepted).toBe(true)
        expect(outcome.state.teams[team]!.roster.some((r) => r.playerId === incoming)).toBe(true)
      }
      total += suggestions.length
    }
    expect(total).toBeGreaterThan(0)
  }, 30000)

  it('is deterministic for a seed', () => {
    const a = league('IND')
    const b = league('IND')
    const rngA = ctx.modules.rng.fromSeed(a.seed, 2015, 0, 'suggest')
    const rngB = ctx.modules.rng.fromSeed(b.seed, 2015, 0, 'suggest')
    expect(trade.suggestTrades(a, ctx, rngA)).toEqual(trade.suggestTrades(b, ctx, rngB))
  }, 30000)
})
