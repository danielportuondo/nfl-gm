/**
 * §6.5 acceptance: `execute` moves assets and marks divergence without touching the input state;
 * `submit` rolls against p, raises annoyance on declined lowballs, and honours AI-initiated offers.
 */
import { describe, expect, it } from 'vitest'
import { rng } from '@engine/rng'
import { trade } from '@engine/trade'
import { AI, ELITE, SCRUB, STARTER, giftPickAt, putPlayer, scenario, trimRoster, userProposal } from './helpers'

describe('trade.execute', () => {
  it('moves players and picks, marks divergence, and leaves the input untouched', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const mineFirst = giftPickAt(state, state.userTeam, 30)
    const theirsFirst = giftPickAt(mineFirst.state, AI, 62)
    state = theirsFirst.state
    const proposal = userProposal(
      state,
      { players: ['mine'], picks: [mineFirst.ref] },
      { players: ['theirs'], picks: [theirsFirst.ref] },
    )
    const before = JSON.stringify({ teams: state.teams, picks: state.picks, divergence: [...state.divergence] })

    const after = trade.execute(state, proposal, base.ctx)

    const user = after.teams[state.userTeam]!
    const ai = after.teams[AI]!
    expect(user.roster.map((r) => r.playerId)).toContain('theirs')
    expect(user.roster.map((r) => r.playerId)).not.toContain('mine')
    expect(ai.roster.map((r) => r.playerId)).toContain('mine')
    expect(user.roster.find((r) => r.playerId === 'theirs')!.teamId).toBe(state.userTeam)
    expect(user.roster).toHaveLength(state.teams[state.userTeam]!.roster.length)
    expect(user.depthChart.WR).toContain('theirs')
    expect(user.depthChart.WR).not.toContain('mine')

    const ownerOf = (ref: { season: number; round: number; originalTeam: string }) =>
      after.picks.find((p) => p.season === ref.season && p.round === ref.round && p.originalTeam === ref.originalTeam)!.owner
    expect(ownerOf(mineFirst.ref)).toBe(AI)
    expect(ownerOf(theirsFirst.ref)).toBe(state.userTeam)

    expect([...after.divergence].sort()).toEqual(['mine', 'theirs'])
    expect(JSON.stringify({ teams: state.teams, picks: state.picks, divergence: [...state.divergence] })).toBe(before)
  })
})

describe('trade.submit', () => {
  it('accepts a fleece in the AI’s favour and applies it', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, ELITE)
    state = putPlayer(state, AI, SCRUB)
    const proposal = userProposal(state, { players: [ELITE.id] }, { players: [SCRUB.id] })
    const outcome = trade.submit(state, proposal, base.ctx, rng.fromSeed('t', 'submit', 1))
    expect(outcome.accepted).toBe(true)
    expect(outcome.state.teams[AI]!.roster.map((r) => r.playerId)).toContain(ELITE.id)
  })

  it('declines a lowball, raises annoyance, and leaves the rosters alone', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, SCRUB)
    state = putPlayer(state, AI, ELITE)
    const proposal = userProposal(state, { players: [SCRUB.id] }, { players: [ELITE.id] })
    const outcome = trade.submit(state, proposal, base.ctx, rng.fromSeed('t', 'submit', 2))
    expect(outcome.accepted).toBe(false)
    expect(outcome.state.teams[AI]!.tradeAnnoyance).toBe(state.teams[AI]!.tradeAnnoyance + trade.constants.annoyancePerLowball)
    expect(outcome.state.teams[AI]!.roster.map((r) => r.playerId)).toContain(ELITE.id)
  })

  it('counters a near-miss by asking for one more asset from the user', () => {
    const base = scenario()
    let state = trimRoster(base.state, AI, 52)
    state = putPlayer(state, state.userTeam, { ...STARTER, id: 'mine', ovr: 80, apy: 2 })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs', ovr: 82, apy: 1 })
    const proposal = userProposal(state, { players: ['mine'] }, { players: ['theirs'] })
    const outcomes = Array.from({ length: 8 }, (_, i) => trade.submit(state, proposal, base.ctx, rng.fromSeed('t', 'counter', i)))
    const counter = outcomes.find((o) => o.counter)?.counter
    expect(counter).toBeTruthy()
    expect(counter!.initiatedBy).toBe('AI')
    expect(counter!.request.teamId).toBe(state.userTeam)
    const added = counter!.request.players.length + counter!.request.picks.length
    expect(added).toBe(2)
    expect(trade.evaluate(state, counter!, base.ctx).valid).toBe(true)
  })

  it('always accepts its own offer', () => {
    const base = scenario()
    let state = trimRoster(base.state, base.state.userTeam, 52)
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs', apy: 1 })
    const aiOffer = {
      ...userProposal(state, { players: [] }, { players: [] }),
      offer: { teamId: AI, players: ['theirs'], picks: [] },
      request: { teamId: state.userTeam, players: [], picks: [] },
      initiatedBy: 'AI' as const,
    }
    const outcome = trade.submit(state, aiOffer, base.ctx, rng.fromSeed('t', 'own', 1))
    expect(outcome.accepted).toBe(true)
    expect(outcome.state.teams[state.userTeam]!.roster.map((r) => r.playerId)).toContain('theirs')
  })

  it('is deterministic: the same seed gives the same outcome', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const proposal = userProposal(state, { players: ['mine'] }, { players: ['theirs'] })
    const first = trade.submit(state, proposal, base.ctx, rng.fromSeed(state.seed, 'submit', 7))
    const second = trade.submit(state, proposal, base.ctx, rng.fromSeed(state.seed, 'submit', 7))
    expect(first.accepted).toBe(second.accepted)
    expect(first.evaluation.p).toBe(second.evaluation.p)
    expect(JSON.stringify(first.state.teams)).toBe(JSON.stringify(second.state.teams))
  })

  it('rolls against p: a coin-flip deal lands near its probability over many seeds', () => {
    const base = scenario()
    let state = putPlayer(base.state, base.state.userTeam, { ...STARTER, id: 'mine' })
    state = putPlayer(state, AI, { ...STARTER, id: 'theirs' })
    const proposal = userProposal(state, { players: ['mine'] }, { players: ['theirs'] })
    const p = trade.evaluate(state, proposal, base.ctx).p
    const trials = 200
    const accepted = Array.from({ length: trials }, (_, i) =>
      trade.submit(state, proposal, base.ctx, rng.fromSeed('roll', i)).accepted,
    ).filter(Boolean).length
    expect(Math.abs(accepted / trials - p)).toBeLessThan(0.1)
  })
})

describe('compensatory picks', () => {
  it('trading one of two same-round picks from the same original team moves only that pick', () => {
    const base = scenario()
    const own = base.state.picks.find((p) => p.round === 3 && p.owner === AI && !p.playerId)!
    // A compensatory pick: same season, round and original team, its own overall number.
    const comp = { ...own, pick: 3 * 32 + 40 }
    const state = { ...base.state, picks: [...base.state.picks, comp] }
    const compRef = { season: comp.season, round: comp.round, originalTeam: comp.originalTeam, pick: comp.pick }
    const proposal = userProposal(state, { players: [] }, { picks: [compRef] })

    const after = trade.execute(state, proposal, base.ctx)

    const owners = after.picks
      .filter((p) => p.season === own.season && p.round === 3 && p.originalTeam === own.originalTeam)
      .map((p) => [p.pick, p.owner])
    expect(owners).toContainEqual([comp.pick, state.userTeam])
    expect(owners).toContainEqual([own.pick, AI])
  })
})
