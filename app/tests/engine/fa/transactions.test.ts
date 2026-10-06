/**
 * fa-cap's slice of the user's move history (fa-cap brief, TransactionSchema in contracts/schemas.ts).
 * fa.resign/fa.offer/fa.release log the user's own moves only; every AI path (runAiResign,
 * runAiFreeAgency, runAiCutdowns) and a declined offer must never touch state.transactions.
 */
import { describe, expect, it } from 'vitest'
import type { LeagueState, Rng } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { fa } from '@engine/fa'
import { makeFakeContext } from '../fakes'

function ctxFor(season = 2015) {
  return makeFakeContext(mockBundle({ season }), { fa })
}

function newGame(overrides: Partial<Parameters<typeof league.newGame>[0]> = {}, ctx = ctxFor()) {
  return league.newGame(
    {
      seed: 'tx-seed',
      startSeason: 2015,
      userTeam: 'IND',
      horizonSeasons: 6,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      startAt: 'PRESEASON',
      ...overrides,
    },
    ctx,
  )
}

/** Always accepts / always declines, so fa.offer's own logging logic is what's under test, not odds. */
function fixedRng(accepts: boolean): Rng {
  const self: Rng = {
    next: () => 0.5,
    int: (min) => min,
    normal: (mean) => mean,
    chance: () => accepts,
    pick: (items) => items[0]!,
    shuffle: (items) => [...items],
    fork: () => self,
  }
  return self
}

describe('fa.resign', () => {
  it('appends one RESIGN transaction with the stored contract and the pre-move consensus ovr', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const teamId = base.userTeam
    const slot = base.teams[teamId]!.roster.find((r) => !r.contract.rookie)!
    const state: LeagueState = {
      ...base,
      phase: 'OFFSEASON_RESIGN',
      teams: {
        ...base.teams,
        [teamId]: {
          ...base.teams[teamId]!,
          roster: base.teams[teamId]!.roster.map((r) =>
            r.playerId === slot.playerId ? { ...r, contract: { ...r.contract, years: 1 } } : r,
          ),
        },
      },
    }
    const ask = fa.resignAsk(state, slot.playerId, ctx)
    const contract = {
      years: 3,
      apy: ask,
      guaranteedPct: 0.5,
      signedSeason: state.season,
      rookie: false,
    }

    const next = fa.resign(state, slot.playerId, contract, ctx)

    expect(next.transactions).toHaveLength(state.transactions.length + 1)
    const entry = next.transactions.at(-1)!
    expect(entry.kind).toBe('RESIGN')
    expect(entry).toMatchObject({
      season: state.season,
      phase: state.phase,
      week: state.week,
      playerId: slot.playerId,
      // An offseason re-sign is stamped with the season it starts.
      contract: { ...contract, signedSeason: state.season + 1 },
    })
    expect(entry.ovrAtMove).toEqual({ [slot.playerId]: state.scouting[slot.playerId]!.ovr })
    // input state is never mutated
    expect(state.transactions).toHaveLength(0)
  })
})

describe('fa.offer', () => {
  it('an accepted offer by the user team appends one SIGN transaction', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const teamId = base.userTeam
    const playerId = base.freeAgents[0]!
    const state: LeagueState = {
      ...base,
      teams: { ...base.teams, [teamId]: { ...base.teams[teamId]!, roster: [], deadMoney: 0 } },
    }
    const contract = {
      years: 2,
      apy: 1,
      guaranteedPct: 0.4,
      signedSeason: state.season,
      rookie: false,
    }

    const result = fa.offer(state, teamId, playerId, contract, ctx, fixedRng(true))

    expect(result.accepted).toBe(true)
    expect(result.state.transactions).toHaveLength(state.transactions.length + 1)
    const entry = result.state.transactions.at(-1)!
    expect(entry.kind).toBe('SIGN')
    expect(entry).toMatchObject({ playerId, contract })
    expect(state.transactions).toHaveLength(0)
  })

  it('a declined offer logs nothing', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const teamId = base.userTeam
    const playerId = base.freeAgents[0]!
    const state: LeagueState = {
      ...base,
      teams: { ...base.teams, [teamId]: { ...base.teams[teamId]!, roster: [], deadMoney: 0 } },
    }
    const contract = {
      years: 2,
      apy: 1,
      guaranteedPct: 0.4,
      signedSeason: state.season,
      rookie: false,
    }

    const result = fa.offer(state, teamId, playerId, contract, ctx, fixedRng(false))

    expect(result.accepted).toBe(false)
    expect(result.state.transactions).toHaveLength(0)
  })

  it('an accepted AI-team offer logs nothing', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const teamId = 'DAL'
    expect(teamId).not.toBe(base.userTeam)
    const playerId = base.freeAgents[0]!
    const state: LeagueState = {
      ...base,
      teams: { ...base.teams, [teamId]: { ...base.teams[teamId]!, roster: [], deadMoney: 0 } },
    }
    const contract = {
      years: 2,
      apy: 1,
      guaranteedPct: 0.4,
      signedSeason: state.season,
      rookie: false,
    }

    const result = fa.offer(state, teamId, playerId, contract, ctx, fixedRng(true))

    expect(result.accepted).toBe(true)
    expect(result.state.transactions).toHaveLength(0)
  })
})

describe('fa.release', () => {
  it('a user-team release appends one RELEASE transaction whose deadMoney matches the cap charge', () => {
    const ctx = ctxFor()
    const state = newGame({}, ctx)
    const teamId = state.userTeam
    const slot = state.teams[teamId]!.roster[0]!

    const next = fa.release(state, teamId, slot.playerId, ctx)

    expect(next.transactions).toHaveLength(state.transactions.length + 1)
    const entry = next.transactions.at(-1)!
    expect(entry.kind).toBe('RELEASE')
    expect(entry).toMatchObject({ playerId: slot.playerId })
    if (entry.kind === 'RELEASE') {
      expect(entry.deadMoney).toBeCloseTo(next.teams[teamId]!.deadMoney, 6)
    }
    expect(state.transactions).toHaveLength(0)
  })

  it('an AI-team release logs nothing', () => {
    const ctx = ctxFor()
    const state = newGame({}, ctx)
    const teamId = 'DAL'
    expect(teamId).not.toBe(state.userTeam)
    const slot = state.teams[teamId]!.roster[0]!

    const next = fa.release(state, teamId, slot.playerId, ctx)

    expect(next.transactions).toHaveLength(0)
  })
})

describe('AI paths never log user transactions', () => {
  it('runAiResign logs nothing', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    // AI upkeep only ever touches non-user teams, but confirm no entries appear regardless.
    const rng = ctx.modules.rng.fromSeed(base.seed, base.season, 'ai-resign-test')
    const next = fa.runAiResign(base, ctx, rng)
    expect(next.transactions).toHaveLength(0)
  })

  it('runAiFreeAgency logs nothing', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const rng = ctx.modules.rng.fromSeed(base.seed, base.season, 'ai-fa-test')
    const next = fa.runAiFreeAgency(base, ctx, rng)
    expect(next.transactions).toHaveLength(0)
  })

  it('runAiCutdowns logs nothing', () => {
    const ctx = ctxFor()
    const base = newGame({}, ctx)
    const next = fa.runAiCutdowns(base, ctx)
    expect(next.transactions).toHaveLength(0)
  })
})
