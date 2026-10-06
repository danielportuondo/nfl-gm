import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { StaticData, TeamInfo } from '@contracts/index'
import { teamAbbr, teamLabel } from '@screens/shared/teamLabel'
import { describe, expect, it } from 'vitest'

const real = JSON.parse(
  readFileSync(resolve(__dirname, '../../public/data/teams.json'), 'utf8'),
) as { teams: TeamInfo[] }
const data = {
  teams: Object.fromEntries(real.teams.map((t) => [t.id, t])),
} as unknown as StaticData

describe('teamLabel', () => {
  it.each([
    ['LAR', 2015, 'STL', 'St. Louis'],
    ['LAR', 2016, 'LAR', 'Los Angeles'],
    ['LAC', 2016, 'SD', 'San Diego'],
    ['LAC', 2017, 'LAC', 'Los Angeles'],
    ['LV', 2019, 'OAK', 'Oakland'],
    ['LV', 2020, 'LV', 'Las Vegas'],
  ])('%s in %i is %s (%s)', (id, season, abbr, city) => {
    const label = teamLabel(data, id, season)
    expect(label.abbr).toBe(abbr)
    expect(label.city).toBe(city)
    expect(label.full).toBe(`${city} ${label.name}`)
  })

  it('uses the current identity without a season and for franchises that never moved', () => {
    expect(teamAbbr(data, 'LV')).toBe('LV')
    expect(teamAbbr(data, 'MIA', 2012)).toBe('MIA')
  })

  it('falls back to the raw id for an unknown team', () => {
    expect(teamLabel(data, 'XXX', 2015).full).toBe('XXX')
  })
})
