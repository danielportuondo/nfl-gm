import type { LeagueState, PlayerId, Transaction } from '@contracts/index'

type DraftTransaction = Extract<Transaction, { kind: 'DRAFT' }>
type UdfaTransaction = Extract<Transaction, { kind: 'UDFA' }>

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

export function logUserDraftPick(
  state: LeagueState,
  playerId: PlayerId,
  round: number,
  pick: number,
): LeagueState {
  const entry: DraftTransaction = {
    kind: 'DRAFT',
    ...moveContext(state, playerId),
    playerId,
    round,
    pick,
  }
  return append(state, entry)
}

export function logUserUdfaSigning(state: LeagueState, playerId: PlayerId): LeagueState {
  const entry: UdfaTransaction = { kind: 'UDFA', ...moveContext(state, playerId), playerId }
  return append(state, entry)
}
