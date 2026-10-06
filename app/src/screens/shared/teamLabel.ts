import type { StaticData, TeamId } from '@contracts/index'

export interface TeamLabel {
  abbr: string
  city: string
  name: string
  /** "Oakland Raiders" */
  full: string
}

/**
 * How a franchise was known in a given season. TeamId is the franchise's current id (LV, LAR, LAC),
 * so display text comes from `teams.eras`; without a season, or for a franchise that never moved,
 * the current `TeamInfo` fields are used.
 */
export function teamLabel(data: StaticData, teamId: TeamId, season?: number): TeamLabel {
  const info = data.teams[teamId]
  if (!info) return { abbr: teamId, city: '', name: '', full: teamId }
  const era =
    season === undefined
      ? undefined
      : info.eras?.find((e) => season >= e.from && (e.to === null || season <= e.to))
  const { abbr, city, name } = era ?? info
  return { abbr, city, name, full: `${city} ${name}` }
}

export function teamAbbr(data: StaticData, teamId: TeamId, season?: number): string {
  return teamLabel(data, teamId, season).abbr
}
