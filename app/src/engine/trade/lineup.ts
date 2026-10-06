/**
 * Both sides of a deal as the evaluating team counts them. For an AI team the asset values are
 * lineup-aware: dealing away a starter costs the talent drop to whoever starts in his place after the
 * trade (incoming players included), and an incoming player who would not crack the lineup counts at
 * `fillerShare`. Picks are unaffected. The user's side is valued plainly — the rules model the AI's
 * preferences, and the user-side read is only the plausibility band on AI offers.
 */
import {
  STARTER_TEMPLATE,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Position,
  type TeamId,
  type TradeSide,
} from '@contracts/index'
import { lineupConstants, pickConstants, rookieConstants } from './constants'
import {
  controlFactor,
  controlSeasons,
  incomingValue,
  outgoingValue,
  pickValueImpl,
  rookieSlotAnchor,
  rosterIndex,
  slotTalent,
} from './value'

type Assets = Pick<TradeSide, 'players' | 'picks'>

export interface SideValuation {
  valueIn: number
  valueOut: number
  /** Each incoming player's value as counted, filler discount applied. */
  incoming: Map<PlayerId, number>
  /** Talent-drop charge per position where the evaluator loses a starter. */
  starterLoss: Map<Position, number>
  fillers: PlayerId[]
}

const NO_ASSETS: Assets = { players: [], picks: [] }
const depthCache = new WeakMap<object, Map<string, PlayerId[]>>()

function ovrOf(state: LeagueState, id: PlayerId): number {
  return state.scouting[id]?.ovr ?? pickConstants.replacementOvr
}

function byOvrDesc(state: LeagueState): (a: PlayerId, b: PlayerId) => number {
  return (a, b) => ovrOf(state, b) - ovrOf(state, a) || a.localeCompare(b)
}

function lineupTalent(
  state: LeagueState,
  pos: Position,
  ranked: PlayerId[],
  slots: number,
): number {
  let total = 0
  for (let i = 0; i < slots; i++) {
    const id = ranked[i]
    total += slotTalent(pos, id === undefined ? pickConstants.replacementOvr : ovrOf(state, id))
  }
  return total
}

/** A recent early-round draftee is bought for his future, so sitting this year is no discount. */
function isProspect(state: LeagueState, id: PlayerId): boolean {
  const round = state.players[id]?.draft?.round
  return (
    round !== undefined &&
    round <= rookieConstants.fillerExemptMaxRound &&
    rookieSlotAnchor(state, id) > 0
  )
}

/** `teamId`'s players at `pos`, best consensus first; the first STARTER_TEMPLATE[pos] are its starters. */
export function depthAt(state: LeagueState, teamId: TeamId, pos: Position): PlayerId[] {
  let byTeam = depthCache.get(state)
  if (!byTeam) {
    byTeam = new Map()
    depthCache.set(state, byTeam)
  }
  const key = `${teamId}:${pos}`
  const hit = byTeam.get(key)
  if (hit) return hit
  const depth = (state.teams[teamId]?.roster ?? [])
    .map((slot) => slot.playerId)
    .filter((id) => state.players[id]?.pos === pos)
    .sort(byOvrDesc(state))
  byTeam.set(key, depth)
  return depth
}

export function startingSlots(pos: Position): number {
  return STARTER_TEMPLATE[pos] ?? 0
}

export function isStarter(state: LeagueState, teamId: TeamId, playerId: PlayerId): boolean {
  const pos = state.players[playerId]?.pos
  if (!pos) return false
  return depthAt(state, teamId, pos).slice(0, startingSlots(pos)).includes(playerId)
}

function controlOf(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const contract = rosterIndex(state).get(playerId)?.contract
  return contract ? controlFactor(controlSeasons(state, contract, ctx)) : 1
}

export function isLineupAware(state: LeagueState, teamId: TeamId): boolean {
  const team = state.teams[teamId]
  return team !== undefined && !team.userControlled
}

export function valueSides(
  state: LeagueState,
  evaluator: TeamId,
  receives: Assets,
  gives: Assets,
  ctx: EngineContext,
): SideValuation {
  const incoming = new Map<PlayerId, number>()
  const lineupAware = isLineupAware(state, evaluator)
  for (const id of receives.players) incoming.set(id, incomingValue(state, id, ctx, lineupAware))
  const starterLoss = new Map<Position, number>()
  const fillers: PlayerId[] = []

  if (lineupAware) {
    const posOf = (id: PlayerId) => state.players[id]?.pos
    const leaving = new Set(gives.players)
    const positions = [...new Set([...receives.players, ...gives.players].map(posOf))]
      .filter((pos): pos is Position => pos !== undefined)
      .sort()
    for (const pos of positions) {
      const slots = startingSlots(pos)
      const arriving = receives.players.filter((id) => posOf(id) === pos)
      const before = depthAt(state, evaluator, pos)
      const after = [...before.filter((id) => !leaving.has(id)), ...arriving].sort(byOvrDesc(state))
      const starters = new Set(after.slice(0, slots))
      for (const id of arriving) {
        if (starters.has(id) || isProspect(state, id)) continue
        incoming.set(id, (incoming.get(id) ?? 0) * lineupConstants.fillerShare)
        fillers.push(id)
      }
      const leavingHere = gives.players.filter((id) => posOf(id) === pos)
      if (leavingHere.length === 0) continue
      const drop = lineupTalent(state, pos, before, slots) - lineupTalent(state, pos, after, slots)
      // A starter whose deal is about to run out was leaving anyway: the hole is only the seasons left.
      const control = Math.max(...leavingHere.map((id) => controlOf(state, id, ctx)))
      if (drop > 0) starterLoss.set(pos, lineupConstants.starterLossShare * drop * control)
    }
  }

  const sum = (xs: number[]) => xs.reduce((total, x) => total + x, 0)
  const picksIn = sum(receives.picks.map((ref) => pickValueImpl(state, ref, ctx)))
  const picksOut = sum(gives.picks.map((ref) => pickValueImpl(state, ref, ctx)))
  const playersOut = sum(gives.players.map((id) => outgoingValue(state, id, ctx)))
  return {
    valueIn: sum([...incoming.values()]) + picksIn,
    valueOut: playersOut + sum([...starterLoss.values()]) + picksOut,
    incoming,
    starterLoss,
    fillers,
  }
}

/** What one incoming player adds to `evaluator`'s side on his own. */
export function incomingValueFor(
  state: LeagueState,
  evaluator: TeamId,
  playerId: PlayerId,
  ctx: EngineContext,
): number {
  return valueSides(state, evaluator, { players: [playerId], picks: [] }, NO_ASSETS, ctx).valueIn
}

/** What dealing one player away costs `evaluator` on his own, starter-loss charge included. */
export function outgoingValueFor(
  state: LeagueState,
  evaluator: TeamId,
  playerId: PlayerId,
  ctx: EngineContext,
): number {
  return valueSides(state, evaluator, NO_ASSETS, { players: [playerId], picks: [] }, ctx).valueOut
}
