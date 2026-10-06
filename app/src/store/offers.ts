import type { LeagueState, PickRef, TradeProposal, TradeSide } from '@contracts/index'

function ownsPick(state: LeagueState, teamId: string, ref: PickRef): boolean {
  return state.picks.some(
    (p) =>
      p.owner === teamId &&
      p.playerId === null &&
      p.season === ref.season &&
      p.round === ref.round &&
      p.originalTeam === ref.originalTeam &&
      (ref.pick == null || p.pick === ref.pick),
  )
}

function sideIsIntact(state: LeagueState, side: TradeSide): boolean {
  const team = state.teams[side.teamId]
  if (!team) return false
  const onRoster = new Set(team.roster.map((slot) => slot.playerId))
  return (
    side.players.every((id) => onRoster.has(id)) &&
    side.picks.every((ref) => ownsPick(state, side.teamId, ref))
  )
}

/**
 * An offer is a promise to trade specific assets, so it expires the moment either side no longer
 * holds them (a release, another trade, a signing that pushes a player out). Returns the same array
 * when nothing expired so subscribers do not re-render for nothing.
 */
export function pruneStaleOffers(state: LeagueState, offers: TradeProposal[]): TradeProposal[] {
  if (offers.length === 0) return offers
  const kept = offers.filter((o) => sideIsIntact(state, o.offer) && sideIsIntact(state, o.request))
  return kept.length === offers.length ? offers : kept
}
