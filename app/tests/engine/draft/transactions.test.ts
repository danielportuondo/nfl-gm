/**
 * The user's move log: every pick the user's team makes (manual or auto) and every UDFA signing it
 * actually lands appends exactly one Transaction; AI moves append nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, Transaction } from '@contracts/index'
import { draft } from '@engine/draft'
import { draftConstants } from '@engine/draft/constants'
import { runUdfaPhase } from '@engine/draft/udfa'
import { AARON_DONALD, draftContext, stateAtDraft } from './fixture'

const draftEntries = (state: LeagueState): Extract<Transaction, { kind: 'DRAFT' }>[] =>
  state.transactions.filter((t): t is Extract<Transaction, { kind: 'DRAFT' }> => t.kind === 'DRAFT')

describe('DRAFT transactions', () => {
  let ctx: EngineContext

  beforeAll(async () => {
    ctx = await draftContext()
  })

  it('logs one entry per user-owned pick, in overall order, when the user auto-drafts', () => {
    const started = draft.startDraft(stateAtDraft(ctx, 'IND'), ctx)
    const done = draft.autoDraftToEnd(started, ctx)
    const userSlots = done.draftRoom!.order.filter((slot) => slot.owner === 'IND')
    expect(userSlots.length).toBeGreaterThan(0)

    const entries = draftEntries(done)
    expect(done.transactions).toHaveLength(entries.length)
    expect(entries.map((t) => [t.round, t.pick, t.playerId])).toEqual(
      userSlots.map((slot) => [slot.round, slot.pick, slot.playerId]),
    )
    for (const t of entries) {
      expect(t.season).toBe(started.season)
      expect(t.phase).toBe('DRAFT')
      expect(t.week).toBe(started.week)
      expect(t.ovrAtMove).toEqual({ [t.playerId]: started.scouting[t.playerId]!.ovr })
    }
  })

  it('logs the same through advance({ auto: true }) as through autoDraftToEnd', () => {
    const started = draft.startDraft(stateAtDraft(ctx, 'IND'), ctx)
    const viaAdvance = draft.advance(started, ctx, { auto: true })
    expect(viaAdvance.transactions).toEqual(draft.autoDraftToEnd(started, ctx).transactions)
  })

  it('logs a manual pick once, and nothing for the AI picks that follow', () => {
    const started = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    expect(started.transactions).toEqual([])
    const firstSlot = started.draftRoom!.order[0]!
    expect(firstSlot.owner).toBe('HOU')

    const picked = draft.userPick(started, AARON_DONALD, ctx)
    expect(started.transactions).toEqual([])
    expect(picked.transactions).toEqual([
      {
        kind: 'DRAFT',
        season: started.season,
        phase: started.phase,
        week: started.week,
        playerId: AARON_DONALD,
        round: firstSlot.round,
        pick: 1,
        ovrAtMove: { [AARON_DONALD]: started.scouting[AARON_DONALD]!.ovr },
      },
    ])

    const nextClock = draft.advance(picked, ctx)
    const room = nextClock.draftRoom!
    expect(room.currentPickIndex).toBeGreaterThan(1)
    expect(room.order[room.currentPickIndex]!.owner).toBe('HOU')
    expect(nextClock.transactions).toEqual(picked.transactions)
  })
})

describe('UDFA transactions', () => {
  let ctx: EngineContext
  let drafted: LeagueState

  beforeAll(async () => {
    ctx = await draftContext()
    drafted = draft.autoDraftToEnd(draft.startDraft(stateAtDraft(ctx, 'IND'), ctx), ctx)
  })

  it('appends one UDFA entry per user signing, after the draft entries, and none for AI signings', () => {
    const [a, b] = drafted.draftRoom!.udfaPool
    const after = draft.runUdfa(drafted, ctx, [a!, b!])
    const added = after.transactions.slice(drafted.transactions.length)
    expect(after.transactions.slice(0, drafted.transactions.length)).toEqual(drafted.transactions)
    expect(added).toEqual(
      [a!, b!].map((id) => ({
        kind: 'UDFA',
        season: drafted.season,
        phase: drafted.phase,
        week: drafted.week,
        playerId: id,
        ovrAtMove: { [id]: drafted.scouting[id]!.ovr },
      })),
    )
    expect(draft.runUdfa(drafted, ctx, []).transactions).toEqual(drafted.transactions)
  })

  it('logs nothing for a signing skipped because the roster is full', () => {
    const [a, b] = drafted.draftRoom!.udfaPool
    const rosterMax = drafted.teams['IND']!.roster.length + 1
    const after = runUdfaPhase(drafted, ctx, [a!, b!], { ...draftConstants, rosterMax })
    const added = after.transactions.slice(drafted.transactions.length)
    expect(added.map((t) => (t.kind === 'UDFA' ? t.playerId : t.kind))).toEqual([a])
  })
})
