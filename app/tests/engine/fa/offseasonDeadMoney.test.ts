/**
 * QA 2018 H1: a release made after the Super Bowl belongs to the next league year. Its dead money must
 * survive the camp rollover (which only clears the season just played), so cutting in the offseason is
 * not free. An in-season release still clears at the next rollover.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Contract, EngineContext, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { capGate } from '@engine/fa'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const START = 2017
const USER: TeamId = 'MIA'
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

const bigDeal: Contract = {
  years: 4,
  apy: 8,
  guaranteedPct: 0.5,
  signedSeason: START - 1,
  rookie: false,
}
const expiringDeal: Contract = { ...bigDeal, years: 1 }

describe('offseason dead money', () => {
  let ctx: EngineContext
  let base: LeagueState
  let multiYear: PlayerId
  let expiring: PlayerId

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    const s0 = ctx.modules.league.newGame(
      {
        seed: 'offseason-dead-money',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 3,
        settings: SETTINGS,
        startAt: 'PRESEASON',
      },
      ctx,
    )
    const team = s0.teams[USER]!
    multiYear = team.roster[0]!.playerId
    expiring = team.roster[1]!.playerId
    const roster = team.roster.map((r) =>
      r.playerId === multiYear
        ? { ...r, contract: bigDeal }
        : r.playerId === expiring
          ? { ...r, contract: expiringDeal }
          : r,
    )
    base = { ...s0, teams: { ...s0.teams, [USER]: { ...team, roster, deadMoney: 0 } } }
  }, 120000)

  const inPhase = (phase: LeagueState['phase']): LeagueState => ({ ...base, phase })
  const roll = (s: LeagueState): LeagueState =>
    ctx.modules.fa.rolloverContracts({ ...s, season: s.season + 1, week: 0 }, ctx).state

  it('a camp release of a multi-year deal lands on next season and survives the roll', () => {
    const { fa } = ctx.modules
    const camp = inPhase('TRAINING_CAMP')
    const cut = fa.release(camp, USER, multiYear, ctx)
    const team = cut.teams[USER]!
    const charge = 8 * 3 * 0.5 * 0.25 // three seasons left once the closed season is not counted

    expect(team.deadMoney).toBe(0)
    expect(team.carriedDeadMoney).toBeCloseTo(charge, 2)
    expect(capGate(cut, USER, ctx).payroll - capGate(camp, USER, ctx).payroll).toBeCloseTo(
      charge - 8,
      2,
    )

    const next = roll(cut).teams[USER]!
    expect(next.deadMoney).toBeCloseTo(charge, 2)
    expect(next.carriedDeadMoney ?? 0).toBe(0)
  })

  it('releasing a deal that expires at the roll books nothing', () => {
    const cut = ctx.modules.fa.release(inPhase('OFFSEASON_RESIGN'), USER, expiring, ctx)
    expect(cut.teams[USER]!.carriedDeadMoney ?? 0).toBe(0)
    expect(cut.teams[USER]!.deadMoney).toBe(0)
  })

  it('an in-season release hits this season and clears at the next roll', () => {
    const { fa } = ctx.modules
    const cut = fa.release(inPhase('REGULAR'), USER, multiYear, ctx)
    const team = cut.teams[USER]!
    expect(team.deadMoney).toBeCloseTo(8 * 4 * 0.5 * 0.25, 2)
    expect(team.carriedDeadMoney ?? 0).toBe(0)
    expect(roll({ ...cut, phase: 'TRAINING_CAMP' }).teams[USER]!.deadMoney).toBe(0)
  })
})
