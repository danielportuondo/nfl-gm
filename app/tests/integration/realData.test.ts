/**
 * Phase 2 integration: the shipped data (app/public/data) through the real engine. Proves the data
 * contract holds where the engine depends on it, that a real season completes deterministically, and
 * that the sim is calibrated against the real 2015 standings (HANDOFF §6.3 targets).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_IDS, toSaved, type EngineContext, type LeagueState } from '@contracts/index'
import { resetTruthFallbackCount, truthFallbackCount } from '@engine/sim/index'
import { calibrate } from '../engine/sim/harness'
import {
  loadRealContext,
  readManifest,
  realWinTotals,
  seasonsForNewGame,
} from '../../scripts/lib/publicData'
import { emptyLog, userCutdowns, userDraft, userFreeAgency } from '../../scripts/lib/scriptedGm'

const SEASON = 2015
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

/** toSaved stamps savedAt with the real clock, so determinism checks must ignore it. */
function withoutSavedAt(saved: ReturnType<typeof toSaved>) {
  return { ...saved, savedAt: undefined }
}

function newGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame(
    {
      seed,
      startSeason: SEASON,
      userTeam: 'IND',
      horizonSeasons: 1,
      settings: SETTINGS,
      startAt: 'PRESEASON',
    },
    ctx,
  )
}

function newOpeningGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame(
    { seed, startSeason: SEASON, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS },
    ctx,
  )
}

/** The user's opening offseason as the store drives it: draft, UDFA, free agency, camp, cutdowns. */
function playOpeningOffseason(state: LeagueState, ctx: EngineContext) {
  const { league, draft } = ctx.modules
  const log = emptyLog()
  let s = draft.startDraft(state, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx) // DRAFT → UDFA
  s = league.advancePhase(s, ctx) // UDFA → FREE_AGENCY
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx) // FREE_AGENCY → TRAINING_CAMP
  s = league.advancePhase(s, ctx) // TRAINING_CAMP → PRESEASON (opening rollover)
  s = userCutdowns(s, ctx, log)
  return { state: s, log }
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

  it(`opens before the ${SEASON} draft and reaches opening day on real rosters`, () => {
    const sd = ctx.seasonData(SEASON)!
    const opening = newOpeningGame(ctx, 'real-opening')
    expect(opening.season).toBe(SEASON - 1)
    expect(opening.phase).toBe('DRAFT')
    for (const p of sd.draft.prospects) expect(opening.players[p.id], p.name).toBeUndefined()
    const classPicks = opening.picks.filter((p) => p.season === SEASON)
    expect(classPicks).toHaveLength(sd.draft.order.length)
    expect(classPicks.every((p) => p.pick !== null)).toBe(true)
    expect(new Set(opening.picks.map((p) => p.season))).toEqual(
      new Set([SEASON, SEASON + 1, SEASON + 2]),
    )

    const { state: pre, log } = playOpeningOffseason(opening, ctx)
    expect(pre.season).toBe(SEASON)
    expect(pre.phase).toBe('PRESEASON')
    expect(log.drafted.length).toBeGreaterThan(0)

    // PRESEASON → REGULAR runs AI cutdowns and validates every roster (throws otherwise).
    const s = ctx.modules.league.advancePhase(pre, ctx)
    expect(s.phase).toBe('REGULAR')
    const seen = new Map<string, string>()
    for (const teamId of TEAM_IDS) {
      const roster = s.teams[teamId]!.roster
      expect(roster.length, teamId).toBeGreaterThanOrEqual(46)
      expect(roster.length, teamId).toBeLessThanOrEqual(53)
      for (const slot of roster) {
        expect(seen.get(slot.playerId), slot.playerId).toBeUndefined()
        seen.set(slot.playerId, teamId)
      }
    }

    // The snap plus anchored cutdowns put AI teams back on their real opening-day rosters
    // (headless measures 99 % mean / 96 % min after a normal rollover).
    let sum = 0
    let n = 0
    const shares: { teamId: string; share: number }[] = []
    for (const teamId of TEAM_IDS) {
      if (teamId === 'IND') continue
      const real = new Set((sd.rosters.rosters[teamId] ?? []).map((e) => e.playerId))
      const have = s.teams[teamId]!.roster.filter((r) => real.has(r.playerId)).length
      const share = have / real.size
      shares.push({ teamId, share })
      sum += share
      n++
    }
    const mean = sum / n
    if (mean < 0.9) {
      const min = Math.min(...shares.map((r) => r.share))
      console.log('opening offseason AI roster overlap — mean', mean, 'min', min, shares)
    }
    expect(mean).toBeGreaterThanOrEqual(0.9)

    // The user's drafted rookies carry a draft origin for this class and a rookie contract.
    const userRoster = s.teams.IND!.roster
    const kept = log.drafted.filter((d) => userRoster.some((r) => r.playerId === d.playerId))
    expect(kept.length).toBeGreaterThan(0)
    for (const d of kept) {
      const p = s.players[d.playerId]!
      expect(p.draft?.season, p.name).toBe(SEASON)
      expect(p.draft?.team, p.name).toBe('IND')
      expect(userRoster.find((r) => r.playerId === d.playerId)!.contract.rookie).toBe(true)
    }

    const again = ctx.modules.league.advancePhase(
      playOpeningOffseason(newOpeningGame(ctx, 'real-opening'), ctx).state,
      ctx,
    )
    expect(withoutSavedAt(toSaved(again))).toEqual(withoutSavedAt(toSaved(s)))
  })
})
