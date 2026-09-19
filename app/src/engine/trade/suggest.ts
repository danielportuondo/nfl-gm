/**
 * Suggested trades (Phase 6). The AI proposes and the user accepts or dismisses: a suggestion sends the
 * user a player at one of their top consensus needs from a team that is not short there, and asks for
 * the user's surplus — players off their need positions, preferably at the AI's own needs — plus pick
 * sweeteners until the AI's own p clears `offerConstants.minAiP`. The same plausibility band as AI
 * offers applies from the user's side. AI-initiated, so accepting one always executes. Consensus only.
 */
import type {
  EngineContext,
  LeagueState,
  PlayerId,
  Position,
  Rng,
  TeamId,
  TradeProposal,
} from '@contracts/index'
import { offerConstants, suggestionConstants } from './constants'
import { acceptableToAi, aiTeams, assemble, propose, tradeablePicks } from './offers'
import { incomingValue, needsFor, outgoingValue } from './value'

interface Valued {
  id: PlayerId
  value: number
}

/** The user's need positions worth suggesting for: deficit order, specialists excluded. */
export function suggestionNeeds(
  state: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
): Position[] {
  const needs = needsFor(state, teamId, ctx)
  const skip = new Set(suggestionConstants.skipPositions)
  return (Object.keys(needs.byPos) as Position[])
    .filter((pos) => !skip.has(pos) && (needs.byPos[pos] ?? 0) > 0)
    .sort((a, b) => (needs.byPos[b] ?? 0) - (needs.byPos[a] ?? 0) || a.localeCompare(b))
    .slice(0, suggestionConstants.needsConsidered)
}

function bestOvrAt(state: LeagueState, teamId: TeamId, pos: Position): number {
  let best = 0
  for (const slot of state.teams[teamId]?.roster ?? []) {
    if (state.players[slot.playerId]?.pos !== pos) continue
    best = Math.max(best, state.scouting[slot.playerId]?.ovr ?? 0)
  }
  return best
}

/**
 * One suggestion from `aiTeam` at `pos`, or null. The AI keeps its best player at the position and
 * offers the next ones down; each must actually be an upgrade on the user's best there.
 */
function suggestionFor(
  state: LeagueState,
  aiTeam: TeamId,
  pos: Position,
  userWanted: ReadonlySet<Position>,
  usedIncoming: ReadonlySet<PlayerId>,
  usedOutgoing: ReadonlySet<PlayerId>,
  ctx: EngineContext,
  rng: Rng,
): TradeProposal | null {
  const aiNeeds = needsFor(state, aiTeam, ctx)
  if (aiNeeds.top.includes(pos)) return null
  const aiWanted = new Set(aiNeeds.top)
  const posOf = (id: PlayerId) => state.players[id]?.pos

  const surplus: Valued[] = (state.teams[aiTeam]?.roster ?? [])
    .filter(
      (slot) => posOf(slot.playerId) === pos && !slot.injured && !usedIncoming.has(slot.playerId),
    )
    .map((slot) => ({ id: slot.playerId, value: outgoingValue(state, slot.playerId, ctx) }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(1, 1 + suggestionConstants.candidatesScanned)

  const userBest = bestOvrAt(state, state.userTeam, pos)
  const userRoster = state.teams[state.userTeam]?.roster ?? []
  const skip = new Set(suggestionConstants.skipPositions)
  const payRatio =
    offerConstants.payRatioMin +
    rng.next() * (offerConstants.payRatioMax - offerConstants.payRatioMin)

  for (const give of surplus) {
    if ((state.scouting[give.id]?.ovr ?? 0) <= userBest) continue
    const ask = give.value / payRatio
    const sendable = userRoster
      .filter((slot) => {
        const p = posOf(slot.playerId)
        return (
          p !== undefined &&
          !userWanted.has(p) &&
          !skip.has(p) &&
          !slot.injured &&
          !usedOutgoing.has(slot.playerId)
        )
      })
      .map((slot) => ({
        id: slot.playerId,
        value: incomingValue(state, slot.playerId, ctx),
        fillsNeed: aiWanted.has(posOf(slot.playerId)!),
      }))
      .filter((c) => c.value <= ask * suggestionConstants.askSlack)
      .sort(
        (a, b) =>
          Number(b.fillsNeed) - Number(a.fillsNeed) ||
          Math.abs(a.value - ask) - Math.abs(b.value - ask) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, suggestionConstants.candidatesScanned)

    for (const send of sendable) {
      const shortfall = ask - send.value
      const sweetener =
        shortfall > 0
          ? assemble(
              tradeablePicks(state, state.userTeam, new Set(), ctx),
              shortfall,
              offerConstants.maxAssetsPerSide - 1,
            )
          : { refs: [], total: 0 }
      const proposal = propose(
        state,
        aiTeam,
        { players: [give.id], picks: [] },
        { players: [send.id], picks: sweetener.refs },
        `sug-${state.phase}-${give.id}`,
      )
      if (acceptableToAi(state, proposal, ctx)) return proposal
    }
  }
  return null
}

export function suggestTradesImpl(
  state: LeagueState,
  ctx: EngineContext,
  rng: Rng,
): TradeProposal[] {
  if (!state.teams[state.userTeam]) return []
  const wanted = suggestionNeeds(state, state.userTeam, ctx)
  if (wanted.length === 0) return []
  const userWanted = new Set(wanted)
  const usedIncoming = new Set<PlayerId>()
  const usedOutgoing = new Set<PlayerId>()
  const out: TradeProposal[] = []

  for (const pos of wanted) {
    let count = 0
    for (const teamId of rng.shuffle(aiTeams(state))) {
      if (count >= suggestionConstants.perNeed || out.length >= suggestionConstants.max) break
      const proposal = suggestionFor(
        state,
        teamId,
        pos,
        userWanted,
        usedIncoming,
        usedOutgoing,
        ctx,
        rng.fork(`${pos}:${teamId}`),
      )
      if (!proposal) continue
      out.push(proposal)
      count++
      for (const id of proposal.offer.players) usedIncoming.add(id)
      for (const id of proposal.request.players) usedOutgoing.add(id)
    }
  }
  return out
}
