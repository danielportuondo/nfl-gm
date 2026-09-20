import type { PickRef, StaticData } from '@contracts/index'

/** "2013 R1 #24 (IND)" once the order is set; "2015 R1 (IND)" while `pick` is still unknown. */
export function describePick(
  data: StaticData,
  pick: Pick<PickRef, 'season' | 'round' | 'originalTeam' | 'pick'>,
): string {
  const team = data.teams[pick.originalTeam]?.abbr ?? pick.originalTeam
  const number = pick.pick != null ? ` #${pick.pick}` : ''
  return `${pick.season} R${pick.round}${number} (${team})`
}
