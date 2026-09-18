/**
 * engine/lifecycle — PHASE 2 SCAFFOLD. lifecycle (3D) replaces this file per contracts/engine/lifecycle.ts and HANDOFF §6.7.
 *
 * Implements only the weekly injury bookkeeping league.simWeek needs (apply new events, count weeks
 * down, clear the healed) and `age`. No permanent loss after long injuries yet — that reads the injury
 * model and edits truth, which is 3D's. Progression, retirement, scouting refresh and procedural
 * classes keep their NotImplementedError stubs.
 */
import { lifecycleStub, type InjuryEvent, type LeagueState, type LifecycleModule, type TeamState } from '@contracts/index'

function applyInjuryEvents(state: LeagueState, events: InjuryEvent[]): LeagueState {
  if (events.length === 0) return state
  const byTeam = new Map<string, InjuryEvent[]>()
  for (const e of events) byTeam.set(e.teamId, [...(byTeam.get(e.teamId) ?? []), e])
  let teams = state.teams
  for (const [teamId, teamEvents] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teams[teamId]
    if (!team) continue
    const byPlayer = new Map(teamEvents.map((e) => [e.playerId, e]))
    const roster = team.roster.map((slot) => {
      const hit = byPlayer.get(slot.playerId)
      if (!hit) return slot
      // A player hurt again while already out serves the longer of the two absences.
      const weeksOut = Math.max(hit.weeksOut, slot.injured?.weeksOut ?? 0)
      return { ...slot, injured: { weeksOut, kind: hit.kind, season: state.season, week: state.week } }
    })
    teams = { ...teams, [teamId]: { ...team, roster } }
  }
  return { ...state, teams }
}

function tickInjuries(state: LeagueState): LeagueState {
  let changed = false
  const teams: Record<string, TeamState> = {}
  for (const teamId of Object.keys(state.teams).sort()) {
    const team = state.teams[teamId]!
    let teamChanged = false
    const roster = team.roster.map((slot) => {
      if (!slot.injured) return slot
      teamChanged = true
      const weeksOut = slot.injured.weeksOut - 1
      if (weeksOut <= 0) {
        const healthy = { ...slot }
        delete healthy.injured
        return healthy
      }
      return { ...slot, injured: { ...slot.injured, weeksOut } }
    })
    teams[teamId] = teamChanged ? { ...team, roster } : team
    changed ||= teamChanged
  }
  return changed ? { ...state, teams } : state
}

export const lifecycle: LifecycleModule = {
  ...lifecycleStub,
  applyInjuryEvents,
  tickInjuries,
  age: (state, playerId, season) => {
    const player = state.players[playerId]
    if (!player) throw new Error(`lifecycle.age: unknown player "${playerId}"`)
    return (season ?? state.season) - player.birthYear
  },
}
