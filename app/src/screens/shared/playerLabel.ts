import type { LeagueState, PlayerId } from '@contracts/index'

/**
 * "Michael Thomas (WR, NO)": a name alone is ambiguous (two Michael Thomases play in the league),
 * so any list that shows players from more than one roster says position and team too.
 */
export function playerLabel(state: LeagueState, playerId: PlayerId): string {
  const player = state.players[playerId]
  if (!player) return playerId
  const teamId = Object.keys(state.teams)
    .sort()
    .find((id) => state.teams[id]!.roster.some((slot) => slot.playerId === playerId))
  return `${player.name} (${teamId ? `${player.pos}, ${teamId}` : player.pos})`
}
