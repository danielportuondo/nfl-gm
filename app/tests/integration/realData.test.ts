/**
 * Phase 2 integration: the shipped data (app/public/data) through the real engine. Proves the data
 * contract holds where the engine depends on it, that a real season completes deterministically, and
 * that the sim is calibrated against the real 2015 standings (HANDOFF §6.3 targets).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_IDS, type EngineContext, type LeagueState } from '@contracts/index'
import { resetTruthFallbackCount, truthFallbackCount } from '@engine/sim/index'
import { calibrate } from '../engine/sim/harness'
import {
  loadRealContext,
  readManifest,
  realWinTotals,
  seasonsForNewGame,
} from '../../scripts/lib/publicData'

const SEASON = 2015
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

function newGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame(
    { seed, startSeason: SEASON, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS },
    ctx,
  )
}

function playSeason(state: LeagueState, ctx: EngineContext): LeagueState {
  let s = ctx.modules.league.advancePhase(state, ctx)
  let guard = 0
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
    s = ctx.modules.league.simWeek(s, ctx).state
    if (++guard > 30) throw new Error('season did not finish')
  }
  return s
}

describe(`real data ${SEASON}`, () => {
  let ctx: EngineContext

  beforeAll(async () => {
    const manifest = readManifest()
    ctx = await loadRealContext(seasonsForNewGame(SEASON, manifest.latestRealSeason))
  })

  it('newGame starts every team on a legal opening-day roster with no player in two places', () => {
    const state = newGame(ctx, 'real-newgame')
    const chunk = ctx.seasonData(SEASON)!
    expect(Object.keys(state.teams)).toHaveLength(32)

    const rostered = new Map<string, string>()
    for (const teamId of TEAM_IDS) {
      const roster = state.teams[teamId]!.roster
      expect(roster.length, teamId).toBeGreaterThanOrEqual(46)
      expect(roster.length, teamId).toBeLessThanOrEqual(53)
      for (const slot of roster) {
        expect(
          rostered.has(slot.playerId),
          `${slot.playerId} on ${rostered.get(slot.playerId)} and ${teamId}`,
        ).toBe(false)
        rostered.set(slot.playerId, teamId)
        expect(slot.contract.apy).toBeGreaterThan(0)
        expect(slot.contract.years).toBeGreaterThanOrEqual(1)
      }
    }
    const freeAgents = new Set(state.freeAgents)
    for (const id of rostered.keys()) expect(freeAgents.has(id)).toBe(false)
    expect(rostered.size + freeAgents.size).toBe(chunk.players.players.length)

    expect(state.schedule.filter((g) => g.type === 'REG')).toHaveLength(256)
    // Picks for the next two drafts: the 2016 class is real (pick numbers known), owned by the drafting teams.
    const seasons = new Set(state.picks.map((p) => p.season))
    expect([...seasons].sort()).toEqual([SEASON + 1, SEASON + 2])
    expect(state.picks.filter((p) => p.season === SEASON + 1).every((p) => p.pick !== null)).toBe(
      true,
    )
  })

  it('a full season completes deterministically with no truth fallbacks', () => {
    resetTruthFallbackCount()
    const a = playSeason(newGame(ctx, 'real-season'), ctx)
    const b = playSeason(newGame(ctx, 'real-season'), ctx)
    const c = playSeason(newGame(ctx, 'real-season-other'), ctx)

    expect(a.phase).toBe('OFFSEASON_RESIGN')
    expect(a.history).toHaveLength(1)
    expect(a.history[0]!.champion).not.toBeNull()
    expect(a.results).toHaveLength(256 + 11)
    expect(truthFallbackCount()).toBe(0)
    for (const teamId of TEAM_IDS) {
      const r = a.teams[teamId]!.record
      expect(r.wins + r.losses + r.ties, teamId).toBe(16)
    }
    const injuredWeeks = a.results.reduce((n, r) => n + r.injuries.length, 0)
    expect(injuredWeeks).toBeGreaterThan(0)

    expect(a.results).toEqual(b.results)
    expect(a.history).toEqual(b.history)
    expect(a.results).not.toEqual(c.results)
  })

  it('simulated seasons track the real 2015 standings (§6.3 calibration targets)', () => {
    const state = newGame(ctx, 'real-calibrate')
    const realWins = realWinTotals(ctx.seasonData(SEASON)!.schedule)!
    const r = calibrate({ sims: 60, seed: 'real-calibrate', state, ctx, realWins })
    expect(r.realWinCorrelation).toBeGreaterThanOrEqual(0.5)
    expect(r.winSd).toBeGreaterThanOrEqual(2.4)
    expect(r.winSd).toBeLessThanOrEqual(3.6)
    expect(r.homeWinPct).toBeGreaterThanOrEqual(52)
    expect(r.homeWinPct).toBeLessThanOrEqual(62)
    expect(r.meanTotalPoints).toBeGreaterThanOrEqual(41)
    expect(r.meanTotalPoints).toBeLessThanOrEqual(49)
    expect(r.tieRate).toBeLessThan(0.01)
    expect(r.multiWeekInjuriesPerTeamGame).toBeGreaterThanOrEqual(0.6)
    expect(r.multiWeekInjuriesPerTeamGame).toBeLessThanOrEqual(1.6)
    expect(r.truthFallbacks).toBe(0)
  })
})
