import { describe, expect, it } from 'vitest'
import { calibrate } from './harness'

describe('season calibration on the mock league', () => {
  it('500 simulated 17-game seasons look like real ones, in under a minute', () => {
    const report = calibrate({ sims: 500, season: 2021, seed: 'calibrate' })

    expect(report.gamesPerTeam).toBe(17)
    expect(report.seconds).toBeLessThan(60)
    expect(report.truthFallbacks).toBe(0)

    expect(report.winCorrelation).toBeGreaterThan(0.5)
    expect(report.winSd).toBeGreaterThan(2.4)
    expect(report.winSd).toBeLessThan(3.6)
    expect(report.homeWinPct).toBeGreaterThan(54)
    expect(report.homeWinPct).toBeLessThan(60)
    expect(report.meanTotalPoints).toBeGreaterThan(41)
    expect(report.meanTotalPoints).toBeLessThan(49)
    expect(report.tieRate).toBeLessThan(0.01)

    // Not acceptance criteria, but a season that fails these does not feel like football.
    expect(report.overtimeRate).toBeGreaterThan(0.02)
    expect(report.overtimeRate).toBeLessThan(0.1)
    expect(report.oneMarginRate).toBeLessThan(0.04)
  }, 90_000)

  it('holds up in a pre-2012 sudden-death, 16-game era', () => {
    const report = calibrate({ sims: 80, season: 2010, seed: 'calibrate' })
    expect(report.gamesPerTeam).toBe(16)
    expect(report.winSd).toBeGreaterThan(2.4)
    expect(report.winSd).toBeLessThan(3.6)
    expect(report.homeWinPct).toBeGreaterThan(53)
    expect(report.homeWinPct).toBeLessThan(60)
    expect(report.meanTotalPoints).toBeGreaterThan(41)
    expect(report.meanTotalPoints).toBeLessThan(49)
    // Sudden death and a 15-minute period: fewer ties than the modern era.
    expect(report.tieRate).toBeLessThan(0.005)
  }, 60_000)
})
