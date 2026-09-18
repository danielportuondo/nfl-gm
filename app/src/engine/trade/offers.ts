/**
 * AI-initiated offers (§6.5). The AI is the proposer, so `offer.teamId` is the AI and
 * `request.teamId` is the user; `evaluate` on the proposal therefore shows the user how fair it is,
 * while `evaluate(mirror(proposal))` is the AI's own acceptance probability, which must be ≥ 0.5.
 *
 * In-season offers are player-for-player (plus pick sweeteners) so neither roster leaves the 46–53
 * window; draft offers are picks-for-picks, which no roster limit touches.
 */
import type { EngineContext, LeagueState, PickRef, PlayerId, Rng, TeamId, TradeProposal } from '@contracts/index'
import { evaluateImpl, mirror } from './evaluate'
import { offerConstants } from './constants'
import { incomingValue, needsFor, outgoingValue, pickValueImpl } from './value'

const refKey = (ref: PickRef): string => `${ref.season}-${ref.round}-${ref.originalTeam}`

interface Valued {
  ref: PickRef
  value: number
}

function aiTeams(state: LeagueState): TeamId[] {
  return Object.keys(state.teams)
    .sort()
    .filter((id) => id !== state.userTeam && !state.teams[id]?.userControlled)
}

function tradeablePicks(state: LeagueState, teamId: TeamId, exclude: Set<string>, ctx: EngineContext): Valued[] {
  return state.picks
    .filter((p) => p.owner === teamId && !p.playerId)
    .map((p) => ({ ref: { season: p.season, round: p.round, originalTeam: p.originalTeam }, value: 0 }))
    .filter((c) => !exclude.has(refKey(c.ref)))
    .map((c) => ({ ref: c.ref, value: pickValueImpl(state, c.ref, ctx) }))
    .sort((a, b) => b.value - a.value || refKey(a.ref).localeCompare(refKey(b.ref)))
}

/**
 * Largest bundle of picks that fits inside `budget`. It must never overshoot: the budget is already
 * the most the AI can pay and still rate its own offer at p ≥ 0.5, so an overshoot means the AI
 * proposes a deal it would itself turn down.
 */
function assemble(candidates: Valued[], budget: number, maxAssets: number): { refs: PickRef[]; total: number } {
  const refs: PickRef[] = []
  let total = 0
  for (const candidate of candidates) {
    if (refs.length >= maxAssets) break
    if (total + candidate.value > budget) continue
    refs.push(candidate.ref)
    total += candidate.value
  }
  return { refs, total }
}

function propose(
  state: LeagueState,
  aiTeam: TeamId,
  gives: { players: PlayerId[]; picks: PickRef[] },
  asks: { players: PlayerId[]; picks: PickRef[] },
  suffix: string,
): TradeProposal {
  return {
    id: `ai-${state.season}-${state.week}-${aiTeam}-${suffix}`,
    offer: { teamId: aiTeam, players: gives.players, picks: gives.picks },
    request: { teamId: state.userTeam, players: asks.players, picks: asks.picks },
    initiatedBy: 'AI',
    season: state.season,
    week: state.week,
  }
}

/** An offer only ships when the AI would take it and the user is not being robbed blind. */
function acceptableToAi(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): boolean {
  const own = evaluateImpl(state, mirror(proposal), ctx)
  if (!own.valid || own.p < offerConstants.minAiP) return false
  const userSide = evaluateImpl(state, proposal, ctx)
  if (!userSide.valid || userSide.valueOut <= 0) return false
  const ratio = userSide.valueIn / userSide.valueOut
  return ratio >= offerConstants.bandMin && ratio <= offerConstants.bandMax
}

function draftOffers(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[] {
  const room = state.draftRoom
  if (!room || room.status !== 'ON_CLOCK') return []
  const current = room.order[room.currentPickIndex]
  if (!current || current.owner !== state.userTeam || current.playerId) return []

  const targetRef: PickRef = { season: current.season, round: current.round, originalTeam: current.originalTeam }
  const targetValue = pickValueImpl(state, targetRef, ctx)
  if (targetValue <= 0) return []

  const wantedPositions = new Set(
    room.available.slice(0, offerConstants.topProspectsConsidered).map((id) => state.players[id]?.pos).filter(Boolean),
  )
  const interested = aiTeams(state).filter((id) =>
    needsFor(state, id, ctx).top.some((pos) => wantedPositions.has(pos)),
  )
  if (interested.length === 0) return []

  const wanted = rng.int(0, offerConstants.draftOfferMax)
  if (wanted === 0) return []

  const offers: TradeProposal[] = []
  for (const teamId of rng.shuffle(interested)) {
    if (offers.length >= wanted) break
    const teamRng = rng.fork(teamId)
    const payRatio = offerConstants.payRatioMin + teamRng.next() * (offerConstants.payRatioMax - offerConstants.payRatioMin)
    const bundle = assemble(
      tradeablePicks(state, teamId, new Set([refKey(targetRef)]), ctx),
      targetValue * payRatio,
      offerConstants.maxAssetsPerSide,
    )
    if (bundle.refs.length === 0) continue
    const proposal = propose(state, teamId, { players: [], picks: bundle.refs }, { players: [], picks: [targetRef] }, 'up')
    if (acceptableToAi(state, proposal, ctx)) offers.push(proposal)
  }
  return offers
}

function seasonOffer(state: LeagueState, teamId: TeamId, ctx: EngineContext, rng: Rng): TradeProposal | null {
  const needs = needsFor(state, teamId, ctx)
  if (needs.top.length === 0) return null
  const wanted = new Set(needs.top)
  const userRoster = state.teams[state.userTeam]?.roster ?? []
  const ownRoster = state.teams[teamId]?.roster ?? []

  const posOf = (id: PlayerId) => state.players[id]?.pos
  const targets = userRoster
    .filter((slot) => {
      const pos = posOf(slot.playerId)
      return pos !== undefined && wanted.has(pos) && !slot.injured
    })
    .map((slot) => ({ id: slot.playerId, value: incomingValue(state, slot.playerId, ctx) }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, offerConstants.candidatesScanned)
  if (targets.length === 0) return null

  const payRatio = offerConstants.payRatioMin + rng.next() * (offerConstants.payRatioMax - offerConstants.payRatioMin)

  for (const target of targets) {
    const budget = target.value * payRatio
    // Never gut the position the AI is trying to fix: the player it sends comes from elsewhere.
    const sendable = ownRoster
      .filter((slot) => {
        const pos = posOf(slot.playerId)
        return pos !== undefined && !wanted.has(pos)
      })
      .map((slot) => ({ id: slot.playerId, value: outgoingValue(state, slot.playerId, ctx) }))
      .sort((a, b) => Math.abs(a.value - budget) - Math.abs(b.value - budget) || a.id.localeCompare(b.id))
      .slice(0, offerConstants.candidatesScanned)

    for (const send of sendable) {
      const shortfall = budget - send.value
      const sweetener = shortfall > 0
        ? assemble(tradeablePicks(state, teamId, new Set(), ctx), shortfall, offerConstants.maxAssetsPerSide - 1)
        : { refs: [], total: 0 }
      const proposal = propose(state, teamId, { players: [send.id], picks: sweetener.refs }, { players: [target.id], picks: [] }, target.id)
      if (acceptableToAi(state, proposal, ctx)) return proposal
    }
  }
  return null
}

function seasonOffers(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[] {
  const [low, high] = offerConstants.countByFrequency[state.settings.aiOfferFrequency] ?? [0, 0]
  const wanted = rng.int(low, high)
  if (wanted <= 0) return []
  const candidates = aiTeams(state)
  if (candidates.length === 0) return []
  const offers: TradeProposal[] = []
  for (const teamId of rng.shuffle(candidates)) {
    if (offers.length >= wanted) break
    const proposal = seasonOffer(state, teamId, ctx, rng.fork(teamId))
    if (proposal) offers.push(proposal)
  }
  return offers
}

export function generateAiOffersImpl(
  state: LeagueState,
  ctx: EngineContext,
  rng: Rng,
  context: 'draft' | 'season',
): TradeProposal[] {
  return context === 'draft' ? draftOffers(state, ctx, rng) : seasonOffers(state, ctx, rng)
}
