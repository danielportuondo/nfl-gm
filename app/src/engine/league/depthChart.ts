import {
  POSITIONS,
  type DepthChart,
  type LeagueState,
  type PlayerId,
  type TeamId,
} from '@contracts/index'

/**
 * Where a newcomer lands in a chart someone ordered by hand: ahead of the first player his consensus
 * ovr beats. Existing players are never re-sorted against each other, so a user who ranked a 59 over
 * an 80 keeps that; a tie goes to the man already there.
 */
export function consensusSlot(
  chart: readonly PlayerId[],
  newcomerOvr: number,
  ovrOf: (id: PlayerId) => number,
): number {
  const slot = chart.findIndex((id) => ovrOf(id) < newcomerOvr)
  return slot === -1 ? chart.length : slot
}

/**
 * Brings a team's depth chart in line with its roster without touching the order the user chose:
 * players who left (released, traded, retired) drop out, and players who joined (draft, UDFA, free
 * agency, trade, waivers) are slotted in at the place their consensus ovr earns, best first, with
 * everyone else shifting down. Injured players keep their slot: the sim skips them while they are out.
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
    const ordered = [...kept]
    for (const id of joined) ordered.splice(consensusSlot(ordered, ovrOf(id), ovrOf), 0, id)
    chart[pos] = ordered
    if (kept.length !== current.length || joined.length > 0) changed = true
  }
  if (!changed) return state
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, depthChart: chart } } }
}
