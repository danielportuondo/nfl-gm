/**
 * Labels for the real absences lifecycle announces in `state.absences` ("Out wk 6–17 · injury",
 * "Benched wk 2–17"). Reads only that public board, never truth. Pure functions.
 */
import {
  STARTER_TEMPLATE,
  leagueFormat,
  type Absence,
  type AbsenceReason,
  type LeagueState,
  type PlayerId,
  type Season,
} from '@contracts/index'

const REASON_TEXT: Record<AbsenceReason, string> = {
  injury: 'injury',
  suspension: 'suspension',
  out: 'out of football',
  benched: 'benched',
}

const MAX_RANGES_SHOWN = 2

/** Weeks in the regular season including the bye. A range ending past this runs through the playoffs. */
function regularWeeks(season: Season): number {
  return leagueFormat(season).regularSeasonGames + 1
}

type BoardView = Pick<LeagueState, 'absences' | 'season' | 'phase' | 'week' | 'teams'>

/** Only an AI team sits a benched starter; the user, and whoever signs a free agent, picks freely. */
function onAiTeam(state: BoardView, playerId: PlayerId): boolean {
  return Object.values(state.teams).some(
    (team) => !team.userControlled && team.roster.some((slot) => slot.playerId === playerId),
  )
}

/** Announced ranges for the player that are not over yet. In the offseason every range is ahead. */
export function upcomingAbsences(state: BoardView, playerId: PlayerId): Absence[] {
  const board = state.absences
  const ranges = board?.byPlayer[playerId]
  if (!board || !ranges) return []
  const underway =
    board.season === state.season && (state.phase === 'REGULAR' || state.phase === 'PLAYOFFS')
  const ahead = underway ? ranges.filter((a) => a.to >= state.week) : ranges
  if (!ahead.some((a) => a.reason === 'benched') || onAiTeam(state, playerId)) return ahead
  return ahead.filter((a) => a.reason !== 'benched')
}

function rangeLabel(absence: Absence, season: Season): string {
  const last = regularWeeks(season)
  if (absence.reason === 'out' && absence.from <= 1 && absence.to >= last)
    return `Out of football in ${season}`
  const to = Math.min(absence.to, last)
  const weeks = absence.from >= to ? `wk ${absence.from}` : `wk ${absence.from}–${to}`
  if (absence.reason === 'benched') return `Benched ${weeks}`
  return `Out ${weeks} · ${REASON_TEXT[absence.reason]}`
}

/** "Out wk 6–17 · injury" or "Benched wk 2–17", or null when nothing is announced ahead for him. */
export function absenceLabel(state: BoardView, playerId: PlayerId): string | null {
  const ranges = upcomingAbsences(state, playerId)
  if (ranges.length === 0 || !state.absences) return null
  const season = state.absences.season
  const shown = ranges.slice(0, MAX_RANGES_SHOWN).map((a) => rangeLabel(a, season))
  const more = ranges.length - shown.length
  return more > 0 ? `${shown.join('; ')}; +${more} more` : shown.join('; ')
}

/**
 * Position groups on a team with fewer healthy players than starting spots, worst first. In season
 * only: the offseason heals everyone. The sim fills a gap with a street free agent, so this is the
 * user's cue to sign a real player there.
 */
export function thinPositions(
  state: Pick<LeagueState, 'teams' | 'players' | 'phase'>,
  teamId: string,
): Array<{ pos: string; healthy: number; needed: number }> {
  if (state.phase !== 'REGULAR' && state.phase !== 'PLAYOFFS') return []
  const healthy = new Map<string, number>()
  for (const slot of state.teams[teamId]?.roster ?? []) {
    const pos = state.players[slot.playerId]?.pos
    if (pos && !slot.injured) healthy.set(pos, (healthy.get(pos) ?? 0) + 1)
  }
  return Object.entries(STARTER_TEMPLATE)
    .map(([pos, needed]) => ({ pos, needed, healthy: healthy.get(pos) ?? 0 }))
    .filter((g) => g.healthy < g.needed)
    .sort((a, b) => a.healthy / a.needed - b.healthy / b.needed || a.pos.localeCompare(b.pos))
}

export function thinPositionText(g: { pos: string; healthy: number; needed: number }): string {
  return g.healthy === 0
    ? `No healthy ${g.pos} this week.`
    : `${g.pos}: ${g.healthy} healthy, ${g.needed} start.`
}
