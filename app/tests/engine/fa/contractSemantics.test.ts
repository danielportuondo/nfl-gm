/**
 * Contract `years` means "seasons the player will actually play under this deal" (QA H2: a 1-year
 * free-agent deal never played, a 7-year re-sign showed 6 at camp, later-draft rookies got 3 seasons).
 * Real engine on real 2017 data. A deal made after a season closed is stamped signedSeason = the season
 * it starts, and the camp rollover leaves it alone; the opening offseason never ticks.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  TEAM_IDS,
  type Contract,
  type EngineContext,
  type LeagueState,
  type Phase,
  type PlayerId,
  type TeamId,
} from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { emptyLog, userDraft, userFreeAgency } from '../../../scripts/lib/scriptedGm'

const START = 2017
const USER: TeamId = 'MIA'
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

function yearsOn(s: LeagueState, id: PlayerId): number | undefined {
  for (const t of TEAM_IDS) {
    const slot = s.teams[t]!.roster.find((r) => r.playerId === id)
    if (slot) return slot.contract.years
  }
  return undefined
}

describe('contract years = seasons actually played', () => {
  let ctx: EngineContext

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
  }, 60000)

  const userDeal = (apy: number, years: number): Contract => ({
    years,
    apy,
    guaranteedPct: 0.5,
    signedSeason: START,
    rookie: false,
  })

  /** The opening MIA roster sits over the cap; halve its salaries so a minimum deal fits. */
  const withCapRoom = (s: LeagueState): LeagueState => {
    if (ctx.modules.fa.capSpace(s, USER, ctx) > 3) return s
    const team = s.teams[USER]!
    const roster = team.roster.map((r) => ({
      ...r,
      contract: { ...r.contract, apy: r.contract.apy / 2 },
    }))
    return { ...s, teams: { ...s.teams, [USER]: { ...team, deadMoney: 0, roster } } }
  }

  function signCheapFreeAgent(
    s: LeagueState,
    skip: Set<PlayerId>,
    years: number,
  ): [LeagueState, PlayerId] {
    const { fa, rng } = ctx.modules
    s = withCapRoom(s)
    // Real players absent from next season's data retire at the rollover; keep the ones who stay.
    const stays = new Set(ctx.seasonData(START + 1)!.players.players.map((p) => p.id))
    const pool = fa
      .freeAgentPool(s)
      .filter((id) => !skip.has(id) && (s.scouting[id]?.ovr ?? 0) < 52 && stays.has(id))
      .reverse()
    for (const id of pool) {
      const ask = fa.resignAsk(s, id, ctx)
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = fa.offer(
          s,
          USER,
          id,
          userDeal(Math.max(ask * 2, 0.6), years),
          ctx,
          rng.fromSeed(s.seed, 1, id, attempt),
        )
        if (r.accepted) return [r.state, id]
      }
    }
    throw new Error(
      `no free agent accepted: pool ${pool.length}, payroll ${fa.payroll(s, USER)}, cap ${fa.capFor(s.season, ctx)}, size ${s.teams[USER]!.roster.length}`,
    )
  }

  it('after the opening offseason a 1-year deal plays one season and a drafted rookie four', () => {
    const { league, draft, fa } = ctx.modules
    const log = emptyLog()
    let s = league.newGame(
      {
        seed: 'years-open',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 3,
        settings: SETTINGS,
      },
      ctx,
    )
    s = draft.startDraft(s, ctx)
    s = userDraft(s, ctx, log)
    s = league.advancePhase(s, ctx) // DRAFT -> UDFA
    s = league.advancePhase(s, ctx) // UDFA -> FREE_AGENCY
    s = userFreeAgency(s, ctx, log)
    const [afterSigning, signed] = signCheapFreeAgent(s, new Set(), 1)
    s = afterSigning
    s = league.advancePhase(s, ctx) // -> TRAINING_CAMP
    s = league.advancePhase(s, ctx) // -> PRESEASON (opening rollover: no tick)
    expect(yearsOn(s, signed)).toBe(1)
    const rookie = log.drafted[0]!.playerId
    expect(yearsOn(s, rookie)).toBe(4)
    const next = fa.rolloverContracts({ ...s, season: START + 1 }, ctx)
    expect(yearsOn(next.state, signed)).toBeUndefined()
    expect(yearsOn(next.state, rookie)).toBe(3)
  }, 120000)

  it('a deal made in any later offseason phase plays exactly its length', () => {
    const { league, draft, fa } = ctx.modules
    const log = emptyLog()
    let s = league.newGame(
      {
        seed: 'years-later',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 4,
        settings: SETTINGS,
        startAt: 'PRESEASON',
      },
      ctx,
    )
    const phases: Phase[] = ['OFFSEASON_RESIGN', 'DRAFT', 'UDFA', 'FREE_AGENCY', 'TRAINING_CAMP']
    s = { ...s, phase: 'OFFSEASON_RESIGN', week: 0 }

    // An expiring player re-signed for 3 years.
    const stays = new Set(ctx.seasonData(START + 1)!.players.players.map((p) => p.id))
    const expiring = s.teams[USER]!.roster.find(
      (r) => r.contract.years > 1 && stays.has(r.playerId),
    )!
    const target = expiring.playerId
    s = {
      ...s,
      teams: {
        ...s.teams,
        [USER]: {
          ...s.teams[USER]!,
          roster: s.teams[USER]!.roster.map((r) =>
            r.playerId === target
              ? { ...r, contract: { ...r.contract, years: 1, signedSeason: START - 1 } }
              : r,
          ),
        },
      },
    }
    const ask = fa.resignAsk(s, target, ctx)
    s = fa.resign(s, target, userDeal(ask, 3), ctx)

    const oneYear: PlayerId[] = []
    const skip = new Set<PlayerId>()
    for (const phase of phases) {
      if (s.phase !== phase) throw new Error(`expected ${phase}, at ${s.phase}`)
      if (phase === 'DRAFT') {
        s = draft.startDraft(s, ctx)
        s = userDraft(s, ctx, log)
      }
      let id: PlayerId
      ;[s, id] = signCheapFreeAgent(s, skip, 1)
      skip.add(id)
      oneYear.push(id)
      s = league.advancePhase(s, ctx)
    }
    expect(s.phase).toBe('PRESEASON')
    expect(s.season).toBe(START + 1)

    for (const id of oneYear) expect(yearsOn(s, id)).toBe(1)
    expect(yearsOn(s, target)).toBe(3)
    expect(log.drafted.length).toBeGreaterThan(0)
    for (const d of log.drafted) expect(yearsOn(s, d.playerId)).toBe(4)
    const aiRookie = Object.values(s.players).find(
      (p) =>
        p.draft?.season === START + 1 &&
        TEAM_IDS.some(
          (t) =>
            t !== USER && s.teams[t]!.roster.some((r) => r.playerId === p.id && r.contract.rookie),
        ),
    )!
    expect(yearsOn(s, aiRookie.id)).toBe(4)

    // One season later the 1-year deals are gone; the 3-year re-sign has played 1 of 3.
    let later = fa.rolloverContracts({ ...s, season: START + 2 }, ctx).state
    for (const id of oneYear) expect(yearsOn(later, id)).toBeUndefined()
    expect(yearsOn(later, target)).toBe(2)
    later = fa.rolloverContracts({ ...later, season: START + 3 }, ctx).state
    expect(yearsOn(later, target)).toBe(1)
    later = fa.rolloverContracts({ ...later, season: START + 4 }, ctx).state
    expect(yearsOn(later, target)).toBeUndefined()
  }, 180000)
})
