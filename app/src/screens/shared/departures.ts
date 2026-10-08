/**
 * The user's players who left the league at the camp roll, read from the move log (public state).
 * The roll files them under the season it closed, in the TRAINING_CAMP phase.
 */
import type { LeagueState } from '@contracts/index'

export function departedNames(state: LeagueState, closedSeason: number): string[] {
  return state.transactions.flatMap((t) =>
    t.kind === 'LEFT_LEAGUE' && t.season === closedSeason && t.phase === 'TRAINING_CAMP'
      ? [state.players[t.playerId]?.name ?? t.playerId]
      : [],
  )
}

/** "A, B, C and 3 more": the toast has room for a few names; the full list lives on the Dashboard. */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(', ')
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}
