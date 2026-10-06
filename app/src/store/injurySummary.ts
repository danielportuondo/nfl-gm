import type { GameResult, InjuryEvent, LeagueState, TeamId } from '@contracts/index'

const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i
const MAX_LISTED = 3

export function userInjuries(results: readonly GameResult[], userTeam: TeamId): InjuryEvent[] {
  return results.flatMap((r) => r.injuries.filter((i) => i.teamId === userTeam))
}

function surname(name: string): string {
  const parts = name.split(' ').filter((p) => !NAME_SUFFIX.test(p))
  return parts.at(-1) ?? name
}

/** "2 injuries: Kittle (3 wk), White (1 wk)"; null when the user's team stayed healthy. */
export function injurySummary(injuries: readonly InjuryEvent[], state: LeagueState): string | null {
  if (injuries.length === 0) return null
  const rows = injuries
    .map((i) => ({
      name: surname(state.players[i.playerId]?.name ?? i.playerId),
      weeksOut: i.weeksOut,
    }))
    .sort((a, b) => b.weeksOut - a.weeksOut || a.name.localeCompare(b.name))
  const listed = rows.slice(0, MAX_LISTED).map((r) => `${r.name} (${r.weeksOut} wk)`)
  const more = rows.length > MAX_LISTED ? `, +${rows.length - MAX_LISTED} more` : ''
  const count = `${rows.length} ${rows.length === 1 ? 'injury' : 'injuries'}`
  return `${count}: ${listed.join(', ')}${more}`
}

/** The engine's per-game "N injury event(s)" strings cover both teams; the summary replaces them. */
export function isInjuryEventText(event: string): boolean {
  return /injury event/.test(event)
}
