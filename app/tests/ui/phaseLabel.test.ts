import { phaseLabel, seasonPhaseLabel, seasonText } from '@screens/shared/phaseLabel'
import { describe, expect, it } from 'vitest'

describe('season and phase labels', () => {
  it('labels offseason phases by the season they prepare', () => {
    expect(seasonText(2012, 'DRAFT')).toBe('2013 offseason')
    expect(seasonText(2012, 'OFFSEASON_RESIGN')).toBe('2013 offseason')
    expect(seasonText(2012, 'TRAINING_CAMP')).toBe('2013 offseason')
    expect(seasonText(2013, 'PRESEASON')).toBe('2013')
    expect(seasonText(2013, 'REGULAR')).toBe('2013')
    expect(seasonText(2013, 'PLAYOFFS')).toBe('2013')
  })

  it('gives the Strip a capitalised phase and running copy a lowercase one', () => {
    expect(seasonPhaseLabel(2012, 'DRAFT')).toEqual({
      seasonText: '2013 offseason',
      phaseText: 'Draft',
    })
    expect(seasonPhaseLabel(2013, 'REGULAR')).toEqual({
      seasonText: '2013',
      phaseText: 'Regular season',
    })
    expect(seasonPhaseLabel(2013, 'UDFA')).toEqual({
      seasonText: '2014 offseason',
      phaseText: 'UDFA',
    })
    expect(seasonPhaseLabel(2013, 'OFFSEASON_RESIGN').phaseText).toBe('Re-signing period')
    expect(phaseLabel('TRAINING_CAMP')).toBe('training camp')
  })
})
