import type { LeagueState, PlayerId } from '@contracts/index'

const LISTED_ARRIVALS = 2

/**
 * One notice per player who joined the user's roster in this update, naming the slot his consensus
 * earned on the already-reconciled chart ("Adams placed at S1"). A bigger batch collapses into one line.
 */
export function depthChartNotices(prev: LeagueState | null, next: LeagueState): string[] {
  if (!prev || prev.seed !== next.seed || prev.userTeam !== next.userTeam) return []
  const before = prev.teams[prev.userTeam]
  const after = next.teams[next.userTeam]
  if (!before || !after) return []
  const had = new Set(before.roster.map((r) => r.playerId))
  const arrivals = after.roster.map((r) => r.playerId).filter((id) => !had.has(id))
  if (arrivals.length === 0) return []
  if (arrivals.length > LISTED_ARRIVALS) {
    return [`${arrivals.length} new players placed on your depth chart by rating`]
  }
  const notices: string[] = []
  for (const id of arrivals) {
    const notice = placement(next, id)
    if (notice) notices.push(notice)
  }
  return notices
}

function placement(state: LeagueState, id: PlayerId): string | null {
  const player = state.players[id]
  if (!player) return null
  const index = state.teams[state.userTeam]?.depthChart[player.pos]?.indexOf(id) ?? -1
  return index < 0 ? null : `${player.name} placed at ${player.pos}${index + 1}`
}
