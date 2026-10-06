/**
 * AI teams backfill holes in-season (QA M6: KC carried one QB all 2018 after the user took its starter,
 * LAR had no K, a team stayed at 51 players). The league's week loop runs fa.runAiCutdowns for AI teams,
 * which now also tops rosters up to 53 and restores position minimums within the cap.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { type EngineContext, type LeagueState, type TeamId } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017
const USER: TeamId = 'MIA'

describe('AI roster backfill during the season', () => {
  let ctx: EngineContext
  let week1: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    const { league } = ctx.modules
    const s = league.newGame(
      {
        seed: 'fill-needs',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 2,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
    week1 = league.advancePhase(s, ctx) // PRESEASON -> REGULAR
  }, 120000)

  const countPos = (s: LeagueState, t: TeamId, pos: string): number =>
    s.teams[t]!.roster.filter((r) => s.players[r.playerId]!.pos === pos).length

  /** What a user trade does to the other side: players leave an AI roster for the user's. */
  function takePlayers(s: LeagueState, from: TeamId, ids: string[]): LeagueState {
    const gone = new Set(ids)
    const taken = s.teams[from]!.roster.filter((r) => gone.has(r.playerId))
    return {
      ...s,
      teams: {
        ...s.teams,
        [from]: {
          ...s.teams[from]!,
          roster: s.teams[from]!.roster.filter((r) => !gone.has(r.playerId)),
        },
        [USER]: {
          ...s.teams[USER]!,
          roster: [...s.teams[USER]!.roster, ...taken.map((r) => ({ ...r, teamId: USER }))],
        },
      },
    }
  }

  it('an AI team whose only starting QB goes to the user signs another QB before its next game', () => {
    const team: TeamId = 'KC'
    const qbs = week1.teams[team]!.roster.filter((r) => week1.players[r.playerId]!.pos === 'QB')
    // Leave exactly one QB, the weaker one (the user took the starter).
    const sorted = [...qbs].sort(
      (a, b) => (week1.scouting[b.playerId]?.ovr ?? 0) - (week1.scouting[a.playerId]?.ovr ?? 0),
    )
    const taken = sorted.slice(0, -1).map((r) => r.playerId)
    const hurt = takePlayers(week1, team, taken)
    expect(countPos(hurt, team, 'QB')).toBe(1)

    const { state } = ctx.modules.league.simWeek(hurt, ctx)
    expect(countPos(state, team, 'QB')).toBeGreaterThanOrEqual(2)
    expect(state.teams[team]!.roster.length).toBe(53)
    expect(ctx.modules.fa.validateRoster(state, team, ctx).ok).toBe(true)
    const chartQbs = (state.teams[team]!.depthChart.QB ?? []).filter(
      (id) => state.players[id]?.pos === 'QB',
    )
    expect(chartQbs.length).toBeGreaterThanOrEqual(2)
  })

  it('an AI team left at 51 players is back to 53 and under the cap', () => {
    const team: TeamId = 'NYJ'
    const spare = week1.teams[team]!.roster.filter(
      (r) => !['QB', 'K', 'P'].includes(week1.players[r.playerId]!.pos),
    )
      .slice(-2)
      .map((r) => r.playerId)
    const hurt = takePlayers(week1, team, spare)
    expect(hurt.teams[team]!.roster.length).toBe(51)

    const { state } = ctx.modules.league.simWeek(hurt, ctx)
    expect(state.teams[team]!.roster.length).toBe(53)
    expect(ctx.modules.fa.validateRoster(state, team, ctx).ok).toBe(true)
  })
})
