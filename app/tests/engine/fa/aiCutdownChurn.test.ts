/**
 * Regression: a generated 2027 class put a kicker at pick 6. The cutdown re-signed that first-round
 * rookie from the pool on every run, trimmed him as the surplus K, and booked his $11.8M guarantee as
 * dead money again each week, so DAL went $475M over the cap. A cutdown that has already run must be a
 * no-op for payroll when it runs again.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { TEAM_IDS, type EngineContext, type LeagueState, type TeamId } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017
const USER: TeamId = 'MIA'
const TEAM: TeamId = 'DAL'

describe('AI cutdown is idempotent for payroll', () => {
  let ctx: EngineContext
  let week1: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    const { league } = ctx.modules
    const s = league.newGame(
      {
        seed: 'cutdown-churn',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 2,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
    week1 = league.advancePhase(s, ctx)
  }, 120000)

  /** A first-round kicker drafted by `team` this season and still unsigned, on top of the K it has. */
  function withUnsignedFirstRoundKicker(s: LeagueState): { state: LeagueState; kickerId: string } {
    const template = s.freeAgents
      .map((id) => s.players[id]!)
      .find((p) => p.pos === 'K' && s.scouting[p.id] !== undefined)
    if (!template) throw new Error('no free-agent kicker to clone')
    const kickerId = 'gen-churn-first-round-k'
    const rookie = {
      ...template,
      id: kickerId,
      real: false,
      rookieSeason: s.season,
      draft: { season: s.season, round: 1, pick: 6, team: TEAM },
    }
    return {
      kickerId,
      state: {
        ...s,
        players: { ...s.players, [kickerId]: rookie },
        scouting: {
          ...s.scouting,
          [kickerId]: { ovr: 70.3, pot: 80.9, confidence: 0.5 },
        },
        freeAgents: [...s.freeAgents, kickerId].sort(),
      },
    }
  }

  it.each(['PRESEASON', 'REGULAR'] as const)(
    're-running the %s cutdown never adds payroll or dead money for a first-round kicker',
    (phase) => {
      const { state: seeded } = withUnsignedFirstRoundKicker({ ...week1, phase })
      const { fa } = ctx.modules
      const first = fa.runAiCutdowns(seeded, ctx)
      const payrollAfterFirst = fa.payroll(first, TEAM)
      let s = first
      for (let week = 0; week < 6; week++) s = fa.runAiCutdowns(s, ctx)

      expect(fa.payroll(s, TEAM)).toBeLessThanOrEqual(payrollAfterFirst + 1e-6)
      expect(s.teams[TEAM]!.deadMoney).toBeLessThanOrEqual(first.teams[TEAM]!.deadMoney + 1e-6)
      for (const teamId of TEAM_IDS) {
        if (teamId === USER) continue
        expect(fa.payroll(s, teamId), teamId).toBeLessThanOrEqual(
          Math.max(fa.payroll(first, teamId), fa.capFor(s.season, ctx)) + 1e-6,
        )
      }
    },
  )
})
