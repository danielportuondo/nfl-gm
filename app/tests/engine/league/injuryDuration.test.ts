/**
 * Injury durations on a real season: a player rolled N weeks out sits for his team's games in the N
 * calendar weeks that follow the injury. Bye rule: a bye week still counts as a week served (an NFL
 * "out 2 weeks" over a bye misses one game), so games missed == team games in weeks w+1..w+N.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { emptyLog, userDraft, userFreeAgency, userResign } from '../../../scripts/lib/scriptedGm'

const SEASON = 2015

interface Observed {
  teamId: string
  playerId: string
  week: number
  weeksOut: number
}

interface SeasonLog {
  injuries: Observed[]
  /** week -> team -> players listed as injured when that week's games were played */
  outBefore: Map<number, Map<string, Set<string>>>
  teamWeeks: Map<string, Set<number>>
  lastRegWeek: number
}

function playRegularSeason(ctx: EngineContext): SeasonLog {
  const { league } = ctx.modules
  let s: LeagueState = league.newGame(
    {
      seed: 'injury-duration',
      startSeason: SEASON,
      userTeam: 'IND',
      horizonSeasons: 1,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      startAt: 'PRESEASON',
    },
    ctx,
  )
  s = league.advancePhase(s, ctx)
  const log: SeasonLog = {
    injuries: [],
    outBefore: new Map(),
    teamWeeks: new Map(),
    lastRegWeek: Math.max(
      ...s.schedule.filter((g) => g.season === SEASON && g.type === 'REG').map((g) => g.week),
    ),
  }
  while (s.phase === 'REGULAR') {
    const week = s.week
    const games = s.schedule.filter((g) => g.season === SEASON && g.week === week)
    const out = new Map<string, Set<string>>()
    for (const g of games) {
      for (const teamId of [g.home, g.away]) {
        const weeks = log.teamWeeks.get(teamId) ?? new Set<number>()
        weeks.add(week)
        log.teamWeeks.set(teamId, weeks)
        out.set(
          teamId,
          new Set(s.teams[teamId]!.roster.filter((r) => r.injured).map((r) => r.playerId)),
        )
      }
    }
    log.outBefore.set(week, out)
    const before = s.results.length
    s = league.simWeek(s, ctx).state
    for (const r of s.results.slice(before))
      for (const e of r.injuries)
        log.injuries.push({ teamId: e.teamId, playerId: e.playerId, week, weeksOut: e.weeksOut })
  }
  return log
}

describe('injury durations on a real season', () => {
  let log: SeasonLog

  beforeAll(async () => {
    const manifest = readManifest()
    const ctx = await loadRealContext(seasonsForNewGame(SEASON, manifest.latestRealSeason))
    log = playRegularSeason(ctx)
  }, 120_000)

  it('every injury costs exactly its rolled weeks, byes counting as weeks served', () => {
    let checked = 0
    const wrong: string[] = []
    for (const inj of log.injuries) {
      if (inj.week + inj.weeksOut + 1 > log.lastRegWeek) continue
      if (log.outBefore.get(inj.week)?.get(inj.teamId)?.has(inj.playerId)) continue
      const teamWeeks = log.teamWeeks.get(inj.teamId)!
      let expected = 0
      let missed = 0
      // Window ends the week he is due back, so a later, separate injury cannot be counted.
      for (let w = inj.week + 1; w <= inj.week + inj.weeksOut + 1; w++) {
        if (!teamWeeks.has(w)) continue
        const wasOut = log.outBefore.get(w)!.get(inj.teamId)!.has(inj.playerId)
        if (w <= inj.week + inj.weeksOut) expected++
        if (wasOut) missed++
      }
      checked++
      if (missed !== expected)
        wrong.push(
          `${inj.playerId} wk${inj.week} rolled ${inj.weeksOut}w missed ${missed}/${expected}`,
        )
    }
    expect(checked).toBeGreaterThan(200)
    expect(wrong.slice(0, 5)).toEqual([])
  })

  it('exercises the bye rule: some multi-week injuries span a bye and cost one game fewer', () => {
    const spanning = log.injuries.filter((i) => {
      const weeks = log.teamWeeks.get(i.teamId)!
      for (let w = i.week + 1; w <= i.week + i.weeksOut; w++) if (!weeks.has(w)) return true
      return false
    })
    expect(spanning.length).toBeGreaterThan(5)
  })

  it('a one-week injury always costs the next game the team plays that week', () => {
    const oneWeekers = log.injuries.filter(
      (i) =>
        i.weeksOut === 1 &&
        log.teamWeeks.get(i.teamId)!.has(i.week + 1) &&
        i.week < log.lastRegWeek,
    )
    expect(oneWeekers.length).toBeGreaterThan(20)
    for (const i of oneWeekers)
      expect(
        log.outBefore
          .get(i.week + 1)!
          .get(i.teamId)!
          .has(i.playerId),
      ).toBe(true)
  })
})

describe('injuries still open at the final whistle', () => {
  it('heal over the offseason rather than costing games the next September', async () => {
    const start = readManifest().latestRealSeason // past the data, so rosters are not re-snapped to real ones
    const ctx = await loadRealContext(seasonsForNewGame(start, start))
    const { league, draft } = ctx.modules
    let s = league.newGame(
      {
        seed: 'injury-carry',
        startSeason: start,
        userTeam: 'IND',
        horizonSeasons: 3,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
    s = league.advancePhase(s, ctx)
    while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') s = league.simWeek(s, ctx).state
    const stillOut = (st: LeagueState) =>
      Object.values(st.teams).flatMap((t) => t.roster.filter((r) => r.injured))
    expect(stillOut(s).length).toBeGreaterThan(0)

    const log = emptyLog()
    s = userResign(s, ctx, log)
    s = league.advancePhase(s, ctx)
    s = draft.startDraft(s, ctx)
    s = userDraft(s, ctx, log)
    s = league.advancePhase(s, ctx)
    s = league.advancePhase(s, ctx)
    s = userFreeAgency(s, ctx, log)
    s = league.advancePhase(s, ctx)
    s = league.advancePhase(s, ctx)
    expect(s.season).toBe(start + 1)
    expect(stillOut(s)).toHaveLength(0)
  }, 120_000)
})
