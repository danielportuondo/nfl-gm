/**
 * engine/trade — asset valuation, acceptance, AI offers, anti-exploit rules (HANDOFF §6.5).
 *
 * Everything the AI knows comes from `state.scouting`; it never reads `state.truth` or
 * `ctx.trajectories`. All randomness is the `rng` the caller passes. Every function is pure.
 */
import type {
  DepthChart, DraftPick, EngineContext, LeagueState, PickRef, PlayerId, Position, Rng, TeamId,
  TeamState, TradeModule, TradeOutcome, TradeProposal,
} from '@contracts/index'
import { acceptanceConstants, tradeConstants } from './constants'
import { evaluateImpl, mirror } from './evaluate'
import { generateAiOffersImpl } from './offers'
import { matchesRef, outgoingValue, pickValueImpl, playerValueImpl, refKey, refOf } from './value'

const keyOfExtra = (extra: { player?: PlayerId; pick?: PickRef }): string =>
  extra.player ?? (extra.pick ? refKey(extra.pick) : '')

function withoutFromChart(chart: DepthChart, pos: Position, playerId: PlayerId): DepthChart {
  const ids = chart[pos]
  if (!ids) return chart
  return { ...chart, [pos]: ids.filter((id) => id !== playerId) }
}

function withInChart(chart: DepthChart, pos: Position, playerId: PlayerId, ovrOf: (id: PlayerId) => number): DepthChart {
  const ids = [...(chart[pos] ?? []).filter((id) => id !== playerId), playerId]
  ids.sort((a, b) => ovrOf(b) - ovrOf(a) || a.localeCompare(b))
  return { ...chart, [pos]: ids }
}

function movePlayer(teams: Record<TeamId, TeamState>, state: LeagueState, playerId: PlayerId, from: TeamId, to: TeamId): void {
  const fromTeam = teams[from]
  const toTeam = teams[to]
  const pos = state.players[playerId]?.pos
  if (!fromTeam || !toTeam || !pos) return
  const slot = fromTeam.roster.find((r) => r.playerId === playerId)
  if (!slot) return
  const ovrOf = (id: PlayerId) => state.scouting[id]?.ovr ?? 0
  teams[from] = {
    ...fromTeam,
    roster: fromTeam.roster.filter((r) => r.playerId !== playerId),
    depthChart: withoutFromChart(fromTeam.depthChart, pos, playerId),
  }
  teams[to] = {
    ...toTeam,
    roster: [...toTeam.roster, { ...slot, teamId: to }],
    depthChart: withInChart(toTeam.depthChart, pos, playerId, ovrOf),
  }
}

function executeImpl(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): LeagueState {
  const a = proposal.offer.teamId
  const b = proposal.request.teamId
  const teams: Record<TeamId, TeamState> = { ...state.teams }
  for (const id of proposal.offer.players) movePlayer(teams, state, id, a, b)
  for (const id of proposal.request.players) movePlayer(teams, state, id, b, a)

  const reowned = <T extends DraftPick>(pick: T): T => {
    if (pick.owner === a && proposal.offer.picks.some((ref) => matchesRef(ref, pick))) return { ...pick, owner: b }
    if (pick.owner === b && proposal.request.picks.some((ref) => matchesRef(ref, pick))) return { ...pick, owner: a }
    return pick
  }

  let next: LeagueState = {
    ...state,
    teams,
    picks: state.picks.map(reowned),
    draftRoom: state.draftRoom ? { ...state.draftRoom, order: state.draftRoom.order.map(reowned) } : state.draftRoom,
  }

  const involved = [...proposal.offer.players, ...proposal.request.players].sort()
  if (involved.length > 0) next = ctx.modules.history.markDiverged(next, involved)
  return next
}

function raiseAnnoyance(state: LeagueState, teamId: TeamId): LeagueState {
  const team = state.teams[teamId]
  if (!team) return state
  const next = Math.min(acceptanceConstants.maxAnnoyance, team.tradeAnnoyance + tradeConstants.annoyancePerLowball)
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, tradeAnnoyance: next } } }
}

/**
 * On a decline, the AI may ask for one more asset from the proposer's side — the cheapest single
 * asset that closes the gap, so the counter is the least insulting one available.
 */
function counterFor(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): TradeProposal | null {
  const evaluation = evaluateImpl(state, proposal, ctx)
  if (!evaluation.valid) return null
  const shortfall = evaluation.valueOut + evaluation.needAdj + evaluation.margin - evaluation.valueIn
  if (shortfall <= 0) return null
  if (shortfall > acceptanceConstants.counterMaxShortfallPct * Math.max(1, evaluation.valueOut)) return null

  const proposer = proposal.offer.teamId
  const ai = proposal.request.teamId
  const alreadyOffered = new Set(proposal.offer.players)

  const candidates: { extra: { player?: PlayerId; pick?: PickRef }; value: number }[] = []
  for (const slot of state.teams[proposer]?.roster ?? []) {
    if (alreadyOffered.has(slot.playerId)) continue
    candidates.push({ extra: { player: slot.playerId }, value: outgoingValue(state, slot.playerId, ctx) })
  }
  for (const pick of state.picks) {
    if (pick.owner !== proposer || pick.playerId) continue
    if (proposal.offer.picks.some((ref) => matchesRef(ref, pick))) continue
    const ref = refOf(pick)
    candidates.push({ extra: { pick: ref }, value: pickValueImpl(state, ref, ctx) })
  }

  const viable = candidates
    .filter((c) => c.value >= shortfall)
    .sort((a, b) => a.value - b.value || keyOfExtra(a.extra).localeCompare(keyOfExtra(b.extra)))

  for (const candidate of viable.slice(0, acceptanceConstants.counterCandidatesScanned)) {
    const counter: TradeProposal = {
      id: `${proposal.id}-counter`,
      offer: { teamId: ai, players: proposal.request.players, picks: proposal.request.picks },
      request: {
        teamId: proposer,
        players: candidate.extra.player ? [...proposal.offer.players, candidate.extra.player] : [...proposal.offer.players],
        picks: candidate.extra.pick ? [...proposal.offer.picks, candidate.extra.pick] : [...proposal.offer.picks],
      },
      initiatedBy: 'AI',
      season: proposal.season,
      week: proposal.week,
    }
    const own = evaluateImpl(state, mirror(counter), ctx)
    if (own.valid && own.p >= acceptanceConstants.counterMinP) return counter
  }
  return null
}

function submitImpl(state: LeagueState, proposal: TradeProposal, ctx: EngineContext, rng: Rng): TradeOutcome {
  const evaluation = evaluateImpl(state, proposal, ctx)

  // The AI stands behind its own offers; the bar on those shows fairness, not doubt.
  if (proposal.initiatedBy === 'AI') {
    if (!evaluation.valid) return { accepted: false, evaluation, counter: null, state }
    return { accepted: true, evaluation, counter: null, state: executeImpl(state, proposal, ctx) }
  }

  if (!evaluation.valid) return { accepted: false, evaluation, counter: null, state }

  if (rng.chance(evaluation.p)) {
    return { accepted: true, evaluation, counter: null, state: executeImpl(state, proposal, ctx) }
  }

  const lowball = evaluation.valueIn < evaluation.valueOut * (1 - acceptanceConstants.lowballGap)
  const declinedState = lowball ? raiseAnnoyance(state, proposal.request.teamId) : state
  return { accepted: false, evaluation, counter: counterFor(state, proposal, ctx), state: declinedState }
}

export const trade: TradeModule = {
  constants: tradeConstants,
  playerValue: playerValueImpl,
  pickValue: pickValueImpl,
  evaluate: evaluateImpl,
  submit: submitImpl,
  execute: executeImpl,
  generateAiOffers: generateAiOffersImpl,
}
