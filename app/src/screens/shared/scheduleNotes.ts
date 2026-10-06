import type { Game, Season, TeamId } from '@contracts/index'

/**
 * Real-life schedule disruptions in the shipped seasons. Every unusual week in the data (a week-1
 * "bye", a second week off) is listed here; tests/ui/scheduleNotes.test.ts scans every schedule.
 */
const CURATED_NOTES: Record<string, string> = {
  '2017-MIA-1':
    'No game this week. Your week 1 game against Tampa Bay was moved to week 11 because of Hurricane Irma, so both teams lost their week 11 bye.',
  '2017-TB-1':
    'No game this week. Your week 1 game against Miami was moved to week 11 because of Hurricane Irma, so both teams lost their week 11 bye.',
  '2022-BUF-17':
    "No game this week. The Monday night game at Cincinnati was stopped after Bills safety Damar Hamlin's cardiac arrest and never finished. The league canceled it, so Buffalo plays 16 games this season.",
  '2022-CIN-17':
    "No game this week. The Monday night game against Buffalo was stopped after Bills safety Damar Hamlin's cardiac arrest and never finished. The league canceled it, so Cincinnati plays 16 games this season.",
}

export const CURATED_NOTE_KEYS: ReadonlySet<string> = new Set(Object.keys(CURATED_NOTES))

/** Regular-season weeks of `season` in which `teamId` has no game, ascending. */
export function offWeeks(schedule: readonly Game[], season: Season, teamId: TeamId): number[] {
  const regular = schedule.filter((g) => g.season === season && g.type === 'REG')
  const weeks = [...new Set(regular.map((g) => g.week))].sort((a, b) => a - b)
  const played = new Set(
    regular.filter((g) => g.home === teamId || g.away === teamId).map((g) => g.week),
  )
  return weeks.filter((w) => !played.has(w))
}

/**
 * Why `teamId` has no regular-season game in `week`, or null when it plays. Real disruptions get
 * their story; an ordinary off week reads as a bye.
 */
export function noGameNote(
  schedule: readonly Game[],
  season: Season,
  teamId: TeamId,
  week: number,
): string | null {
  const off = offWeeks(schedule, season, teamId)
  if (!off.includes(week)) return null
  const curated = CURATED_NOTES[`${season}-${teamId}-${week}`]
  if (curated) return curated
  const ordinary = off.filter((w) => !CURATED_NOTES[`${season}-${teamId}-${w}`])
  if (ordinary.length === 1 && week > 3) return 'Bye week. No game for your team this week.'
  return 'No game for your team this week (schedule change).'
}
