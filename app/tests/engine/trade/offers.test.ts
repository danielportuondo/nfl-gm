/**
 * §6.5 acceptance: AI-initiated offers are well-formed, the AI would take its own offer (p ≥ 0.5),
 * and the same seed always produces the same offers.
 */
import { describe, expect, it } from 'vitest'
import type { GameSettings, LeagueState, TradeProposal } from '@contracts/index'
import { rng } from '@engine/rng'
import { trade } from '@engine/trade'
import { draftRoomOnUserClock, scenario } from './helpers'

const mirror = (proposal: TradeProposal): TradeProposal => ({ ...proposal, offer: proposal.request, request: proposal.offer })

function inSeason(state: LeagueState, frequency: GameSettings['aiOfferFrequency']): LeagueState {
  return { ...state, phase: 'REGULAR', week: 6, settings: { ...state.settings, aiOfferFrequency: frequency } }
}

describe('trade.generateAiOffers — in season', () => {
  it('produces offers the AI itself would accept, addressed to the user', () => {
    const base = scenario()
    const state = inSeason(base.state, 'aggressive')
    const seeds = Array.from({ length: 12 }, (_, i) => i)
    const all = seeds.flatMap((i) => trade.generateAiOffers(state, base.ctx, rng.fromSeed('offers', i), 'season'))
    expect(all.length).toBeGreaterThan(0)
    for (const proposal of all) {
      expect(proposal.initiatedBy).toBe('AI')
      expect(proposal.request.teamId).toBe(state.userTeam)
      expect(proposal.offer.teamId).not.toBe(state.userTeam)
      const own = trade.evaluate(state, mirror(proposal), base.ctx)
      expect(own.valid).toBe(true)
      expect(own.p).toBeGreaterThanOrEqual(0.5)
      expect(trade.evaluate(state, proposal, base.ctx).valid).toBe(true)
    }
  })

  it('respects aiOfferFrequency', () => {
    const base = scenario()
    const counts = (frequency: GameSettings['aiOfferFrequency']) =>
      Array.from({ length: 20 }, (_, i) =>
        trade.generateAiOffers(inSeason(base.state, frequency), base.ctx, rng.fromSeed('freq', i), 'season').length,
      )
    expect(Math.max(...counts('rare'))).toBeLessThanOrEqual(1)
    expect(Math.max(...counts('normal'))).toBeLessThanOrEqual(2)
    expect(Math.max(...counts('aggressive'))).toBeLessThanOrEqual(3)
  })

  it('is deterministic for a given seed', () => {
    const base = scenario()
    const state = inSeason(base.state, 'aggressive')
    const once = trade.generateAiOffers(state, base.ctx, rng.fromSeed(state.seed, 2015, 6, 'aiOffers'), 'season')
    const twice = trade.generateAiOffers(state, base.ctx, rng.fromSeed(state.seed, 2015, 6, 'aiOffers'), 'season')
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice))
  })
})

describe('trade.generateAiOffers — draft', () => {
  it('offers picks for the pick the user is on the clock with', () => {
    const base = scenario()
    const state = draftRoomOnUserClock(base.state, base.ctx)
    const room = state.draftRoom!
    expect(room.currentPickIndex).toBeGreaterThanOrEqual(0)
    const target = room.order[room.currentPickIndex]!

    const all = Array.from({ length: 12 }, (_, i) =>
      trade.generateAiOffers(state, base.ctx, rng.fromSeed('draft-offers', i), 'draft'),
    )
    for (const offers of all) expect(offers.length).toBeLessThanOrEqual(3)
    const flat = all.flat()
    expect(flat.length).toBeGreaterThan(0)
    for (const proposal of flat) {
      expect(proposal.request.picks).toEqual([{ season: target.season, round: target.round, originalTeam: target.originalTeam, pick: target.pick }])
      expect(proposal.request.players).toEqual([])
      expect(proposal.offer.picks.length).toBeGreaterThan(0)
      const own = trade.evaluate(state, mirror(proposal), base.ctx)
      expect(own.valid).toBe(true)
      expect(own.p).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('offers nothing when the user is not on the clock', () => {
    const base = scenario()
    const state = draftRoomOnUserClock(base.state, base.ctx)
    const room = state.draftRoom!
    const elsewhere: LeagueState = {
      ...state,
      draftRoom: { ...room, currentPickIndex: room.order.findIndex((pick) => pick.owner !== state.userTeam) },
    }
    expect(trade.generateAiOffers(elsewhere, base.ctx, rng.fromSeed('none', 1), 'draft')).toEqual([])
    expect(trade.generateAiOffers(base.state, base.ctx, rng.fromSeed('none', 1), 'draft')).toEqual([])
  })
})
