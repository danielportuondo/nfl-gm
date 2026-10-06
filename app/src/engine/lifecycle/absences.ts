/**
 * Real-life absences (QA M6). A starter whose real season availability was very low (Luck 2017,
 * Bridgewater 2017) must not play a whole simulated season at his rating, so lifecycle — which may
 * read truth — announces the absence as an ordinary injury before the season starts. Depth charts and
 * the sim then pass over him through the usual injured-skip path, for AI and user teams alike, and
 * the trade AI sees the same public injury. The decision here uses truth; nothing it writes does.
 */
import {
  STARTER_TEMPLATE,
  leagueFormat,
  type LeagueState,
  type PlayerId,
  type RosterSlot,
  type TeamState,
} from '@contracts/index'
import { HISTORICAL_ABSENCE_KIND, HISTORICAL_ABSENCE_MAX_AVAIL } from './constants'

/**
 * Walks each position group best consensus first and keeps going until the starter slots are filled
 * with players who were really available, so the man who steps up behind an absent starter
 * (Bradford behind Bridgewater) is held to the same check. Bench players who never played stay unmarked.
 * A group never loses every starter: when the whole group missed time (Dallas used three QBs in 2015),
 * the most available of them is spared, because each really played in different weeks.
 */
function absentStarters(
  state: LeagueState,
  team: TeamState,
  availOf: (id: PlayerId) => number | undefined,
): Set<PlayerId> {
  const byPos = new Map<string, PlayerId[]>()
  for (const slot of team.roster) {
    const pos = state.players[slot.playerId]?.pos
    if (!pos) continue
    byPos.set(pos, [...(byPos.get(pos) ?? []), slot.playerId])
  }
  const ovrOf = (id: PlayerId) => state.scouting[id]?.ovr ?? 0
  const absent = new Set<PlayerId>()
  for (const [pos, ids] of byPos) {
    ids.sort((a, b) => ovrOf(b) - ovrOf(a) || a.localeCompare(b))
    const slots = STARTER_TEMPLATE[pos] ?? 0
    const missing: PlayerId[] = []
    let filled = 0
    for (const id of ids) {
      if (filled >= slots) break
      if ((availOf(id) ?? 1) < HISTORICAL_ABSENCE_MAX_AVAIL) missing.push(id)
      else filled++
    }
    const spared = [...missing]
      .sort((a, b) => availOf(b)! - availOf(a)!)
      .slice(0, Math.max(0, slots - filled))
    for (const id of missing) if (!spared.includes(id)) absent.add(id)
  }
  return absent
}

/**
 * Marks each consensus starter whose real availability this season was under the threshold as injured
 * for the share of the season he missed (the first weeks, as after an offseason injury). Idempotent:
 * a player already injured is left alone, and seasons without real availability (procedural) are no-ops.
 */
export function applyHistoricalAbsences(state: LeagueState): LeagueState {
  const seasonKey = String(state.season)
  // Weeks, not games: the bye is a week the injury clock ticks through, so a season-long absence
  // (availability 0) spans every week and not just every game.
  const weeksInSeason = leagueFormat(state.season).regularSeasonGames + 1
  const availOf = (id: PlayerId) => state.truth[id]?.availBySeason?.[seasonKey]
  let teams = state.teams
  for (const teamId of Object.keys(state.teams).sort()) {
    const team = state.teams[teamId]!
    const absent = absentStarters(state, team, availOf)
    let changed = false
    const roster: RosterSlot[] = team.roster.map((slot) => {
      if (slot.injured || !absent.has(slot.playerId)) return slot
      const weeksOut = Math.max(1, Math.round((1 - availOf(slot.playerId)!) * weeksInSeason))
      changed = true
      return {
        ...slot,
        injured: {
          weeksOut,
          kind: HISTORICAL_ABSENCE_KIND,
          season: state.season,
          week: state.week,
        },
      }
    })
    if (changed) teams = { ...teams, [teamId]: { ...team, roster } }
  }
  return teams === state.teams ? state : { ...state, teams }
}
