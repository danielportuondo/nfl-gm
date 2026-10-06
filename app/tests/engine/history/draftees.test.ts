/**
 * §6.8 regression (MIA 2017 playthrough): a draftee stays with the team that drafted him even when the
 * pick was traded, and history snap never adds players to the user's roster.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { type EngineContext, type LeagueState, type PlayerId } from '@contracts/index'
import { draft } from '@engine/draft'
import { fa } from '@engine/fa'
import { history } from '@engine/history'
import { makeFakeModules } from '../fakes'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017
const USER = 'MIA'
const TRADED_TO_LAR = [97, 164, 178, 194]
const TRADED_TO_JAX = [237]

describe('history.snapToHistory after a draft with traded picks (MIA 2017)', () => {
  let ctx: EngineContext
  let started: LeagueState
  let drafted: LeagueState
  let classSeason: number
  let userRosterBefore: Set<PlayerId>

  beforeAll(async () => {
    ctx = await loadRealContext(
      seasonsForNewGame(START, readManifest().latestRealSeason),
      makeFakeModules({ draft, fa, history }),
    )
    const state = ctx.modules.league.newGame(
      {
        seed: 'traded-picks',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      },
      ctx,
    )
    started = draft.startDraft(state, ctx)
    classSeason = started.draftRoom!.season
    const buyer = (pick: number | null): string | null =>
      pick !== null && TRADED_TO_LAR.includes(pick)
        ? 'LAR'
        : pick !== null && TRADED_TO_JAX.includes(pick)
          ? 'JAX'
          : null
    const traded: LeagueState = {
      ...started,
      picks: started.picks.map((p) =>
        p.season === classSeason && buyer(p.pick) ? { ...p, owner: buyer(p.pick)! } : p,
      ),
    }
    drafted = draft.autoDraftToEnd(traded, ctx)
    userRosterBefore = new Set(drafted.teams[USER]!.roster.map((s) => s.playerId))
  }, 60000)

  it("keeps each traded pick's draftee with the buyer", () => {
    const buyers = new Map([
      ...TRADED_TO_LAR.map((p) => [p, 'LAR'] as const),
      ...TRADED_TO_JAX.map((p) => [p, 'JAX'] as const),
    ])
    const tradedDraftees = drafted
      .draftRoom!.log.filter((e) => buyers.has(e.pick))
      .map((e) => ({ id: e.playerId, team: buyers.get(e.pick)! }))
    expect(tradedDraftees).toHaveLength(5)

    const snapped = history.snapToHistory({ ...drafted, season: classSeason }, ctx)
    const teamOf = new Map<PlayerId, string>()
    for (const [teamId, team] of Object.entries(snapped.teams))
      for (const slot of team.roster) teamOf.set(slot.playerId, teamId)

    for (const d of tradedDraftees) expect(teamOf.get(d.id), d.id).toBe(d.team)
  }, 30000)

  it('never adds a player to the user roster', () => {
    const snapped = history.snapToHistory({ ...drafted, season: classSeason }, ctx)
    const added = snapped.teams[USER]!.roster.filter((s) => !userRosterBefore.has(s.playerId))
    expect(added.map((s) => s.playerId)).toEqual([])
    expect(snapped.teams[USER]!.roster.length).toBe(userRosterBefore.size)
  }, 30000)

  it('does not mark the draftee of an AI-to-AI pick trade as diverged', () => {
    const AI_BUYER = 'SF'
    const target = started.picks.find(
      (p) =>
        p.season === classSeason &&
        p.round === 1 &&
        p.playerId === null &&
        p.owner === p.originalTeam &&
        p.owner !== USER &&
        p.owner !== AI_BUYER,
    )!
    const aiTrade: LeagueState = {
      ...started,
      picks: started.picks.map((p) => (p === target ? { ...p, owner: AI_BUYER } : p)),
    }
    const done = draft.autoDraftToEnd(aiTrade, ctx)
    const entry = done.draftRoom!.log.find((e) => e.pick === target.pick)!
    expect(entry.team).toBe(AI_BUYER)

    const snapped = history.snapToHistory({ ...done, season: classSeason }, ctx)
    const event = snapped.snapLog.find((e) => e.playerId === entry.playerId)
    expect(event?.reason).not.toBe('DIVERGED_KEPT')
  }, 30000)

  it('still anchors AI teams, and is deterministic', () => {
    const a = history.snapToHistory({ ...drafted, season: classSeason }, ctx)
    const b = history.snapToHistory({ ...drafted, season: classSeason }, ctx)
    expect(b.snapLog).toEqual(a.snapLog)
    expect(a.snapLog.filter((e) => e.reason === 'HISTORY').length).toBeGreaterThan(500)
  })
})
