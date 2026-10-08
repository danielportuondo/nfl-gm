/**
 * QA 2017 M4: consensus catches up to the season just played the moment the Super Bowl ends, so the
 * Season Recap's "Your moves" and the whole offseason (re-sign, FA, trades, draft) run on the new view.
 * Real 2017 data: Harrison Butker (rookie kicker, consensus ~59, a very good 2017) is the breakout.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, PlayerId } from '@contracts/index'
import { ratingFor } from '../../src/screens/SeasonRecap/moves'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../scripts/lib/publicData'

const START = 2017
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

function playToSuperBowlEnd(state: LeagueState, ctx: EngineContext): LeagueState {
  let s = ctx.modules.league.advancePhase(state, ctx) // PRESEASON -> REGULAR
  let guard = 0
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
    s = ctx.modules.league.simWeek(s, ctx).state
    if (++guard > 30) throw new Error('season did not finish')
  }
  return s
}

describe('consensus refresh at the end of the season (2017 Butker)', () => {
  let ctx: EngineContext
  let butker: PlayerId
  let atPreseason: LeagueState
  let afterSuperBowl: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    const newGame = (userTeam: string) =>
      ctx.modules.league.newGame(
        {
          seed: 'sb-refresh',
          startSeason: START,
          userTeam,
          horizonSeasons: 3,
          settings: SETTINGS,
          startAt: 'PRESEASON',
        },
        ctx,
      )
    const probe = newGame('KC')
    butker = Object.values(probe.players).find((p) => p.name === 'Harrison Butker')!.id
    const team = Object.values(probe.teams).find((t) =>
      t.roster.some((r) => r.playerId === butker),
    )!
    // The user cuts him in August on his rookie rating: the move log keeps that "then" number.
    atPreseason = ctx.modules.fa.release(newGame(team.id), team.id, butker, ctx)
    afterSuperBowl = playToSuperBowlEnd(atPreseason, ctx)
  }, 120000)

  it('moves a breakout player consensus as soon as the season ends', () => {
    expect(afterSuperBowl.phase).toBe('OFFSEASON_RESIGN')
    const before = atPreseason.scouting[butker]!.ovr
    const after = afterSuperBowl.scouting[butker]!.ovr
    expect(after - before).toBeGreaterThanOrEqual(10)
  })

  it('shows then and now apart in "Your moves"', () => {
    const release = afterSuperBowl.transactions.find((t) => t.kind === 'RELEASE')!
    const shown = ratingFor(afterSuperBowl, butker, release.ovrAtMove)!
    expect(shown.then).toBeDefined()
    expect(shown.now).not.toBe(shown.then)
  })
})
