import { beforeAll, describe, expect, it } from 'vitest'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { boxStatsCollector, runSeason, type BoxSeasonStats } from './harness'

const SEASONS = [2015, 2016, 2017, 2018, 2019]
const SIMS_PER_SEASON = 4

/**
 * Real 2015–2019 regular seasons: ~34–35 pass attempts and ~110–116 rush yards per team-game,
 * 7–12 thousand-yard rushers, 7–12 four-thousand-yard passers and 14–23 thousand-yard receivers.
 */
describe('season box-score distribution on 2015–2019 data', () => {
  let stats: BoxSeasonStats

  beforeAll(async () => {
    const latest = readManifest().latestRealSeason
    const perSeason: BoxSeasonStats[] = []
    for (const season of SEASONS) {
      const ctx = await loadRealContext(seasonsForNewGame(season, latest))
      const state = ctx.modules.league.newGame(
        {
          seed: 'box-distribution',
          startSeason: season,
          userTeam: 'IND',
          horizonSeasons: 1,
          settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
          startAt: 'PRESEASON',
        },
        ctx,
      )
      const box = boxStatsCollector(state)
      for (let i = 0; i < SIMS_PER_SEASON; i++) {
        runSeason({ ...state, seed: `${state.seed}#${i}` }, ctx, box.onResult)
        box.endSeason()
      }
      perSeason.push(box.summary())
    }
    const mean = (key: keyof BoxSeasonStats) =>
      perSeason.reduce((acc, s) => acc + s[key], 0) / perSeason.length
    stats = Object.fromEntries(
      (Object.keys(perSeason[0]!) as (keyof BoxSeasonStats)[]).map((k) => [k, mean(k)]),
    ) as unknown as BoxSeasonStats
  }, 120_000)

  it('teams throw and run at modern rates', () => {
    expect(stats.passAttPerTeamGame).toBeGreaterThanOrEqual(33)
    expect(stats.passAttPerTeamGame).toBeLessThanOrEqual(36)
    expect(stats.rushYdsPerTeamGame).toBeGreaterThanOrEqual(108)
    expect(stats.rushYdsPerTeamGame).toBeLessThanOrEqual(120)
  })

  it('milestone seasons are about as common as in real years', () => {
    expect(stats.rushers1000).toBeGreaterThanOrEqual(6)
    expect(stats.rushers1000).toBeLessThanOrEqual(11)
    expect(stats.passers4000).toBeGreaterThanOrEqual(8)
    expect(stats.passers4000).toBeLessThanOrEqual(14)
    expect(stats.receivers1000).toBeGreaterThanOrEqual(18)
    expect(stats.receivers1000).toBeLessThanOrEqual(25)
  })

  it('league leaders land where real leaders do', () => {
    expect(stats.passLeader).toBeGreaterThanOrEqual(4500)
    expect(stats.passLeader).toBeLessThanOrEqual(5200)
    expect(stats.rushLeader).toBeGreaterThanOrEqual(1300)
    expect(stats.rushLeader).toBeLessThanOrEqual(1600)
    expect(stats.recLeader).toBeGreaterThanOrEqual(1400)
    expect(stats.recLeader).toBeLessThanOrEqual(1950)
  })

  it('no single receiver or tight end swallows a passing game', () => {
    expect(stats.topReceiverShare).toBeGreaterThan(0.24)
    expect(stats.topReceiverShare).toBeLessThan(0.34)
    expect(stats.topTeShare).toBeGreaterThan(0.1)
    expect(stats.topTeShare).toBeLessThan(0.2)
  })
})
