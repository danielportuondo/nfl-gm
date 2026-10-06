/**
 * QA M4/M5: in the offseason the cap gate measures next season's cap against the deals still on the books
 * when it starts (expiring contracts and dead money are gone at the camp rollover). In season nothing
 * changes. A refused offer says why instead of reading as "the player passed", and an ask the screen
 * rounds up is always accepted.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Contract, EngineContext, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { capGate } from '@engine/fa'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017
const USER: TeamId = 'MIA'
const ROOM_NEXT = 30
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

const deal = (apy: number, years = 2): Contract => ({
  years,
  apy,
  guaranteedPct: 0.5,
  signedSeason: START,
  rookie: false,
})

describe('offseason cap gate', () => {
  let ctx: EngineContext
  let base: LeagueState
  let expiring: PlayerId[]

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    const { league, fa } = ctx.modules
    const s0 = league.newGame(
      {
        seed: 'offseason-cap',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 3,
        settings: SETTINGS,
        startAt: 'PRESEASON',
      },
      ctx,
    )
    const team = s0.teams[USER]!
    const asked = [...team.roster]
      .filter((r) => (s0.scouting[r.playerId]?.ovr ?? 0) >= 60 && r.contract.years > 1)
      .map((r) => ({
        id: r.playerId,
        ask: fa.resignAsk({ ...s0, phase: 'OFFSEASON_RESIGN' }, r.playerId, ctx),
      }))
      .sort((a, b) => a.ask - b.ask || a.id.localeCompare(b.id))
    expiring = asked.slice(0, 4).map((a) => a.id)
    expect(asked.slice(0, 4).reduce((sum, a) => sum + a.ask, 0)).toBeLessThan(ROOM_NEXT)

    // Four expiring deals at $4M, everyone else scaled so next season's books leave exactly ROOM_NEXT
    // of room, and dead money tops this season's payroll up to $0.4M under this season's cap.
    const capNow = fa.capFor(START, ctx)
    const capNext = fa.capFor(START + 1, ctx)
    const others = team.roster.filter((r) => !expiring.includes(r.playerId))
    const othersSum = others.reduce((sum, r) => sum + r.contract.apy, 0)
    const scale = (capNext - ROOM_NEXT) / othersSum
    const roster = team.roster.map((r) =>
      expiring.includes(r.playerId)
        ? { ...r, contract: { ...r.contract, apy: 4, years: 1, signedSeason: START - 1 } }
        : {
            ...r,
            contract: {
              ...r.contract,
              apy: r.contract.apy * scale,
              years: Math.max(2, r.contract.years),
            },
          },
    )
    const committed = capNext - ROOM_NEXT
    const deadMoney = capNow - 0.4 - committed - 16
    expect(deadMoney).toBeGreaterThan(0)
    base = { ...s0, teams: { ...s0.teams, [USER]: { ...team, roster, deadMoney } } }
  }, 120000)

  const resignPhase = (): LeagueState => ({ ...base, phase: 'OFFSEASON_RESIGN', week: 0 })

  it('this season looks full while next season has room', () => {
    const { fa } = ctx.modules
    const s = resignPhase()
    expect(fa.capFor(START, ctx) - fa.payroll(s, USER)).toBeCloseTo(0.4, 1)
    const gate = capGate(s, USER, ctx)
    expect(gate.cap).toBeCloseTo(fa.capFor(START + 1, ctx), 5)
    expect(gate.space).toBeCloseTo(ROOM_NEXT, 1)
  })

  it('re-signs every expiring player at his ask, because next season has the room', () => {
    const { fa } = ctx.modules
    let s = resignPhase()
    for (const id of expiring) {
      const ask = fa.resignAsk(s, id, ctx)
      s = fa.resign(s, id, deal(ask), ctx)
    }
    const asks = expiring.reduce((sum, id) => sum + fa.resignAsk(resignPhase(), id, ctx), 0)
    expect(capGate(s, USER, ctx).space).toBeCloseTo(ROOM_NEXT - asks, 1)
  })

  it('refuses a re-sign that truly exceeds next season, and says so', () => {
    const { fa } = ctx.modules
    const s = resignPhase()
    const id = expiring[0]!
    const tooBig = ROOM_NEXT + 2
    expect(() => fa.resign(s, id, deal(tooBig), ctx)).toThrow(
      /Not enough cap room next season: need \$32\.0M, have \$30\.0M/,
    )
  })

  it('an offer fits against next season, and a cap-blocked one returns the reason', () => {
    const { fa, rng } = ctx.modules
    const s = { ...resignPhase(), phase: 'FREE_AGENCY' as const }
    const target = fa.freeAgentPool(s).find((id) => (s.scouting[id]?.ovr ?? 0) < 60)!
    const ask = fa.resignAsk(s, target, ctx)
    let signed = false
    for (let i = 0; i < 6 && !signed; i++) {
      const r = fa.offer(
        s,
        USER,
        target,
        deal(Math.max(ask * 3, 1)),
        ctx,
        rng.fromSeed(s.seed, i, 'fit'),
      )
      expect(r.reason).toBeUndefined()
      signed = r.accepted
    }
    expect(signed).toBe(true)

    const blocked = fa.offer(
      s,
      USER,
      target,
      deal(ROOM_NEXT + 5),
      ctx,
      rng.fromSeed(s.seed, 0, 'cap'),
    )
    expect(blocked.accepted).toBe(false)
    expect(blocked.reason).toBe('Not enough cap room next season: need $35.0M, have $30.0M')
    expect(blocked.state).toBe(s)
  })

  it('in season the gate is unchanged: this season cap against full payroll', () => {
    const { fa, rng } = ctx.modules
    // One slot short of a full roster, so only the cap can refuse: the dropped $4M expiring deal leaves $4.4M.
    const team = base.teams[USER]!
    const roster = team.roster.filter((r) => r.playerId !== expiring[0])
    const s: LeagueState = {
      ...base,
      phase: 'REGULAR',
      week: 1,
      teams: { ...base.teams, [USER]: { ...team, roster } },
    }
    const gate = capGate(s, USER, ctx)
    expect(gate.cap).toBeCloseTo(fa.capFor(START, ctx), 5)
    expect(gate.space).toBeCloseTo(4.4, 1)
    const target = fa.freeAgentPool(s)[0]!
    const r = fa.offer(s, USER, target, deal(5), ctx, rng.fromSeed(s.seed, 0, 'inseason'))
    expect(r.accepted).toBe(false)
    expect(r.reason).toBe('Not enough cap room: need $5.0M, have $4.4M')
  })

  it('in season a full roster is its own reason', () => {
    const { fa, rng } = ctx.modules
    const team = base.teams[USER]!
    const filler = team.roster[0]!
    const full = [...team.roster]
    while (full.length < 53) full.push({ ...filler, contract: { ...filler.contract, apy: 0 } })
    const s: LeagueState = {
      ...base,
      phase: 'REGULAR',
      week: 1,
      teams: { ...base.teams, [USER]: { ...team, roster: full, deadMoney: 0 } },
    }
    const target = fa.freeAgentPool(s)[0]!
    const r = fa.offer(s, USER, target, deal(0.6), ctx, rng.fromSeed(s.seed, 0, 'full'))
    expect(r.accepted).toBe(false)
    expect(r.reason).toBe('Your roster is full (53 players). Release someone first.')
  })

  it('accepts a re-sign within $0.05M under the ask, refuses anything further under', () => {
    const { fa } = ctx.modules
    const s = resignPhase()
    const id = expiring[0]!
    const ask = fa.resignAsk(s, id, ctx)
    expect(() => fa.resign(s, id, deal(Math.round((ask - 0.04) * 100) / 100), ctx)).not.toThrow()
    expect(() => fa.resign(s, id, deal(Math.round((ask - 0.06) * 100) / 100), ctx)).toThrow(
      /below the ask/,
    )
  })
})
