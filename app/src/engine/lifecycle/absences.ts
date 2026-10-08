/**
 * Real-life absences, announced and applied by real week (QA 2017 H1/M6, 2018 M5).
 *
 * The season chunk carries the regular-season weeks every player really missed: injury (IR, PUP,
 * NFI, ruled out), suspension, or out of football (on no roster, or the practice squad). Lifecycle
 * reads it, so the decision uses truth, and publishes it as `state.absences` ahead of the season. The
 * UI and the week tick both read only that public board. A rostered player whose range covers the
 * week is marked injured through the usual path, for exactly the weeks left, whoever he plays for.
 */
import {
  isInHistory,
  SeasonNotLoadedError,
  type Absence,
  type AbsenceBoard,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type RosterSlot,
  type Season,
  type TeamState,
} from '@contracts/index'
import { REAL_ABSENCE_KINDS } from './constants'

const OFFSEASON_PHASES: ReadonlySet<LeagueState['phase']> = new Set([
  'OFFSEASON_RESIGN',
  'DRAFT',
  'UDFA',
  'FREE_AGENCY',
  'TRAINING_CAMP',
])

/** The season whose absences are the relevant ones now: signings in the offseason are for next season. */
export function announcedSeason(state: Pick<LeagueState, 'season' | 'phase'>): Season {
  return OFFSEASON_PHASES.has(state.phase) ? state.season + 1 : state.season
}

export function isRealAbsenceKind(kind: string): boolean {
  return (
    kind === REAL_ABSENCE_KINDS.injury ||
    kind === REAL_ABSENCE_KINDS.suspension ||
    kind === REAL_ABSENCE_KINDS.out
  )
}

export function announceAbsences(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = announcedSeason(state)
  if (state.absences?.season === season) return state
  const byPlayer: AbsenceBoard['byPlayer'] = {}
  if (isInHistory(ctx, season)) {
    let chunk
    try {
      chunk = ctx.seasonData(season)
    } catch (err) {
      if (err instanceof SeasonNotLoadedError) return state
      throw err
    }
    for (const p of chunk?.players.players ?? []) {
      if (p.absences?.length) byPlayer[p.id] = p.absences
    }
  }
  return { ...state, absences: { season, byPlayer } }
}

/** The announced range covering `week` for this player, if any. */
export function absenceAt(
  state: Pick<LeagueState, 'absences'>,
  playerId: PlayerId,
  season: Season,
  week: number,
): Absence | undefined {
  const board = state.absences
  if (!board || board.season !== season) return undefined
  return board.byPlayer[playerId]?.find((a) => a.from <= week && week <= a.to)
}

export function applyWeekAbsences(state: LeagueState): LeagueState {
  if (state.phase !== 'REGULAR' && state.phase !== 'PLAYOFFS') return state
  const board = state.absences
  if (!board || board.season !== state.season) return state
  let teams = state.teams
  for (const teamId of Object.keys(state.teams).sort()) {
    const team: TeamState = state.teams[teamId]!
    let changed = false
    const roster: RosterSlot[] = team.roster.map((slot) => {
      const absence = absenceAt(state, slot.playerId, state.season, state.week)
      if (!absence) return slot
      const weeksOut = absence.to - state.week + 1
      if ((slot.injured?.weeksOut ?? 0) >= weeksOut) return slot
      changed = true
      return {
        ...slot,
        injured: {
          weeksOut,
          kind: REAL_ABSENCE_KINDS[absence.reason],
          season: state.season,
          week: state.week,
        },
      }
    })
    if (changed) teams = { ...teams, [teamId]: { ...team, roster } }
  }
  return teams === state.teams ? state : { ...state, teams }
}
