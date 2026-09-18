import { describe, expect, it } from 'vitest'
import { injuredWeeksLabel, isRookie } from '@screens/shared/playerStatus'

describe('isRookie', () => {
  it('treats rookieSeason === season as a rookie from PRESEASON through OFFSEASON_RESIGN', () => {
    for (const phase of ['PRESEASON', 'REGULAR', 'PLAYOFFS', 'OFFSEASON_RESIGN'] as const) {
      expect(isRookie({ rookieSeason: 2015 }, { season: 2015, phase })).toBe(true)
      expect(isRookie({ rookieSeason: 2016 }, { season: 2015, phase })).toBe(false)
    }
  })

  it('shifts to rookieSeason === season + 1 from DRAFT through TRAINING_CAMP', () => {
    for (const phase of ['DRAFT', 'UDFA', 'FREE_AGENCY', 'TRAINING_CAMP'] as const) {
      expect(isRookie({ rookieSeason: 2016 }, { season: 2015, phase })).toBe(true)
      expect(isRookie({ rookieSeason: 2015 }, { season: 2015, phase })).toBe(false)
    }
  })
})

describe('injuredWeeksLabel', () => {
  it('formats weeks out', () => {
    expect(injuredWeeksLabel({ weeksOut: 3, kind: 'knee', season: 2015, week: 4 })).toBe('Out 3 wk')
  })

  it('is null when not injured', () => {
    expect(injuredWeeksLabel(undefined)).toBeNull()
  })
})
