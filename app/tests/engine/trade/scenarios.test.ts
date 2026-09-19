/**
 * HANDOFF §6.5 acceptance: hand-written trade scenarios with expected p bands at `balanced`, plus
 * the hard gates and the strictness ordering.
 */
import { describe, expect, it } from 'vitest'
import type { GameSettings, LeagueState } from '@contracts/index'
import { trade } from '@engine/trade'
import {
  AI,
  ELITE,
  SCRUB,
  STARTER,
  giftPickAt,
  giftPicks,
  pickOwnedBy,
  putPlayer,
  scenario,
  trimRoster,
  userProposal,
} from './helpers'

const strictness = (state: LeagueState, level: GameSettings['tradeStrictness']): LeagueState => ({
  ...state,
  settings: { ...state.settings, tradeStrictness: level },
})

describe('trade.evaluate — scenario bands at balanced', () => {
  it('a fair 1-for-1 lands in 0.4–0.7', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: ['mine'] }, { players: ['theirs'] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(true)
    expect(evaluation.p).toBeGreaterThan(0.4)
    expect(evaluation.p).toBeLessThan(0.7)
  })

  it('an obvious fleece for the AI is ≥ 0.9', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, ELITE)
    state = putPlayer(state, AI, SCRUB)
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: [ELITE.id] }, { players: [SCRUB.id] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(true)
    expect(evaluation.p).toBeGreaterThanOrEqual(0.9)
  })

  it('an obvious fleece against the AI is ≤ 0.05', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, SCRUB)
    state = putPlayer(state, AI, ELITE)
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: [SCRUB.id] }, { players: [ELITE.id] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(true)
    expect(evaluation.p).toBeLessThanOrEqual(0.05)
  })

  it('a late first for a good starter is in band', () => {
    const base = scenario()
    let state = trimRoster(base.state, base.state.userTeam, 52)
    state = putPlayer(state, AI, { ...STARTER, id: 'target', apy: 1 })
    const gifted = giftPickAt(state, state.userTeam, 30)
    const evaluation = trade.evaluate(
      gifted.state,
      userProposal(gifted.state, { picks: [gifted.ref] }, { players: ['target'] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(true)
    expect(evaluation.p).toBeGreaterThan(0.25)
    expect(evaluation.p).toBeLessThan(0.8)
  })
})

describe('trade.evaluate — hard gates', () => {
  it('a deal that puts the AI over the cap is invalid with p = 0', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, {
      id: 'albatross',
      pos: 'QB',
      ovr: 84,
      age: 30,
      apy: 40,
      years: 4,
    })
    state = putPlayer(state, AI, SCRUB)
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: ['albatross'] }, { players: [SCRUB.id] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(false)
    expect(evaluation.p).toBe(0)
    expect(evaluation.reasons.join(' ')).toMatch(/absorb/)
  })

  it('asking the AI for three first-round picks is refused outright', () => {
    const base = scenario()
    const state = putPlayer(base.state, base.state.userTeam, ELITE)
    const gifted = giftPicks(state, AI, 1, 3)
    const evaluation = trade.evaluate(
      gifted.state,
      userProposal(gifted.state, { players: [ELITE.id] }, { picks: gifted.refs }),
      base.ctx,
    )
    expect(gifted.refs).toHaveLength(3)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.p).toBe(0)
    expect(evaluation.reasons.join(' ')).toMatch(/first-round picks/)
  })

  it('asking the AI for two first-round picks is allowed', () => {
    const base = scenario()
    const state = trimRoster(putPlayer(base.state, base.state.userTeam, ELITE), AI, 52)
    const gifted = giftPicks(state, AI, 1, 2)
    const evaluation = trade.evaluate(
      gifted.state,
      userProposal(gifted.state, { players: [ELITE.id] }, { picks: gifted.refs }),
      base.ctx,
    )
    expect(gifted.refs).toHaveLength(2)
    expect(evaluation.valid).toBe(true)
  })

  it('an in-season trade that breaks a roster limit is invalid', () => {
    const base = scenario()
    const state = putPlayer(base.state, AI, STARTER)
    const evaluation = trade.evaluate(
      state,
      userProposal(state, {}, { players: [STARTER.id] }),
      base.ctx,
    )
    expect(evaluation.valid).toBe(false)
    expect(evaluation.reasons.join(' ')).toMatch(/would carry 54 players/)
  })

  it('assets the offering side does not own are rejected', () => {
    const base = scenario()
    const state = putPlayer(base.state, AI, STARTER)
    const bad = userProposal(
      state,
      { players: [STARTER.id] },
      { picks: [pickOwnedBy(state, AI, 2)] },
    )
    const evaluation = trade.evaluate(state, bad, base.ctx)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.reasons.join(' ')).toMatch(/is not on IND/)
  })
})

describe('trade.evaluate — strictness and annoyance', () => {
  it('p falls monotonically from lenient to ruthless on the same fair deal', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const proposal = userProposal(state, { players: ['mine'] }, { players: ['theirs'] })
    const ps = (['lenient', 'balanced', 'strict', 'ruthless'] as const).map(
      (level) => trade.evaluate(strictness(state, level), proposal, base.ctx).p,
    )
    expect(ps[0]).toBeGreaterThan(ps[1]!)
    expect(ps[1]).toBeGreaterThan(ps[2]!)
    expect(ps[2]).toBeGreaterThan(ps[3]!)
  })

  it('annoyance raises the bar for the rest of the season', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const proposal = userProposal(state, { players: ['mine'] }, { players: ['theirs'] })
    const calm = trade.evaluate(state, proposal, base.ctx).p
    const annoyed = {
      ...state,
      teams: { ...state.teams, [AI]: { ...state.teams[AI]!, tradeAnnoyance: 5 } },
    }
    const evaluation = trade.evaluate(annoyed, proposal, base.ctx)
    expect(evaluation.p).toBeLessThan(calm)
    expect(evaluation.reasons.join(' ')).toMatch(/lowball/)
  })
})

describe('trade.evaluate — anti-exploit discounts', () => {
  it('an injured incoming player is worth less than the same player healthy', () => {
    const base = scenario()
    let healthy = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    healthy = putPlayer(healthy, AI, { ...STARTER, id: 'theirs' })
    const hurt = putPlayer(healthy, healthy.userTeam, { ...STARTER, id: 'mine', injuredWeeks: 8 })
    const proposal = userProposal(healthy, { players: ['mine'] }, { players: ['theirs'] })
    expect(trade.evaluate(hurt, proposal, base.ctx).valueIn).toBeLessThan(
      trade.evaluate(healthy, proposal, base.ctx).valueIn,
    )
    expect(trade.evaluate(hurt, proposal, base.ctx).reasons.join(' ')).toMatch(/out 8 week/)
  })

  it('a player whose consensus cratered is re-valued both ways', () => {
    const base = scenario()
    const faller = base.state.teams[AI]!.roster.map((r) => r.playerId).find(
      (id) => base.state.scouting[id]!.ovr >= 80,
    )!
    const dropped: typeof base.state = {
      ...base.state,
      scouting: {
        ...base.state.scouting,
        [faller]: { ...base.state.scouting[faller]!, ovr: base.state.scouting[faller]!.ovr - 14 },
      },
    }
    const asBuyer = putPlayer(dropped, dropped.userTeam, { ...STARTER, id: 'mine' })
    // Selling: the AI will not let the faller go at the new, lower price.
    const sellPrice = trade.evaluate(
      asBuyer,
      userProposal(asBuyer, { players: ['mine'] }, { players: [faller] }),
      base.ctx,
    ).valueOut
    expect(sellPrice).toBeGreaterThan(trade.playerValue(asBuyer, faller, base.ctx))
    // Buying: the AI pays even less than the new consensus says.
    const userSide = putPlayer(dropped, dropped.userTeam, { ...STARTER, id: 'mine' })
    const movedToUser = trade.execute(
      userSide,
      userProposal(userSide, { players: ['mine'] }, { players: [faller] }),
      base.ctx,
    )
    const buyPrice = trade.evaluate(
      movedToUser,
      userProposal(movedToUser, { players: [faller] }, { players: ['mine'] }),
      base.ctx,
    ).valueIn
    expect(buyPrice).toBeLessThan(trade.playerValue(movedToUser, faller, base.ctx))
  })
})
