/**
 * The meter on AI-initiated offers: how even the deal is for the user by consensus value alone. The AI
 * already stands behind its own offer, so its margin, strictness, needs and annoyance say nothing about
 * whether the user is being fleeced and are left out.
 */
import type { EngineContext, LeagueState, TradeProposal, TradeSide } from '@contracts/index'
import { pickValueImpl, playerValueImpl } from './value'

function sideValue(state: LeagueState, side: TradeSide, ctx: EngineContext): number {
  return (
    side.players.reduce((total, id) => total + playerValueImpl(state, id, ctx), 0) +
    side.picks.reduce((total, ref) => total + pickValueImpl(state, ref, ctx), 0)
  )
}

/** What the user gets ÷ (gets + gives); 0.5 = even. Without the user on either side, read from `request`. */
export function fairnessImpl(
  state: LeagueState,
  proposal: TradeProposal,
  ctx: EngineContext,
): number {
  const userOffers = proposal.offer.teamId === state.userTeam
  const gets = sideValue(state, userOffers ? proposal.request : proposal.offer, ctx)
  const gives = sideValue(state, userOffers ? proposal.offer : proposal.request, ctx)
  const total = gets + gives
  return total > 0 ? gets / total : 0.5
}
