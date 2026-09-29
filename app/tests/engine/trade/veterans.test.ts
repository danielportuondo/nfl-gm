/**
 * Expensive and ageing stars (2026-09-28 bug: AI teams offered a 2017 Tom Brady for a backup LB and a
 * 7th, and Cam Newton for a fringe WR, at "50% Fair"). Shapes copy the real 2017 consensus: Brady ovr
 * 83.1 at 40 on 6.4% of the cap for 5 years, Newton 71.5 at 28 on 11.8% for 5, Hewitt LB 65.8 at 24 and
 * Scott WR 54.7 at 25 on minimum deals.
 */
import { describe, expect, it } from 'vitest'
import type {
  EngineContext,
  GameSettings,
  LeagueState,
  PlayerId,
  TeamId,
  TradeProposal,
} from '@contracts/index'
import { trade } from '@engine/trade'
import { mirror } from '@engine/trade/evaluate'
import { AI, pickOwnedBy, putPlayer, scenario, userProposal, type PlayerSpec } from './helpers'

const STRICTNESS: GameSettings['tradeStrictness'][] = ['lenient', 'balanced', 'strict', 'ruthless']

const withStrictness = (state: LeagueState, level: GameSettings['tradeStrictness']) => ({
  ...state,
  settings: { ...state.settings, tradeStrictness: level },
})

function capShare(state: LeagueState, ctx: EngineContext, pct: number): number {
  return (ctx.data.cap.bySeason[String(state.season)] ?? 200) * pct
}

/** `putPlayer`, then move the new man to the front so the next `putPlayer` does not drop him. */
function putKept(state: LeagueState, teamId: TeamId, spec: PlayerSpec): LeagueState {
  const next = putPlayer(state, teamId, spec)
  const team = next.teams[teamId]!
  const added = team.roster[team.roster.length - 1]!
  return {
    ...next,
    teams: { ...next.teams, [teamId]: { ...team, roster: [added, ...team.roster.slice(0, -1)] } },
  }
}

/** Room under the cap to take on a big contract: everyone else on `teamId` drops to a minimum deal. */
function cheapRoster(state: LeagueState, teamId: TeamId): LeagueState {
  const team = state.teams[teamId]!
  const roster = team.roster.map((slot) => ({ ...slot, contract: { ...slot.contract, apy: 0.5 } }))
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster } } }
}

/** Every other player at `pos` on `teamId` drops to a consensus 50, so the spec'd one is the starter. */
function soleStarter(state: LeagueState, teamId: TeamId, keep: PlayerId): LeagueState {
  const scouting = { ...state.scouting }
  for (const slot of state.teams[teamId]!.roster) {
    const pos = state.players[slot.playerId]!.pos
    if (slot.playerId !== keep && pos === state.players[keep]!.pos)
      scouting[slot.playerId] = { ...scouting[slot.playerId]!, ovr: 50, pot: 50 }
  }
  return { ...state, scouting }
}

function bradyDeal(): { state: LeagueState; ctx: EngineContext; proposal: TradeProposal } {
  const { state: base, ctx } = scenario()
  const brady: PlayerSpec = {
    id: 'brady',
    pos: 'QB',
    ovr: 83.1,
    age: 40,
    apy: capShare(base, ctx, 0.064),
    years: 5,
  }
  const backup: PlayerSpec = { id: 'hoyer', pos: 'QB', ovr: 69.8, age: 31, apy: 2, years: 2 }
  const hewitt: PlayerSpec = {
    id: 'hewitt',
    pos: 'LB',
    ovr: 65.8,
    pot: 68,
    age: 24,
    apy: 0.45,
    years: 3,
  }
  let state = soleStarter(putKept(cheapRoster(base, base.userTeam), AI, brady), AI, 'brady')
  state = putKept(state, AI, backup)
  state = putPlayer(state, state.userTeam, hewitt)
  const r7 = pickOwnedBy(state, state.userTeam, 7)
  const proposal = userProposal(state, { players: ['hewitt'], picks: [r7] }, { players: ['brady'] })
  return { state, ctx, proposal }
}

function newtonDeal(): { state: LeagueState; ctx: EngineContext; proposal: TradeProposal } {
  const { state: base, ctx } = scenario()
  const newton: PlayerSpec = {
    id: 'newton',
    pos: 'QB',
    ovr: 71.5,
    pot: 71.9,
    age: 28,
    apy: capShare(base, ctx, 0.118),
    years: 5,
  }
  const scott: PlayerSpec = { id: 'scott', pos: 'WR', ovr: 54.7, pot: 56.2, age: 25, apy: 0.43 }
  let state = putPlayer(cheapRoster(base, base.userTeam), AI, newton)
  state = soleStarter(state, AI, 'newton')
  state = putPlayer(state, state.userTeam, scott)
  const proposal = userProposal(state, { players: ['scott'] }, { players: ['newton'] })
  return { state, ctx, proposal }
}

/** The AI's side of `proposal` framed as its own offer to the user, the way offers and suggestions are. */
const asAiOffer = (proposal: TradeProposal): TradeProposal => ({
  ...mirror(proposal),
  initiatedBy: 'AI',
})

describe('trade — expensive and ageing stars are not scraps', () => {
  it('a 72-ovr QB on a big deal is worth at least 5× a minimum-salary 55-ovr player', () => {
    const { state: base, ctx } = scenario()
    let state = putKept(base, AI, {
      id: 'vet-qb',
      pos: 'QB',
      ovr: 72,
      age: 28,
      apy: capShare(base, ctx, 0.118),
      years: 5,
    })
    state = putPlayer(state, AI, { id: 'fringe', pos: 'WR', ovr: 55, age: 25, apy: 0.45 })
    const qb = trade.playerValue(state, 'vet-qb', ctx)
    const fringe = trade.playerValue(state, 'fringe', ctx)
    expect(qb).toBeGreaterThanOrEqual(5 * fringe)
  })

  it('the Brady-shaped deal: AI p ≤ 0.05 at balanced and ≤ 0.02 at ruthless', () => {
    const { state, ctx, proposal } = bradyDeal()
    const balanced = trade.evaluate(withStrictness(state, 'balanced'), proposal, ctx)
    const ruthless = trade.evaluate(withStrictness(state, 'ruthless'), proposal, ctx)
    expect(balanced.valid, balanced.reasons.join('; ')).toBe(true)
    expect(balanced.p).toBeLessThanOrEqual(0.05)
    expect(ruthless.p).toBeLessThanOrEqual(0.02)
  })

  it('the Newton-shaped deal: AI p ≤ 0.02 at every strictness', () => {
    const { state, ctx, proposal } = newtonDeal()
    for (const level of STRICTNESS) {
      const evaluation = trade.evaluate(withStrictness(state, level), proposal, ctx)
      expect(evaluation.valid, evaluation.reasons.join('; ')).toBe(true)
      expect(evaluation.p, level).toBeLessThanOrEqual(0.02)
    }
  })

  it('the AI getting back 10% of a ~4-point asset is refused (p ≤ 0.05)', () => {
    const { state: base, ctx } = scenario()
    let state = putPlayer(base, AI, { id: 'depth', pos: 'WR', ovr: 64, age: 26, apy: 0.5 })
    state = putPlayer(state, state.userTeam, { id: 'body', pos: 'WR', ovr: 50, age: 29, apy: 0.5 })
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: ['body'] }, { players: ['depth'] }),
      ctx,
    )
    expect(evaluation.valueOut).toBeGreaterThan(3)
    expect(evaluation.valueOut).toBeLessThan(6)
    expect(evaluation.valueIn).toBeLessThanOrEqual(0.12 * evaluation.valueOut)
    expect(evaluation.p).toBeLessThanOrEqual(0.05)
  })
})

describe('trade.fairness', () => {
  it('an even swap reads 0.5 from either side', () => {
    const { state: base, ctx } = scenario()
    const spec: PlayerSpec = { id: 'a', pos: 'WR', ovr: 76, age: 26, apy: 4 }
    let state = putPlayer(base, base.userTeam, spec)
    state = putPlayer(state, AI, { ...spec, id: 'b' })
    const proposal = userProposal(state, { players: ['a'] }, { players: ['b'] })
    expect(trade.fairness(state, proposal, ctx)).toBeCloseTo(0.5, 6)
    expect(trade.fairness(state, asAiOffer(proposal), ctx)).toBeCloseTo(0.5, 6)
  })

  it('Brady for a backup LB and a 7th reads well above 0.65 for the user', () => {
    const { state, ctx, proposal } = bradyDeal()
    const offer = asAiOffer(proposal)
    expect(offer.request.teamId).toBe(state.userTeam)
    expect(trade.fairness(state, offer, ctx)).toBeGreaterThan(0.65)
    expect(trade.fairness(state, proposal, ctx)).toBeGreaterThan(0.65)
  })

  it('an empty-valued deal is even', () => {
    const { state, ctx } = scenario()
    expect(trade.fairness(state, userProposal(state, {}, {}), ctx)).toBe(0.5)
  })
})

describe('trade — AI-initiated deals never give away a team’s top player at a position', () => {
  function topAt(state: LeagueState, teamId: TeamId, id: PlayerId): boolean {
    const pos = state.players[id]!.pos
    const ovr = state.scouting[id]!.ovr
    return state.teams[teamId]!.roster.every(
      (slot) =>
        slot.playerId === id ||
        state.players[slot.playerId]!.pos !== pos ||
        (state.scouting[slot.playerId]?.ovr ?? 0) < ovr,
    )
  }

  /** The user's QB room is empty-handed, so QB is the need every AI team is asked to fill. */
  function qbNeedy(state: LeagueState): LeagueState {
    const scouting = { ...state.scouting }
    for (const slot of state.teams[state.userTeam]!.roster)
      if (state.players[slot.playerId]!.pos === 'QB')
        scouting[slot.playerId] = { ...scouting[slot.playerId]!, ovr: 45, pot: 45 }
    return { ...state, scouting }
  }

  it('neither the Brady nor the Newton shape is ever suggested or offered', () => {
    for (const build of [bradyDeal, newtonDeal]) {
      const { state: base, ctx, proposal } = build()
      const star = proposal.request.players[0]!
      for (const level of STRICTNESS) {
        const state = qbNeedy(withStrictness(base, level))
        for (let i = 0; i < 12; i++) {
          const r = ctx.modules.rng.fromSeed(state.seed, 'veterans', level, i)
          const deals = [
            ...trade.suggestTrades(state, ctx, r.fork('suggest')),
            ...trade.generateAiOffers(state, ctx, r.fork('offers'), 'season'),
          ]
          for (const deal of deals) expect(deal.offer.players, `${level} #${i}`).not.toContain(star)
        }
      }
    }
  })

  it('no suggestion or offer sends the proposing team’s top consensus player at his position', () => {
    const { state: base, ctx } = scenario()
    const state = qbNeedy(base)
    let seen = 0
    for (let i = 0; i < 12; i++) {
      const r = ctx.modules.rng.fromSeed(state.seed, 'top-player', i)
      const deals = [
        ...trade.suggestTrades(state, ctx, r.fork('suggest')),
        ...trade.generateAiOffers(state, ctx, r.fork('offers'), 'season'),
      ]
      for (const deal of deals) {
        for (const id of deal.offer.players) {
          seen++
          expect(topAt(state, deal.offer.teamId, id), `${deal.offer.teamId} ${id}`).toBe(false)
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})
