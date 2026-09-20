/**
 * fa.suggestCutdown acceptance tests (contracts/engine/fa.ts doc comment; docs/DECISIONS.md
 * 2026-09-20). Pure suggestion: size to the roster limit by lowest consensus ovr, then cap by most net
 * savings per rating point above 40 — never touching truth or history, never mutating input state.
 */
import { describe, expect, it } from 'vitest'
import type { LeagueState, PlayerId, RosterSlot, TeamId } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { fa } from '@engine/fa'
import { makeFakeContext } from '../fakes'

function ctxFor(season = 2015) {
  return makeFakeContext(mockBundle({ season }), { fa })
}

function newState(season = 2015) {
  const ctx = ctxFor(season)
  const state = league.newGame(
    {
      seed: 'cutdown-seed',
      startSeason: season,
      userTeam: 'IND' as TeamId,
      horizonSeasons: 3,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
      startAt: 'PRESEASON',
    },
    ctx,
  )
  return { ctx, state }
}

/** Flattens every IND contract to a known cheap value so payroll never interferes with a size-only test. */
function flattenPayroll(state: LeagueState, teamId: TeamId, apy: number): LeagueState {
  const team = state.teams[teamId]!
  const roster = team.roster.map((r) => ({
    ...r,
    contract: { ...r.contract, apy, years: 2, guaranteedPct: 0.5 },
  }))
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster, deadMoney: 0 } } }
}

function setOvr(state: LeagueState, playerId: PlayerId, ovr: number): LeagueState {
  return {
    ...state,
    scouting: { ...state.scouting, [playerId]: { ...state.scouting[playerId]!, ovr } },
  }
}

/** Bumps every existing roster member's ovr to a uniform safe value, removing ordering ambiguity. */
function levelOvr(state: LeagueState, teamId: TeamId, ovr: number): LeagueState {
  let s = state
  for (const slot of state.teams[teamId]!.roster) s = setOvr(s, slot.playerId, ovr)
  return s
}

function addExtras(
  state: LeagueState,
  teamId: TeamId,
  season: number,
  count: number,
  startOvr: number,
): { state: LeagueState; extraIds: PlayerId[] } {
  const extraIds = state.freeAgents.slice(0, count)
  let s = state
  const team = s.teams[teamId]!
  const added: RosterSlot[] = extraIds.map((playerId, i) => {
    s = setOvr(s, playerId, startOvr + i)
    return {
      playerId,
      teamId,
      contract: { years: 1, apy: 0.5, guaranteedPct: 0.1, signedSeason: season, rookie: false },
    }
  })
  s = {
    ...s,
    teams: { ...s.teams, [teamId]: { ...team, roster: [...team.roster, ...added] } },
    freeAgents: s.freeAgents.filter((id) => !extraIds.includes(id)),
  }
  return { state: s, extraIds }
}

describe('fa.suggestCutdown: size stage', () => {
  it('cuts the lowest-ovr eligible players down to the roster max, never dropping a position below STARTER_TEMPLATE', () => {
    const { ctx, state: base } = newState()
    let state = flattenPayroll(base, 'IND', 1)
    state = levelOvr(state, 'IND', 60)
    const { state: inflated, extraIds } = addExtras(state, 'IND', 2015, 10, 41)
    expect(inflated.teams.IND!.roster.length).toBe(63)

    const plan = fa.suggestCutdown(inflated, 'IND', ctx)

    expect(plan.cuts).toHaveLength(10)
    expect(plan.cuts.every((c) => c.reason === 'size')).toBe(true)
    expect(new Set(plan.cuts.map((c) => c.playerId))).toEqual(new Set(extraIds))
    expect(plan.sizeAfter).toBe(53)
    expect(plan.ok).toBe(true)
    const totalDeadMoney = plan.cuts.reduce((sum, c) => sum + c.deadMoney, 0)
    expect(plan.payrollAfter).toBeCloseTo(fa.payroll(state, 'IND') + totalDeadMoney, 6)

    // Restoring exactly the pre-inflation roster proves no position dropped below its starter minimum
    // (the original 53-man roster already satisfies STARTER_TEMPLATE).
    const remaining = new Set(
      state.teams.IND!.roster.map((r) => r.playerId).filter((id) => !extraIds.includes(id)),
    )
    const afterIds = new Set(
      inflated.teams
        .IND!.roster.map((r) => r.playerId)
        .filter((id) => !plan.cuts.some((c) => c.playerId === id)),
    )
    expect(afterIds).toEqual(remaining)
  })
})

describe('fa.suggestCutdown: cap stage', () => {
  function overCapScenario(base: LeagueState) {
    let state = flattenPayroll(base, 'IND', 1)
    state = levelOvr(state, 'IND', 70)
    const roster = state.teams.IND!.roster
    // Star is a WR (template 6, starter min 3); the two cheap cuts are OL (template 9, starter min
    // 5) — different positions so cutting the cheap pair never strands the star as its position's
    // last-above-STARTER_TEMPLATE player.
    const starId = roster[7]!.playerId
    const cheapIds = [roster[16]!.playerId, roster[17]!.playerId]
    state = setOvr(state, starId, 90)
    state = setOvr(state, cheapIds[0]!, 41)
    state = setOvr(state, cheapIds[1]!, 41)
    const withContract = (s: LeagueState, id: PlayerId, apy: number): LeagueState => {
      const team = s.teams.IND!
      const r = team.roster.map((slot) =>
        slot.playerId === id ? { ...slot, contract: { ...slot.contract, apy } } : slot,
      )
      return { ...s, teams: { ...s.teams, IND: { ...team, roster: r } } }
    }
    state = withContract(state, starId, 100)
    state = withContract(state, cheapIds[0]!, 5)
    state = withContract(state, cheapIds[1]!, 5)
    return { state, starId, cheapIds }
  }

  it('prefers savings per rating point over the single most expensive player', () => {
    const { ctx, state: base } = newState()
    const { state, starId } = overCapScenario(base)
    expect(state.teams.IND!.roster.length).toBe(53) // legal size, only the cap is broken
    const cap = fa.capFor(state.season, ctx)
    expect(fa.payroll(state, 'IND')).toBeGreaterThan(cap)

    const plan = fa.suggestCutdown(state, 'IND', ctx)

    expect(plan.cuts.length).toBeGreaterThan(0)
    expect(plan.cuts.every((c) => c.reason === 'cap')).toBe(true)
    expect(plan.cuts[0]!.playerId).not.toBe(starId)
    expect(plan.payrollAfter).toBeLessThanOrEqual(cap + 1e-6)
    expect(plan.ok).toBe(true)
  })
})

describe('fa.suggestCutdown: protect', () => {
  it('never suggests a protected player; the next-lowest eligible player takes its place', () => {
    const { ctx, state: base } = newState()
    let state = flattenPayroll(base, 'IND', 1)
    state = levelOvr(state, 'IND', 60)
    const nextLowestId = state.teams.IND!.roster[0]!.playerId
    state = setOvr(state, nextLowestId, 55) // uniquely next-lowest once the extras are exhausted
    const { state: inflated, extraIds } = addExtras(state, 'IND', 2015, 10, 41)
    const protectedId = extraIds[0]! // ovr 41, the lowest of the pack

    const withoutProtect = fa.suggestCutdown(inflated, 'IND', ctx)
    expect(withoutProtect.cuts.map((c) => c.playerId)).toContain(protectedId)

    const withProtect = fa.suggestCutdown(inflated, 'IND', ctx, [protectedId])
    expect(withProtect.cuts).toHaveLength(10)
    expect(withProtect.cuts.map((c) => c.playerId)).not.toContain(protectedId)
    expect(withProtect.cuts.map((c) => c.playerId)).toContain(nextLowestId)
    expect(withProtect.sizeAfter).toBe(53)
  })
})

describe('fa.suggestCutdown: floor', () => {
  it('reports not-ok when the cap cannot be reached by the roster floor', () => {
    const { ctx, state: base } = newState()
    let state = flattenPayroll(base, 'IND', 50)
    state = { ...state, teams: { ...state.teams, IND: { ...state.teams.IND!, deadMoney: 0 } } }
    // guaranteedPct 0 -> zero dead money on release, so every cut is pure savings and the loop only
    // stops at the roster floor, not because savings ran out.
    const roster = state.teams.IND!.roster.map((r) => ({
      ...r,
      contract: { ...r.contract, guaranteedPct: 0 },
    }))
    state = { ...state, teams: { ...state.teams, IND: { ...state.teams.IND!, roster } } }
    const cap = fa.capFor(state.season, ctx)
    expect(fa.payroll(state, 'IND')).toBeGreaterThan(cap)

    const plan = fa.suggestCutdown(state, 'IND', ctx)

    expect(plan.ok).toBe(false)
    expect(plan.sizeAfter).toBe(46)
    expect(plan.payrollAfter).toBeGreaterThan(cap)
  })
})

describe('fa.suggestCutdown: parity with fa.release', () => {
  it('matches sizeAfter/payrollAfter when releases are applied in order, and never mutates the input state', () => {
    const { ctx, state: base } = newState()
    let state = flattenPayroll(base, 'IND', 1)
    state = levelOvr(state, 'IND', 60)
    const { state: inflated } = addExtras(state, 'IND', 2015, 6, 41)
    const snapshot = structuredClone(inflated)

    const plan = fa.suggestCutdown(inflated, 'IND', ctx)
    expect(plan.cuts.length).toBeGreaterThan(0)

    let replayed = inflated
    for (const cut of plan.cuts) replayed = fa.release(replayed, 'IND', cut.playerId, ctx)

    expect(replayed.teams.IND!.roster.length).toBe(plan.sizeAfter)
    expect(fa.payroll(replayed, 'IND')).toBeCloseTo(plan.payrollAfter, 6)
    expect(inflated).toEqual(snapshot)
  })
})
