import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, GameResult, LeagueState, PlayerGameLine } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { boxPoints, calibrate, runSeason } from './harness'

const SEASON = 2015

const sum = (lines: readonly PlayerGameLine[], key: keyof PlayerGameLine) =>
  lines.reduce((acc, line) => acc + ((line[key] as number | undefined) ?? 0), 0)

describe(`seeded ${SEASON} seasons on the shipped data`, () => {
  let ctx: EngineContext
  let state: LeagueState
  const results: GameResult[] = []

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(SEASON, readManifest().latestRealSeason))
    state = ctx.modules.league.newGame(
      {
        seed: 'real-box',
        startSeason: SEASON,
        userTeam: 'IND',
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
    runSeason(state, ctx, (r) => results.push(r))
  }, 60_000)

  it('every team-game box adds up to its final score', () => {
    expect(results).toHaveLength(256)
    const misses: string[] = []
    for (const r of results) {
      if (boxPoints(r.box!.home) !== r.homeScore) misses.push(`${r.gameId} home`)
      if (boxPoints(r.box!.away) !== r.awayScore) misses.push(`${r.gameId} away`)
    }
    expect(misses).toEqual([])
  })

  it('two-point conversions, safeties and non-offensive touchdowns show up at football rates', () => {
    const count = (key: keyof PlayerGameLine) =>
      results.reduce((acc, r) => acc + sum(r.box!.home, key) + sum(r.box!.away, key), 0)
    const teamGames = results.length * 2
    // NFL seasons run ~40–70 successful two-point tries, ~5–15 safeties and ~60–90 return TDs.
    expect(count('twoPt')).toBeGreaterThan(20)
    expect(count('safeties')).toBeGreaterThan(2)
    const nonOffense = count('defTd') + count('retTd')
    expect(nonOffense / teamGames).toBeGreaterThan(0.08)
    expect(nonOffense / teamGames).toBeLessThan(0.22)
    expect(count('defTd')).toBeGreaterThan(count('retTd'))
  })

  it('injuries per team-game sit inside the §6.3 calibration bands', () => {
    const report = calibrate({ sims: 20, state, ctx })
    expect(report.injuriesPerTeamGame).toBeGreaterThan(0.6)
    expect(report.injuriesPerTeamGame).toBeLessThan(1.6)
    expect(report.multiWeekInjuriesPerTeamGame).toBeGreaterThan(0.35)
    expect(report.multiWeekInjuriesPerTeamGame).toBeLessThan(0.8)
  })
})
