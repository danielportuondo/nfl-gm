/**
 * The draft room itself: needs, consensus-only ranking, mid-draft ownership changes, incoming offers,
 * the UDFA phase, and a generated (post-history) order.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  POSITIONS, TEAM_IDS,
  type EngineContext, type LeagueState, type SeasonSummary, type TradeProposal, type TrueTrajectory,
} from '@contracts/index'
import { draft } from '@engine/draft'
import { settleOrder } from '@engine/draft/order'
import { fakeTrade } from '../fakes'
import { CLASS_SEASON, draftContext, stateAtDraft } from './fixture'

describe('teamNeeds', () => {
  let ctx: EngineContext
  let state: LeagueState

  beforeAll(async () => {
    ctx = await draftContext()
    state = draft.startDraft(stateAtDraft(ctx, 'IND'), ctx)
  })

  it('never lists a saturated position as a top need, and stays on the 0–1 scale', () => {
    for (const teamId of TEAM_IDS) {
      const needs = draft.teamNeeds(state, teamId)
      expect(needs.top.length, teamId).toBeLessThanOrEqual(3)
      for (const pos of needs.top) expect(needs.saturated, `${teamId} ${pos}`).not.toContain(pos)
      for (const pos of POSITIONS) {
        expect(needs.byPos[pos], `${teamId} ${pos}`).toBeGreaterThanOrEqual(0)
        expect(needs.byPos[pos], `${teamId} ${pos}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('sees a hole when the starters at a position are gone', () => {
    const team = state.teams['IND']!
    const withoutQbs = {
      ...state,
      teams: {
        ...state.teams,
        IND: { ...team, roster: team.roster.filter((s) => state.players[s.playerId]?.pos !== 'QB') },
      },
    }
    const needs = draft.teamNeeds(withoutQbs, 'IND')
    expect(needs.byPos.QB).toBeGreaterThan(draft.teamNeeds(state, 'IND').byPos.QB)
    expect(needs.top).toContain('QB')
    expect(needs.saturated).not.toContain('QB')
  })
})

describe('consensus only', () => {
  it('produces the same draft when every hidden trajectory is scrambled', async () => {
    const ctx = await draftContext()
    const base = stateAtDraft(ctx, 'IND')

    const scrambled: Record<string, TrueTrajectory> = {}
    for (const id of Object.keys(base.truth).sort()) {
      scrambled[id] = { bySeason: { [String(CLASS_SEASON)]: 99 }, retiresAfter: null }
    }

    const real = draft.autoDraftToEnd(draft.startDraft(base, ctx), ctx)
    const fake = draft.autoDraftToEnd(draft.startDraft({ ...base, truth: scrambled }, ctx), ctx)
    expect(fake.draftRoom!.log).toEqual(real.draftRoom!.log)
  })
})

describe('mid-draft ownership', () => {
  it('re-syncs unmade slots from state.picks when a pick changes hands', async () => {
    const ctx = await draftContext()
    const started = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    expect(started.draftRoom!.order[0]!.owner).toBe('HOU')

    const traded: LeagueState = {
      ...started,
      picks: started.picks.map((p) =>
        p.season === CLASS_SEASON && p.round === 1 && p.originalTeam === 'HOU' ? { ...p, owner: 'CLE' } : p,
      ),
    }
    const after = draft.advance(traded, ctx)
    expect(after.draftRoom!.log[0]!.team).toBe('CLE')
    expect(after.teams['CLE']!.roster.some((s) => s.playerId === after.draftRoom!.log[0]!.playerId)).toBe(true)
    // The AI ran on past the traded slot, so the user is no longer the blocker at index 0.
    expect(after.draftRoom!.currentPickIndex).toBeGreaterThan(0)
  })
})

describe('incoming offers', () => {
  it('fills pendingOffers from trade.generateAiOffers when the user comes on the clock', async () => {
    const calls: string[] = []
    const proposal: TradeProposal = {
      id: 'offer-1',
      offer: { teamId: 'CLE', players: [], picks: [{ season: CLASS_SEASON, round: 2, originalTeam: 'CLE' }] },
      request: { teamId: 'HOU', players: [], picks: [{ season: CLASS_SEASON, round: 1, originalTeam: 'HOU' }] },
      initiatedBy: 'AI',
      season: CLASS_SEASON,
      week: 0,
    }
    const ctx = await draftContext({
      trade: {
        ...fakeTrade,
        generateAiOffers: (_state, _c, _rng, context) => {
          calls.push(context)
          return [proposal]
        },
      },
    })

    const started = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    expect(started.draftRoom!.pendingOffers).toEqual([proposal])
    expect(calls).toEqual(['draft'])
    expect(draft.offersForCurrentPick(started, ctx, ctx.modules.rng.fromSeed('x', 'y'))).toEqual([proposal])
    // Auto-drafting past the user's slot clears the offers with the pick.
    const done = draft.autoDraftToEnd(started, ctx)
    expect(done.draftRoom!.pendingOffers).toEqual([])
  })
})

describe('UDFA phase', () => {
  let ctx: EngineContext
  let drafted: LeagueState

  beforeAll(async () => {
    ctx = await draftContext()
    drafted = draft.autoDraftToEnd(draft.startDraft(stateAtDraft(ctx, 'IND'), ctx), ctx)
  })

  it('signs the pool, clears the room, and free-agents the leftovers', () => {
    const room = drafted.draftRoom!
    const unsigned = new Set([...room.udfaPool, ...room.available])
    const after = draft.runUdfa(drafted, ctx, [])

    expect(after.draftRoom).toBeNull()
    const freeAgents = new Set(after.freeAgents)
    const rostered = new Set<string>()
    for (const teamId of TEAM_IDS) {
      const roster = after.teams[teamId]!.roster
      expect(roster.length, teamId).toBeLessThanOrEqual(90)
      for (const slot of roster) rostered.add(slot.playerId)
    }
    for (const id of unsigned) {
      expect(rostered.has(id) || freeAgents.has(id), `${id} vanished`).toBe(true)
      if (rostered.has(id)) expect(freeAgents.has(id), `${id} is rostered and a free agent`).toBe(false)
    }
    // Most real UDFAs land back on the team that really signed them.
    const anchored = [...unsigned].filter((id) => {
      const real = ctx.seasonData(CLASS_SEASON)!.players.players.find((p) => p.id === id)?.team
      if (!real) return false
      return after.teams[real]!.roster.some((s) => s.playerId === id)
    })
    expect(anchored.length).toBeGreaterThan(50)
  })

  it('applies the user signings first and marks them diverged', () => {
    const wanted = drafted.draftRoom!.udfaPool[0]!
    const after = draft.runUdfa(drafted, ctx, [wanted])
    expect(after.teams['IND']!.roster.some((s) => s.playerId === wanted)).toBe(true)
    expect(after.divergence.has(wanted)).toBe(true)
    expect(() => draft.runUdfa(after, ctx, [wanted])).not.toThrow() // room is null → no-op
  })

  it('is deterministic', () => {
    expect(draft.runUdfa(drafted, ctx, []).teams).toEqual(draft.runUdfa(drafted, ctx, []).teams)
  })
})

describe('generated order (post-history)', () => {
  it('is 7 × 32 in reverse-standings order once the pick numbers settle', async () => {
    const ctx = await draftContext()
    const base = stateAtDraft(ctx, 'IND')
    const standings = TEAM_IDS.map((teamId, i) => ({
      teamId,
      wins: i, losses: 16 - i, ties: 0,
      pct: i / 16,
      pointsFor: 300, pointsAgainst: 300,
      divRank: 1 as const,
      confRank: 1 as const,
      clinched: i >= 20 ? ('DIV' as const) : null,
    }))
    const summary: SeasonSummary = {
      season: 2025,
      champion: TEAM_IDS[31]!,
      runnerUp: TEAM_IDS[30]!,
      standings,
      awards: [],
      userTeam: 'IND',
      userRecord: { wins: 8, losses: 8, ties: 0, pointsFor: 300, pointsAgainst: 300 },
      userPlayoffExit: 'MISSED',
    }
    const state: LeagueState = { ...base, history: [summary] }

    const picks = draft.buildDraftOrder(state, 2030, ctx)
    expect(picks).toHaveLength(7 * 32)
    expect(picks.every((p) => p.pick === null)).toBe(true)

    const settled = settleOrder(picks, state)
    expect(settled.map((p) => p.pick)).toEqual(Array.from({ length: 224 }, (_, i) => i + 1))
    expect(settled[0]!.originalTeam).toBe(TEAM_IDS[0]) // worst record picks first
    expect(settled[31]!.originalTeam).toBe(TEAM_IDS[31]) // champion picks last in round 1
    expect(settled[32]!.originalTeam).toBe(TEAM_IDS[0])
  })
})
