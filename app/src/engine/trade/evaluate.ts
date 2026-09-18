/**
 * Acceptance probability and the hard gates (§6.5).
 *
 * `evaluate` always answers from `proposal.request.teamId`'s side — the counterparty, the team being
 * asked to say yes. It RECEIVES `proposal.offer` (valueIn) and GIVES `proposal.request` (valueOut).
 */
import type { EngineContext, LeagueState, PickRef, PlayerId, TeamId, TradeEvaluation, TradeProposal } from '@contracts/index'
import { acceptanceConstants, needConstants, tradeConstants } from './constants'
import { findPick, incomingValue, injuryWeeks, needsFor, outgoingValue, pickValueImpl, rosterIndex } from './value'

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x))

const pickKey = (ref: PickRef): string => `${ref.season}-${ref.round}-${ref.originalTeam}`

export function isInSeason(state: LeagueState): boolean {
  return (acceptanceConstants.inSeasonPhases as readonly string[]).includes(state.phase)
}

function invalid(reasons: string[], valueIn = 0, valueOut = 0): TradeEvaluation {
  return { valueIn, valueOut, needAdj: 0, margin: 0, p: 0, valid: false, reasons }
}

/** Every asset on a side must exist, be unique, and actually belong to that side. */
function assetErrors(state: LeagueState, side: TradeProposal['offer']): string[] {
  const errors: string[] = []
  const roster = rosterIndex(state)
  const seenPlayers = new Set<PlayerId>()
  for (const id of side.players) {
    if (seenPlayers.has(id)) errors.push(`${id} listed twice`)
    seenPlayers.add(id)
    if (!state.players[id] || !state.scouting[id]) {
      errors.push(`unknown player ${id}`)
      continue
    }
    const slot = roster.get(id)
    if (!slot) errors.push(`${state.players[id]?.name ?? id} is not on a roster`)
    else if (slot.teamId !== side.teamId) errors.push(`${state.players[id]?.name ?? id} is not on ${side.teamId}`)
  }
  const seenPicks = new Set<string>()
  for (const ref of side.picks) {
    const key = pickKey(ref)
    if (seenPicks.has(key)) errors.push(`pick ${key} listed twice`)
    seenPicks.add(key)
    const pick = findPick(state, ref)
    if (!pick) errors.push(`unknown pick ${key}`)
    else if (pick.owner !== side.teamId) errors.push(`${side.teamId} does not own pick ${key}`)
    else if (pick.playerId) errors.push(`pick ${key} has already been used`)
  }
  return errors
}

function payrollDelta(state: LeagueState, incoming: PlayerId[], outgoing: PlayerId[]): number {
  const roster = rosterIndex(state)
  const sum = (ids: PlayerId[]) => ids.reduce((total, id) => total + (roster.get(id)?.contract.apy ?? 0), 0)
  return sum(incoming) - sum(outgoing)
}

/**
 * Salary the trade would add beyond what the team can absorb, or null when it fits (a
 * payroll-neutral or payroll-shedding trade always fits) or when fa cannot answer yet.
 */
function capOverageFrom(state: LeagueState, teamId: TeamId, incoming: PlayerId[], outgoing: PlayerId[], ctx: EngineContext): number | null {
  const delta = payrollDelta(state, incoming, outgoing)
  if (delta <= 0) return null
  let allowance: number
  try {
    allowance = Math.max(0, ctx.modules.fa.capSpace(state, teamId, ctx)) +
      acceptanceConstants.capSlackPct * ctx.modules.fa.capFor(state.season, ctx)
  } catch {
    // fa is mid-rewrite: skip the cap gate rather than reject every trade.
    return null
  }
  return delta > allowance ? delta - allowance : null
}

function rosterSizeError(state: LeagueState, teamId: TeamId, delta: number): string | null {
  const size = (state.teams[teamId]?.roster.length ?? 0) + delta
  if (isInSeason(state)) {
    const { min, max } = acceptanceConstants.rosterInSeason
    if (size > max) return `${teamId} would carry ${size} players (max ${max})`
    if (size < min) return `${teamId} would carry ${size} players (min ${min})`
    return null
  }
  return size > acceptanceConstants.rosterOffseasonMax ? `${teamId} would carry ${size} players (max ${acceptanceConstants.rosterOffseasonMax})` : null
}

function needAdjustment(state: LeagueState, proposal: TradeProposal, valueIn: number, valueOut: number, ctx: EngineContext): number {
  const evaluator = proposal.request.teamId
  const needs = needsFor(state, evaluator, ctx)
  const top = new Set(needs.top.slice(0, needConstants.topNeeds))
  const saturated = new Set(needs.saturated)
  let adj = 0
  for (const id of proposal.offer.players) {
    const pos = state.players[id]?.pos
    if (!pos) continue
    const value = incomingValue(state, id, ctx)
    if (top.has(pos)) adj -= needConstants.topNeedBonusPct * value
    if (saturated.has(pos)) adj += needConstants.saturatedPenaltyPct * value
  }
  for (const id of proposal.request.players) {
    const pos = state.players[id]?.pos
    if (!pos) continue
    if (top.has(pos)) adj += needConstants.losingNeedPenaltyPct * outgoingValue(state, id, ctx)
  }
  const cap = needConstants.capPct * Math.max(1, valueIn, valueOut)
  return Math.max(-cap, Math.min(cap, adj))
}

export function evaluateImpl(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): TradeEvaluation {
  const evaluator = proposal.request.teamId
  const proposer = proposal.offer.teamId

  if (evaluator === proposer) return invalid(['a team cannot trade with itself'])
  if (!state.teams[evaluator] || !state.teams[proposer]) return invalid(['unknown team'])
  const assetCount = proposal.offer.players.length + proposal.offer.picks.length + proposal.request.players.length + proposal.request.picks.length
  if (assetCount === 0) return invalid(['the proposal is empty'])

  const structural = [...assetErrors(state, proposal.offer), ...assetErrors(state, proposal.request)]
  if (structural.length) return invalid(structural)

  const reasons: string[] = []
  const valueIn =
    proposal.offer.players.reduce((total, id) => total + incomingValue(state, id, ctx), 0) +
    proposal.offer.picks.reduce((total, ref) => total + pickValueImpl(state, ref, ctx), 0)
  const valueOut =
    proposal.request.players.reduce((total, id) => total + outgoingValue(state, id, ctx), 0) +
    proposal.request.picks.reduce((total, ref) => total + pickValueImpl(state, ref, ctx), 0)

  for (const id of proposal.offer.players) {
    const weeks = injuryWeeks(state, id)
    if (weeks > 0) reasons.push(`${state.players[id]?.name ?? id} is out ${weeks} week(s) — discounted`)
  }

  // Anti-exploit: no team mortgages more than two first-rounders at once. The user is not gated —
  // their own roster is their problem, and an AI-initiated offer must not fail on the user's side.
  const firstsGiven = proposal.request.picks.filter((ref) => ref.round === 1).length
  const evaluatorIsAi = !state.teams[evaluator]?.userControlled
  if (evaluatorIsAi && firstsGiven > tradeConstants.maxFirstsPerDeal) {
    return invalid([`${evaluator} will not trade ${firstsGiven} first-round picks in one deal`], valueIn, valueOut)
  }

  const sizeErrors = [
    rosterSizeError(state, evaluator, proposal.offer.players.length - proposal.request.players.length),
    rosterSizeError(state, proposer, proposal.request.players.length - proposal.offer.players.length),
  ].filter((e): e is string => e !== null)
  if (sizeErrors.length) return invalid(sizeErrors, valueIn, valueOut)

  if (isInSeason(state)) {
    const overages: [TeamId, number | null][] = [
      [evaluator, capOverageFrom(state, evaluator, proposal.offer.players, proposal.request.players, ctx)],
      [proposer, capOverageFrom(state, proposer, proposal.request.players, proposal.offer.players, ctx)],
    ]
    const capErrors = overages
      .filter((entry): entry is [TeamId, number] => entry[1] !== null)
      .map(([teamId, over]) => `${teamId} cannot absorb $${over.toFixed(1)}M more salary`)
    if (capErrors.length) return invalid(capErrors, valueIn, valueOut)
  }

  const needAdj = needAdjustment(state, proposal, valueIn, valueOut, ctx)
  if (needAdj < 0) reasons.push(`${evaluator} needs help at ${needsFor(state, evaluator, ctx).top.join('/')}`)
  else if (needAdj > 0) reasons.push(`${evaluator} is not short at those positions`)

  const strictnessPct = tradeConstants.marginByStrictness[state.settings.tradeStrictness]
  const annoyance = Math.min(acceptanceConstants.maxAnnoyance, state.teams[evaluator]?.tradeAnnoyance ?? 0)
  const annoyancePct = Math.min(acceptanceConstants.maxAnnoyanceMarginPct, tradeConstants.annoyanceMarginPerPoint * annoyance)
  if (annoyancePct > 0) reasons.push(`${evaluator} is tired of lowball offers`)
  const margin = (strictnessPct + annoyancePct) * valueOut

  const p = sigmoid((valueIn - valueOut - needAdj - margin) / tradeConstants.scale)
  return { valueIn, valueOut, needAdj, margin, p, valid: true, reasons }
}

/** The same deal seen from the other side — how the proposer rates its own offer. */
export function mirror(proposal: TradeProposal): TradeProposal {
  return { ...proposal, offer: proposal.request, request: proposal.offer }
}
