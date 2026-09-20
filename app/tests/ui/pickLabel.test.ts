import { mockStatic } from '@fixtures/mockLeague'
import { describePick } from '@screens/shared/pickLabel'
import { describe, expect, it } from 'vitest'

describe('describePick', () => {
  const data = mockStatic()
  it('shows the overall number once the order is set', () => {
    expect(describePick(data, { season: 2013, round: 1, originalTeam: 'IND', pick: 24 })).toBe(
      `2013 R1 #24 (${data.teams.IND!.abbr})`,
    )
  })
  it('omits the number while the order is unknown', () => {
    expect(describePick(data, { season: 2015, round: 1, originalTeam: 'IND', pick: null })).toBe(
      `2015 R1 (${data.teams.IND!.abbr})`,
    )
    expect(describePick(data, { season: 2015, round: 2, originalTeam: 'IND' })).toBe(
      `2015 R2 (${data.teams.IND!.abbr})`,
    )
  })
})
