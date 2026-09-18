/**
 * engine/history — history anchoring & divergence tracking (§6.8). Implements HistoryModule
 * (contracts/engine/history.ts). Ranks/places by real roster membership only — never reads
 * `state.truth` or `ctx.trajectories` (fa-cap brief convention); a newly-arriving real player's truth
 * entry is a scouting-based fallback, not a copy of the hidden trajectory.
 */
import {
  SeasonNotLoadedError, historyStub,
  type EngineContext, type HistoryModule, type LeagueState, type Player, type PlayerId, type RosterSlot,
  type Season, type SeasonPlayer, type SnapEvent, type TeamId, type TrueTrajectory,
} from '@contracts/index'

function toPlayer(sp: SeasonPlayer): Player {
  return {
    id: sp.id, name: sp.name, pos: sp.pos, birthYear: sp.birthYear, college: sp.college,
    heightIn: sp.heightIn, weightLb: sp.weightLb, draft: sp.draft, real: sp.real, rookieSeason: sp.rookieSeason,
  }
}

/** No trajectory is read here; a fresh arrival gets a flat one-point truth anchored on consensus ovr. */
function fallbackTruth(season: Season, ovr: number): TrueTrajectory {
  return { bySeason: { [String(season)]: ovr }, retiresAfter: null }
}

interface Placement {
  id: PlayerId
  from: TeamId | null
  to: TeamId | null
  reason: Exclude<SnapEvent['reason'], 'DIVERGED_KEPT'>
  isNewArrival: boolean
}

function snapToHistoryImpl(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = state.season
  const sd = ctx.seasonData(season)
  if (!sd) throw new SeasonNotLoadedError(season)

  const seasonPlayerById = new Map(sd.players.players.map((sp) => [sp.id, sp]))
  const currentTeamOf = new Map<PlayerId, TeamId>()
  for (const [teamId, team] of Object.entries(state.teams)) {
    for (const slot of team.roster) currentTeamOf.set(slot.playerId, teamId)
  }

  // Every real player already known, plus any real player appearing in this season's data for the
  // first time (a real signing/trade we never modeled, or a rookie the draft module hasn't added yet).
  const idsToConsider = new Set<PlayerId>()
  for (const [id, p] of Object.entries(state.players)) if (p.real) idsToConsider.add(id)
  for (const sp of sd.players.players) if (!state.players[sp.id]) idsToConsider.add(sp.id)
  const freeAgentSet = new Set(state.freeAgents)

  const placements: Placement[] = []
  const divergedKept: PlayerId[] = []
  for (const id of [...idsToConsider].sort()) {
    const currentTeam = currentTeamOf.get(id) ?? null
    if (state.divergence.has(id)) {
      divergedKept.push(id)
      continue
    }
    if (currentTeam === state.userTeam) continue // the user's own roster is never touched
    const isNewArrival = !state.players[id]
    const sp = seasonPlayerById.get(id)
    if (!sp) {
      // A known real player absent from this season's data has left the league — retire him if he is
      // still around; one already gone (retired earlier, or sitting out a year) is left alone so he can
      // come back when a later season lists him again.
      const active = currentTeam !== null || freeAgentSet.has(id)
      if (active) placements.push({ id, from: currentTeam, to: null, reason: 'RETIRED', isNewArrival: false })
      continue
    }
    placements.push({ id, from: currentTeam, to: sp.team, reason: isNewArrival ? 'NEW_ARRIVAL' : 'HISTORY', isNewArrival })
  }

  let players = state.players
  let scouting = state.scouting
  let truth = state.truth
  for (const pl of placements) {
    if (!pl.isNewArrival) continue
    const sp = seasonPlayerById.get(pl.id)!
    players = { ...players, [pl.id]: toPlayer(sp) }
    scouting = { ...scouting, [pl.id]: sp.scouting }
    truth = { ...truth, [pl.id]: fallbackTruth(season, sp.scouting.ovr) }
  }

  const placedIds = new Set(placements.map((p) => p.id))
  let teams = state.teams
  for (const [teamId, team] of Object.entries(teams)) {
    const filtered = team.roster.filter((slot) => !placedIds.has(slot.playerId))
    if (filtered.length !== team.roster.length) teams = { ...teams, [teamId]: { ...team, roster: filtered } }
  }

  let freeAgents = state.freeAgents.filter((id) => !placedIds.has(id))
  const byTeam = new Map<TeamId, PlayerId[]>()
  for (const pl of placements) {
    if (pl.to) {
      const arr = byTeam.get(pl.to) ?? []
      arr.push(pl.id)
      byTeam.set(pl.to, arr)
    } else if (pl.reason !== 'RETIRED') {
      freeAgents.push(pl.id) // a real player unsigned that season
    }
  }

  let workingState: LeagueState = { ...state, players, scouting, truth, teams }
  for (const [teamId, ids] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teams[teamId]
    if (!team) continue
    const entryByPlayer = new Map((sd.rosters.rosters[teamId] ?? []).map((e) => [e.playerId, e]))
    const newSlots: RosterSlot[] = []
    for (const id of [...ids].sort()) {
      const entry = entryByPlayer.get(id)
      const hint = entry ? { apy: entry.apy, years: entry.years } : undefined
      const contract = ctx.modules.fa.synthesizeContract(workingState, id, season, ctx, hint)
      newSlots.push({ playerId: id, teamId, contract })
    }
    teams = { ...teams, [teamId]: { ...team, roster: [...team.roster, ...newSlots] } }
    workingState = { ...workingState, teams }
  }

  freeAgents = [...new Set(freeAgents)].sort()

  const events: SnapEvent[] = [
    ...placements.map((pl) => ({ season, playerId: pl.id, fromTeam: pl.from, toTeam: pl.reason === 'RETIRED' ? null : pl.to, reason: pl.reason })),
    ...divergedKept.sort().map((id) => ({
      season, playerId: id, fromTeam: currentTeamOf.get(id) ?? null, toTeam: currentTeamOf.get(id) ?? null,
      reason: 'DIVERGED_KEPT' as const,
    })),
  ]

  return { ...workingState, teams, freeAgents, snapLog: [...state.snapLog, ...events] }
}

export const history: HistoryModule = {
  ...historyStub,
  snapToHistory: snapToHistoryImpl,
  markDiverged: (state, playerIds) =>
    playerIds.every((id) => state.divergence.has(id)) ? state : { ...state, divergence: new Set([...state.divergence, ...playerIds]) },
  isDiverged: (state, playerId) => state.divergence.has(playerId),
  snapLog: (state, season) => (season === undefined ? state.snapLog : state.snapLog.filter((e) => e.season === season)),
}
