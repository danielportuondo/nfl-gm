/**
 * QA 2017 M1: an AI starter cost about a first-round pick, because the starter-loss charge nearly
 * doubled his price (Veldheer, ARI OL 79 at 30: 14.7 of value + 12.4 of charge, p = 5% for a 3rd).
 * Product call: a good starter (consensus ~75, age ≤ 30) costs about a 2nd from an AI team, a star
 * still costs more, and an unlikely offer tells the user roughly what the AI wants instead.
 *
 * Mock league, `balanced`, DAL selling. The user pays with its own picks in the coming draft.
 */
import { describe, expect, it } from 'vitest'
import type { PickRef, PlayerId } from '@contracts/index'
import { trade } from '@engine/trade'
import { AI, putPlayer, scenario, trimRoster, userProposal, type PlayerSpec } from './helpers'

const base = scenario()
const user = base.state.userTeam

function sellerWith(spec: PlayerSpec) {
  return putPlayer(trimRoster(base.state, user, 52), AI, spec)
}

const ownPick = (round: number): PickRef => ({
  season: base.state.season + 1,
  round,
  originalTeam: user,
})

function evaluateFor(spec: PlayerSpec, picks: PickRef[]) {
  const state = sellerWith(spec)
  return trade.evaluate(
    state,
    userProposal(state, { picks }, { players: [spec.id as PlayerId] }),
    base.ctx,
  )
}

const pFor = (spec: PlayerSpec, round: number) => evaluateFor(spec, [ownPick(round)]).p

/** A 75 corner on a fair deal; DAL's next corner is a 61, so his sale opens a real hole. */
const GOOD_CB: PlayerSpec = { id: 'good-cb', pos: 'CB', ovr: 75, age: 27, apy: 5 }
/** Veldheer's shape: a 79 guard at 30 on a market deal, with a 66 behind him. */
const VELDHEER: PlayerSpec = { id: 'veldheer', pos: 'OL', ovr: 79, age: 30, apy: 7 }
const STAR_CB: PlayerSpec = { id: 'star-cb', pos: 'CB', ovr: 87, age: 27, apy: 2 }

describe('trade — a good AI starter costs about a 2nd (QA 2017 M1)', () => {
  it('a 75 starter with a hole behind him goes for a 2nd and not for a 4th', () => {
    const forSecond = evaluateFor(GOOD_CB, [ownPick(2)])
    expect(forSecond.reasons.join(' ')).toMatch(/lose a starter at CB/)
    expect(forSecond.p).toBeGreaterThan(0.65)
    expect(pFor(GOOD_CB, 4)).toBeLessThan(0.25)
  })

  it('the Veldheer shape is a coin flip or better for a 2nd and unlikely for a 3rd', () => {
    expect(pFor(VELDHEER, 2)).toBeGreaterThanOrEqual(0.5)
    expect(pFor(VELDHEER, 3)).toBeLessThan(0.35)
  })

  it('a star still costs more than a 2nd', () => {
    expect(pFor(STAR_CB, 2)).toBeLessThan(0.05)
    expect(evaluateFor(STAR_CB, []).priceHint?.round ?? 0).toBeLessThanOrEqual(1)
  })

  it('the price hint names the round that gets the deal to even', () => {
    for (const spec of [GOOD_CB, VELDHEER]) {
      const hint = evaluateFor(spec, []).priceHint
      expect(hint?.round, spec.id).toBe(2)
      expect(pFor(spec, 2), spec.id).toBeGreaterThanOrEqual(0.5)
      expect(pFor(spec, 3), spec.id).toBeLessThan(0.5)
    }
    // With a 4th already on the table, the hint is the rest of the gap, and adding it gets there.
    const rest = evaluateFor(GOOD_CB, [ownPick(4)]).priceHint?.round
    expect(rest).toBeGreaterThan(3)
    expect(evaluateFor(GOOD_CB, [ownPick(4), ownPick(rest!)]).p).toBeGreaterThanOrEqual(0.5)
    expect(evaluateFor(GOOD_CB, [ownPick(2)]).priceHint).toBeUndefined()
  })
})
