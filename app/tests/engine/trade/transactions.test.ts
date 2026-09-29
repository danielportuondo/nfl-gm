/**
 * Move history: a trade the user's team is part of appends one TRADE Transaction (gave = the user's
 * side, got = the other team's, ovrAtMove read before the move). AI-to-AI trades log nothing.
 */
import { describe, expect, it } from 'vitest'
import type { LeagueState, TradeProposal } from '@contracts/index'
import { trade } from '@engine/trade'
import { mirror } from '@engine/trade/evaluate'
import { AI, STARTER, giftPickAt, putPlayer, scenario, userProposal } from './helpers'

function twoStarters(): { state: LeagueState; proposal: TradeProposal } {
  const base = scenario()
  let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine', ovr: 77 })
  state = putPlayer(state, AI, { ...STARTER, id: 'theirs', ovr: 79 })
  const pick = giftPickAt(state, state.userTeam, 40)
  state = pick.state
  return {
    state,
    proposal: userProposal(
      state,
      { players: ['mine'], picks: [pick.ref] },
      { players: ['theirs'] },
    ),
  }
}

describe('trade.execute — move history', () => {
  it('a user-initiated trade logs one entry with the user side as gave', () => {
    const { ctx } = scenario()
    const { state, proposal } = twoStarters()
    const before = JSON.stringify(state)
    const after = trade.execute(state, proposal, ctx)

    expect(JSON.stringify(state)).toBe(before)
    expect(after.transactions).toHaveLength(state.transactions.length + 1)
    expect(after.transactions.at(-1)).toEqual({
      kind: 'TRADE',
      season: state.season,
      phase: state.phase,
      week: state.week,
      gave: proposal.offer,
      got: proposal.request,
      ovrAtMove: { mine: 77, theirs: 79 },
    })
  })

  it('an AI-initiated trade (user as the request side) is oriented from the user', () => {
    const { ctx } = scenario()
    const { state, proposal } = twoStarters()
    const aiOffer: TradeProposal = { ...mirror(proposal), initiatedBy: 'AI' }
    const after = trade.execute(state, aiOffer, ctx)

    expect(after.transactions).toHaveLength(state.transactions.length + 1)
    const entry = after.transactions.at(-1)!
    expect(entry.kind).toBe('TRADE')
    if (entry.kind !== 'TRADE') return
    expect(entry.gave).toEqual(proposal.offer)
    expect(entry.got).toEqual(proposal.request)
    expect(entry.gave.teamId).toBe(state.userTeam)
    expect(entry.ovrAtMove).toEqual({ mine: 77, theirs: 79 })
  })

  it('a trade between two AI teams logs nothing', () => {
    const { state: base, ctx } = scenario()
    const other = Object.keys(base.teams)
      .sort()
      .find((id) => id !== base.userTeam && id !== AI)!
    let state = putPlayer(base, other, { ...STARTER, id: 'a' })
    state = putPlayer(state, AI, { ...STARTER, id: 'b' })
    const proposal: TradeProposal = {
      id: 'ai-ai',
      offer: { teamId: other, players: ['a'], picks: [] },
      request: { teamId: AI, players: ['b'], picks: [] },
      initiatedBy: 'AI',
      season: state.season,
      week: state.week,
    }
    const after = trade.execute(state, proposal, ctx)
    expect(after.transactions).toEqual(state.transactions)
    expect(after.teams[AI]!.roster.some((r) => r.playerId === 'a')).toBe(true)
  })
})
