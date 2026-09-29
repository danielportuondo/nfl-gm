/**
 * The user's move history (trade-ai's slice: TRADE). Same shape as engine/draft/transactions.ts and
 * engine/fa/transactions.ts; AI-to-AI trades are never logged.
 */
import type { LeagueState, PlayerId, Transaction, TradeProposal } from '@contracts/index'

type TradeTransaction = Extract<Transaction, { kind: 'TRADE' }>

function ovrAtMove(state: LeagueState, ids: readonly PlayerId[]): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = {}
  for (const id of [...ids].sort()) {
    const ovr = state.scouting[id]?.ovr
    if (ovr !== undefined) out[id] = ovr
  }
  return out
}

/** `state` is the pre-move league (ovrAtMove, season/phase/week); `result` already has the move applied. */
export function logUserTrade(
  state: LeagueState,
  result: LeagueState,
  proposal: TradeProposal,
): LeagueState {
  const userOffers = proposal.offer.teamId === state.userTeam
  if (!userOffers && proposal.request.teamId !== state.userTeam) return result
  const gave = userOffers ? proposal.offer : proposal.request
  const got = userOffers ? proposal.request : proposal.offer
  const entry: TradeTransaction = {
    kind: 'TRADE',
    season: state.season,
    phase: state.phase,
    week: state.week,
    gave: {
      teamId: gave.teamId,
      players: [...gave.players],
      picks: gave.picks.map((p) => ({ ...p })),
    },
    got: { teamId: got.teamId, players: [...got.players], picks: got.picks.map((p) => ({ ...p })) },
    ovrAtMove: ovrAtMove(state, [...gave.players, ...got.players]),
  }
  return { ...result, transactions: [...result.transactions, entry] }
}
