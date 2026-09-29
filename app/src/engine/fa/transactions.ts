/**
 * The user's move history (fa-cap's slice: RESIGN/SIGN/RELEASE). Mirrors engine/draft/transactions.ts —
 * same moveContext/append shape — so every kind of Transaction is logged identically.
 */
import type { LeagueState, PlayerId, Transaction } from '@contracts/index'

// SIGN and RESIGN share one schema branch (`kind: z.enum(['SIGN', 'RESIGN'])`), so Extract-ing either
// literal alone yields `never`; extract both and narrow with an explicit `kind` on construction instead.
type ContractTransaction = Extract<Transaction, { kind: 'SIGN' | 'RESIGN' }>
type ReleaseTransaction = Extract<Transaction, { kind: 'RELEASE' }>

function moveContext(state: LeagueState, playerId: PlayerId) {
  const ovr = state.scouting[playerId]?.ovr
  return {
    season: state.season,
    phase: state.phase,
    week: state.week,
    ovrAtMove: ovr === undefined ? {} : { [playerId]: ovr },
  }
}

const append = (state: LeagueState, entry: Transaction): LeagueState => ({
  ...state,
  transactions: [...state.transactions, entry],
})

/** `state` is the pre-move league (for ovrAtMove/season/phase/week); `result` already has the move applied. */
export function logResign(
  state: LeagueState,
  result: LeagueState,
  playerId: PlayerId,
  contract: ContractTransaction['contract'],
): LeagueState {
  const entry: ContractTransaction = {
    kind: 'RESIGN',
    ...moveContext(state, playerId),
    playerId,
    contract,
  }
  return append(result, entry)
}

export function logSign(
  state: LeagueState,
  result: LeagueState,
  playerId: PlayerId,
  contract: ContractTransaction['contract'],
): LeagueState {
  const entry: ContractTransaction = {
    kind: 'SIGN',
    ...moveContext(state, playerId),
    playerId,
    contract,
  }
  return append(result, entry)
}

export function logRelease(
  state: LeagueState,
  result: LeagueState,
  playerId: PlayerId,
  deadMoney: number,
): LeagueState {
  const entry: ReleaseTransaction = {
    kind: 'RELEASE',
    ...moveContext(state, playerId),
    playerId,
    deadMoney,
  }
  return append(result, entry)
}
