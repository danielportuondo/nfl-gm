/**
 * Every draft after the opening one is ordered by the previous SIM season, in history or not: 7 × 32,
 * worst sim record first, no real-life comp picks or pick trades, ownership changed only by in-game
 * trades. The opening draft (a DRAFT-start game's startSeason class) keeps the real order exactly.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  TEAM_IDS,
  type DraftPick,
  type EngineContext,
  type GameSettings,
  type LeagueState,
} from '@contracts/index'
import { draft } from '@engine/draft'
import { draftTeamOrder } from '@engine/draft/order'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { makeFakeModules } from '../fakes'

const START = 2012
const NEXT = START + 1
const USER = 'IND'
const SETTINGS: GameSettings = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
}

const seasonPicks = (state: LeagueState, season: number): DraftPick[] =>
  state.picks.filter((p) => p.season === season)

/** The opening draft, the UDFA phase, free agency, camp, the whole sim season, then into the next DRAFT. */
function playToNextDraft(state: LeagueState, ctx: EngineContext): LeagueState {
  const { league } = ctx.modules
  let s = draft.autoDraftToEnd(draft.startDraft(state, ctx), ctx)
  for (const phase of ['UDFA', 'FREE_AGENCY', 'TRAINING_CAMP', 'PRESEASON', 'REGULAR'] as const) {
    s = league.advancePhase(s, ctx)
    expect(s.phase).toBe(phase)
  }
  for (let guard = 0; s.phase === 'REGULAR' || s.phase === 'PLAYOFFS'; guard++) {
    if (guard > 60) throw new Error('season did not finish')
    s = league.simWeek(s, ctx).state
  }
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('DRAFT')
  return s
}

/** A pre-fix save: the future in-history draft stored in its real-life shape (real numbers, comp picks). */
function legacyPicks(ctx: EngineContext, season: number): DraftPick[] {
  return ctx.seasonData(season)!.draft.order.map((entry) => ({
    season,
    round: entry.round,
    pick: entry.pick,
    originalTeam: entry.originalTeam,
    owner: entry.team,
    playerId: null,
  }))
}

describe(`a game opened at the ${START} draft`, () => {
  let ctx: EngineContext
  let opened: LeagueState
  let atNextDraft: LeagueState
  let nextRoom: DraftPick[]

  beforeAll(async () => {
    ctx = await loadRealContext(
      seasonsForNewGame(START, readManifest().latestRealSeason),
      makeFakeModules({ draft }),
    )
    opened = ctx.modules.league.newGame(
      {
        seed: 'sim-order',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 3,
        settings: SETTINGS,
      },
      ctx,
    )
    // An in-game trade of a future in-history pick, made before that draft's order is known.
    const traded: LeagueState = {
      ...opened,
      picks: opened.picks.map((p) =>
        p.season === NEXT && p.round === 2 && p.originalTeam === USER ? { ...p, owner: 'NE' } : p,
      ),
    }
    atNextDraft = playToNextDraft(traded, ctx)
    nextRoom = draft.startDraft(atNextDraft, ctx).draftRoom!.order
  })

  it('keeps the real order, comp picks and ownership for the opening draft', () => {
    const real = legacyPicks(ctx, START)
    expect(seasonPicks(opened, START)).toEqual(real)
    const room = draft.startDraft(opened, ctx).draftRoom!
    expect(
      room.order.map(({ pick, round, originalTeam, owner }) => [pick, round, originalTeam, owner]),
    ).toEqual(
      real.map(({ pick, round, originalTeam, owner }) => [pick, round, originalTeam, owner]),
    )
  })

  it('holds later in-history drafts as 7 × 32 unnumbered own-round picks', () => {
    for (const season of [NEXT, NEXT + 1]) {
      const picks = seasonPicks(opened, season)
      expect(picks, String(season)).toHaveLength(7 * 32)
      expect(picks.every((p) => p.pick === null)).toBe(true)
      expect(new Set(picks.map((p) => `${p.round}:${p.originalTeam}`)).size).toBe(7 * 32)
    }
  })

  it('orders the next draft from the sim standings, not the real ones', () => {
    expect(nextRoom).toHaveLength(7 * 32)
    expect(nextRoom.map((p) => p.pick)).toEqual(Array.from({ length: 224 }, (_, i) => i + 1))

    const season = atNextDraft.history.at(-1)!
    expect(season.season).toBe(START)
    const pct = new Map(season.standings.map((row) => [row.teamId, row.pct]))
    const worst = Math.min(...season.standings.map((row) => row.pct))
    expect(pct.get(nextRoom[0]!.originalTeam)).toBe(worst)
    expect(nextRoom[31]!.originalTeam).toBe(season.champion)
    expect(nextRoom[30]!.originalTeam).toBe(season.runnerUp)

    const teamOrder = draftTeamOrder(atNextDraft)
    for (let round = 1; round <= 7; round++) {
      const inRound = nextRoom.filter((p) => p.round === round).map((p) => p.originalTeam)
      expect(inRound, `round ${round}`).toEqual(teamOrder)
    }
    const userFirst = nextRoom.find((p) => p.round === 1 && p.originalTeam === USER)!
    expect(userFirst.pick).toBe(teamOrder.indexOf(USER) + 1)
  })

  it('drops real-life comp picks and pick trades: seven picks a team, moved only in-game', () => {
    for (const p of nextRoom) {
      const expected = p.round === 2 && p.originalTeam === USER ? 'NE' : p.originalTeam
      expect(p.owner, `${p.round}:${p.originalTeam}`).toBe(expected)
    }
    const owned = (team: string): number => nextRoom.filter((p) => p.owner === team).length
    expect(owned(USER)).toBe(6)
    expect(owned('NE')).toBe(8)
    for (const id of TEAM_IDS) if (id !== USER && id !== 'NE') expect(owned(id), id).toBe(7)
  })

  it('keeps an in-game trade of a future in-history pick through the settle, in the room and in state.picks', () => {
    const started = draft.startDraft(atNextDraft, ctx)
    const slot = started.draftRoom!.order.find((p) => p.round === 2 && p.originalTeam === USER)!
    expect(slot.owner).toBe('NE')
    const stored = seasonPicks(started, NEXT)
    expect(stored).toHaveLength(7 * 32)
    expect(stored.find((p) => p.round === 2 && p.originalTeam === USER)).toMatchObject({
      owner: 'NE',
      pick: slot.pick,
    })
  })

  it('anchors AI picks to whoever really went at the settled slot number', () => {
    const done = draft.autoDraftToEnd(draft.startDraft(atNextDraft, ctx), ctx).draftRoom!
    const real = new Map(
      ctx
        .seasonData(NEXT)!
        .draft.order.filter((e) => e.playerId)
        .map((e) => [e.pick, e.playerId]),
    )
    const historical = done.log.filter((e) => e.historical)
    expect(historical.length).toBeGreaterThan(done.log.length / 2)
    for (const e of historical) expect(real.get(e.pick)).toBe(e.playerId)
  })

  it('migrates an old save that stored the next draft in its real-life shape', () => {
    const legacy = legacyPicks(ctx, NEXT).map((p) => (p.pick === 1 ? { ...p, owner: USER } : p))
    const legacyTrade = legacy.find((p) => p.pick === 1)!
    const old: LeagueState = {
      ...atNextDraft,
      picks: [...atNextDraft.picks.filter((p) => p.season !== NEXT), ...legacy],
    }
    const started = draft.startDraft(old, ctx)
    const expected = nextRoom.map((p) => {
      if (p.round === legacyTrade.round && p.originalTeam === legacyTrade.originalTeam)
        return { ...p, owner: USER }
      // The legacy save never traded the user's round-2 pick.
      if (p.round === 2 && p.originalTeam === USER) return { ...p, owner: USER }
      return p
    })
    expect(started.draftRoom!.order).toEqual(expected)
    expect(seasonPicks(started, NEXT)).toHaveLength(7 * 32)
  })
})
