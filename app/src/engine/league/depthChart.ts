import {
  POSITIONS,
  type DepthChart,
  type LeagueState,
  type PlayerId,
  type TeamId,
} from '@contracts/index'

/**
 * Brings a team's depth chart in line with its roster without touching the order the user chose:
 * players who left (released, traded, retired) drop out, and players who joined (draft, UDFA, free
 * agency) are appended behind the existing names at their position, best consensus ovr first.
 * AI teams get a full autoDepthChart rebuild instead; this is for the chart a person edits by hand.
 */
export function reconcileDepthChart(state: LeagueState, teamId: TeamId): LeagueState {
  const team = state.teams[teamId]
  if (!team) return state
  const rosterByPos = new Map<string, Set<PlayerId>>()
  for (const slot of team.roster) {
    const pos = state.players[slot.playerId]?.pos
    if (!pos) continue
    const ids = rosterByPos.get(pos) ?? new Set<PlayerId>()
    ids.add(slot.playerId)
    rosterByPos.set(pos, ids)
  }
  const ovrOf = (id: PlayerId) => state.scouting[id]?.ovr ?? 0
  const chart: DepthChart = {}
  let changed = false
  for (const pos of POSITIONS) {
    const onRoster = rosterByPos.get(pos) ?? new Set<PlayerId>()
    const current = team.depthChart[pos] ?? []
    const kept = current.filter((id, i) => onRoster.has(id) && current.indexOf(id) === i)
    const keptSet = new Set(kept)
    const joined = [...onRoster]
      .filter((id) => !keptSet.has(id))
      .sort((a, b) => ovrOf(b) - ovrOf(a) || a.localeCompare(b))
    chart[pos] = [...kept, ...joined]
    if (kept.length !== current.length || joined.length > 0) changed = true
  }
  if (!changed) return state
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, depthChart: chart } } }
}
