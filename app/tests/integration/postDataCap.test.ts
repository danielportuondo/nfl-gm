/**
 * Regression: KC 2024 x4 (seed "headless") ended with DAL $475M over the cap in 2027, the first season
 * past the real data. A generated first-round kicker was re-signed and released every week, booking
 * his guarantee as dead money each time. Every team must be at or under the cap on opening day, after
 * every week and after the Super Bowl of every season, including the procedural ones.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_IDS, type EngineContext, type LeagueState } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../scripts/lib/publicData'
import {
  emptyLog,
  userCutdowns,
  userDraft,
  userFreeAgency,
  userResign,
} from '../../scripts/lib/scriptedGm'

const START = 2024
const SEASONS = 4
const EPSILON = 1e-6

function overCap(s: LeagueState, ctx: EngineContext, label: string): string[] {
  const cap = ctx.modules.fa.capFor(s.season, ctx)
  return TEAM_IDS.flatMap((teamId) => {
    const pay = ctx.modules.fa.payroll(s, teamId)
    return pay > cap + EPSILON
      ? [`${label}: ${teamId} $${pay.toFixed(1)}M over the $${cap.toFixed(1)}M cap`]
      : []
  })
}

describe(`cap invariant from a ${START} start, through the procedural seasons`, () => {
  let ctx: EngineContext

  beforeAll(async () => {
    const manifest = readManifest()
    const wanted = new Set<number>()
    for (let s = START; s < START + SEASONS; s++)
      for (const x of seasonsForNewGame(s, manifest.latestRealSeason)) wanted.add(x)
    ctx = await loadRealContext([...wanted].sort((a, b) => a - b))
  }, 120000)

  it('no team is over the cap on opening day, in any week or at the end of any season', () => {
    const { league, draft } = ctx.modules
    const log = emptyLog()
    let s = league.newGame(
      {
        seed: 'headless',
        startSeason: START,
        userTeam: 'KC',
        horizonSeasons: SEASONS,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      },
      ctx,
    )
    s = draft.startDraft(s, ctx)
    s = userDraft(s, ctx, log)
    s = league.advancePhase(s, ctx) // DRAFT -> UDFA
    s = league.advancePhase(s, ctx) // UDFA -> FREE_AGENCY
    s = userFreeAgency(s, ctx, log)
    s = league.advancePhase(s, ctx) // FREE_AGENCY -> TRAINING_CAMP
    s = league.advancePhase(s, ctx) // TRAINING_CAMP -> PRESEASON
    s = userCutdowns(s, ctx, log)

    const problems: string[] = []
    for (let i = 0; i < SEASONS; i++) {
      const season = s.season
      s = league.advancePhase(s, ctx) // PRESEASON -> REGULAR
      problems.push(...overCap(s, ctx, `${season} opening day`))
      let guard = 0
      while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
        s = league.simWeek(s, ctx).state
        problems.push(...overCap(s, ctx, `${season} week ${s.week}`))
        if (++guard > 30) throw new Error('season did not finish')
      }
      problems.push(...overCap(s, ctx, `${season} end of season`))
      if (i === SEASONS - 1) break
      s = userResign(s, ctx, log)
      s = league.advancePhase(s, ctx) // OFFSEASON_RESIGN -> DRAFT
      s = draft.startDraft(s, ctx)
      s = userDraft(s, ctx, log)
      s = league.advancePhase(s, ctx) // DRAFT -> UDFA
      s = league.advancePhase(s, ctx) // UDFA -> FREE_AGENCY
      s = userFreeAgency(s, ctx, log)
      s = league.advancePhase(s, ctx) // FREE_AGENCY -> TRAINING_CAMP
      s = league.advancePhase(s, ctx) // TRAINING_CAMP -> PRESEASON
      s = userCutdowns(s, ctx, log)
    }

    expect(s.season).toBe(START + SEASONS - 1)
    expect(problems.slice(0, 8)).toEqual([])
  }, 240000)
})
