import type { Contract, LeagueState } from '@contracts/index'
import { isExpiringDeal, seasonsLeft } from '@engine/fa'
import { isOffseasonPhase } from './phaseLabel'

export { seasonsLeft }

/** Ends with the season being played (in season) or has already run its last season (offseason). */
export function isExpiring(state: LeagueState, contract: Contract): boolean {
  return isOffseasonPhase(state.phase) ? isExpiringDeal(state, contract) : contract.years <= 1
}

/** Still on the books once the next season starts. */
export function staysNextSeason(state: LeagueState, contract: Contract): boolean {
  return isOffseasonPhase(state.phase)
    ? seasonsLeft(state, contract) >= 1
    : seasonsLeft(state, contract) > 1
}
