/**
 * Suggested trades (Phase 6). The AI proposes and the user accepts or dismisses: a suggestion sends the
 * user a player who clearly upgrades the weakest starter at one of their real needs (a starting slot
 * below `needConstants.starterTarget`), from a team that is not short there, and asks for the user's
 * surplus — never one of their starters, preferably players at the AI's own needs — plus pick
 * sweeteners until the AI's own p clears `offerConstants.minAiP`. The same plausibility band as AI
 * offers applies from the user's side. AI-initiated, so accepting one always executes. Consensus only.
 */
import {
  STARTER_TEMPLATE,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Position,
  type Rng,
  type TeamId,
  type TradeProposal,
} from '@contracts/index'
import { needConstants, offerConstants, pickConstants, suggestionConstants } from './constants'
import { acceptableToAi, aiTeams, assemble, propose, tradeablePicks } from './offers'
import { depthAt, incomingValueFor, isStarter, outgoingValueFor, startingSlots } from './lineup'
import { needsFor, topByOvrAtPosition } from './value'

interface Valued {
  id: PlayerId
  value: number
}

/** Consensus ovr of `teamId`'s weakest starter at `pos` — an empty slot reads as replacement level. */
export function weakestStarterOvr(state: LeagueState, teamId: TeamId, pos: Position): number {
  const id = depthAt(state, teamId, pos)[startingSlots(pos) - 1]
  return id === undefined
    ? pickConstants.replacementOvr
    : (state.scouting[id]?.ovr ?? pickConstants.replacementOvr)
}

/**
 * The user's real needs: positions whose weakest starter sits at least `minNeedDeficit` below
 * `needConstants.starterTarget`, biggest hole first, specialists excluded.
 */
export function suggestionNeeds(state: LeagueState, teamId: TeamId): Position[] {
  const skip = new Set(suggestionConstants.skipPositions)
  const deficit = (pos: Position) =>
    needConstants.starterTarget - weakestStarterOvr(state, teamId, pos)
  return (Object.keys(STARTER_TEMPLATE) as Position[])
    .filter((pos) => !skip.has(pos) && deficit(pos) >= suggestionConstants.minNeedDeficit)
    .sort((a, b) => deficit(b) - deficit(a) || a.localeCompare(b))
    .slice(0, suggestionConstants.needsConsidered)
}

/**
 * One suggestion from `aiTeam` at `pos`, or null. The AI keeps its top consensus player at the position
 * and offers the next ones down; each must beat the user's weakest starter there by `minUpgrade`.
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

  const kept = topByOvrAtPosition(state, aiTeam)
  const surplus: Valued[] = (state.teams[aiTeam]?.roster ?? [])
    .filter(
      (slot) =>
        posOf(slot.playerId) === pos &&
        !kept.has(slot.playerId) &&
        !slot.injured &&
        !usedIncoming.has(slot.playerId),
    )
    .map((slot) => ({
      id: slot.playerId,
      value: outgoingValueFor(state, aiTeam, slot.playerId, ctx),
    }))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    .slice(0, suggestionConstants.candidatesScanned)

  const mustBeat = weakestStarterOvr(state, state.userTeam, pos) + suggestionConstants.minUpgrade
  const userRoster = state.teams[state.userTeam]?.roster ?? []
  const skip = new Set(suggestionConstants.skipPositions)
  const payRatio =
    offerConstants.payRatioMin +
    rng.next() * (offerConstants.payRatioMax - offerConstants.payRatioMin)

  for (const give of surplus) {
    if ((state.scouting[give.id]?.ovr ?? 0) < mustBeat) continue
    const ask = give.value / payRatio
    const sendable = userRoster
      .filter((slot) => {
        const p = posOf(slot.playerId)
        return (
          p !== undefined &&
          !userWanted.has(p) &&
          !skip.has(p) &&
          !slot.injured &&
          !usedOutgoing.has(slot.playerId) &&
          !isStarter(state, state.userTeam, slot.playerId)
        )
      })
      .map((slot) => ({
        id: slot.playerId,
        value: incomingValueFor(state, aiTeam, slot.playerId, ctx),
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
  const wanted = suggestionNeeds(state, state.userTeam)
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
