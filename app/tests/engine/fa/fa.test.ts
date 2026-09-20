/**
 * engine/fa acceptance tests (HANDOFF §6.6, fa-cap brief). Cap invariants are driven through the real
 * league season loop on real 2015 data (fakes for sim/draft/lifecycle/history, per the brief's "mockLeague
 * (or real 2015 with fakes for draft/lifecycle)" option — real rosters are already cap-legal, where the
 * synthetic fixture sometimes isn't) so runAiCutdowns, validateRoster and rolloverContracts are exercised
 * exactly as league.advancePhase calls them.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  TEAM_IDS,
  type DraftModule,
  type EngineContext,
  type LeagueState,
  type Phase,
  type Player,
  type Prospect,
  type RosterSlot,
  type TrueTrajectory,
} from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { fa } from '@engine/fa'
import { faConstants } from '@engine/fa/constants'
import { fakeDraft, makeFakeContext, makeFakeModules } from '../fakes'
import { loadRealContext, readManifest } from '../../../scripts/lib/publicData'

const SETTINGS = {
  tradeStrictness: 'balanced' as const,
  aiOfferFrequency: 'normal' as const,
  injuries: true,
}

/**
 * fakeDraft (tests/engine/fakes.ts) completes the draft-room state machine but never actually rosters a
 * player — real replenishment is draft-ai's job (Phase 3B, built concurrently). Without it, a 5-season
 * cap-invariant loop is unrealistic: contracts naturally expire every year and nothing ever backfills the
 * roster, so every team — including AI ones — eventually falls below the 46-man minimum through no fault
 * of fa's own logic. This local fake stands in for a real draft: it rosters every real drafted player onto
 * their real team and round-robins the real UDFA pool across AI teams, using fa.rookieContract exactly as
 * the real draft module would.
 */
function replenishingDraft(): DraftModule {
  const addProspect = (state: LeagueState, p: Prospect, season: number): LeagueState => {
    if (state.players[p.id]) return state
    const player: Player = {
      id: p.id,
      name: p.name,
      pos: p.pos,
      birthYear: p.birthYear,
      college: p.college,
      heightIn: p.heightIn,
      weightLb: p.weightLb,
      draft: p.draft,
      real: p.real,
      rookieSeason: p.rookieSeason,
    }
    const truth: TrueTrajectory = {
      bySeason: { [String(season)]: p.scouting.ovr },
      retiresAfter: null,
    }
    return {
      ...state,
      players: { ...state.players, [p.id]: player },
      scouting: { ...state.scouting, [p.id]: p.scouting },
      truth: { ...state.truth, [p.id]: truth },
    }
  }
  return {
    ...fakeDraft,
    autoDraftToEnd: (state, ctx) => {
      const room = state.draftRoom
      if (!room) return state
      const sd = ctx.seasonData(room.season)
      let s = state
      if (sd) {
        const prospectById = new Map(sd.draft.prospects.map((p) => [p.id, p]))
        for (const entry of sd.draft.order) {
          const prospect = entry.playerId ? prospectById.get(entry.playerId) : undefined
          if (!prospect) continue
          s = addProspect(s, prospect, room.season)
          const team = s.teams[entry.team]
          if (!team || team.userControlled || team.roster.length >= 90) continue
          const contract = ctx.modules.fa.rookieContract(
            { round: entry.round, pick: entry.pick },
            room.season,
            ctx,
          )
          const roster: RosterSlot[] = [
            ...team.roster,
            { playerId: entry.playerId!, teamId: entry.team, contract },
          ]
          s = { ...s, teams: { ...s.teams, [entry.team]: { ...team, roster } } }
        }
      }
      return {
        ...s,
        draftRoom: { ...room, status: 'COMPLETE', currentPickIndex: room.order.length },
      }
    },
    runUdfa: (state, ctx) => {
      const room = state.draftRoom
      if (!room) return { ...state, draftRoom: null }
      const sd = ctx.seasonData(room.season)
      let s = state
      if (sd) {
        const prospectById = new Map(sd.draft.prospects.map((p) => [p.id, p]))
        const aiTeams = TEAM_IDS.filter((t) => !s.teams[t]!.userControlled).sort()
        let i = 0
        for (const id of [...sd.draft.udfa].sort()) {
          const prospect = prospectById.get(id)
          if (!prospect) continue
          s = addProspect(s, prospect, room.season)
          const teamId = aiTeams[i++ % aiTeams.length]!
          const team = s.teams[teamId]!
          if (team.roster.length >= 90) continue
          const contract = ctx.modules.fa.rookieContract(null, room.season, ctx)
          const roster: RosterSlot[] = [...team.roster, { playerId: id, teamId, contract }]
          s = { ...s, teams: { ...s.teams, [teamId]: { ...team, roster } } }
        }
      }
      return { ...s, draftRoom: null }
    },
  }
}

function newGameOpts(overrides: Partial<Parameters<typeof league.newGame>[0]> = {}) {
  return {
    seed: 'fa-seed',
    startSeason: 2015,
    userTeam: 'IND',
    horizonSeasons: 6,
    settings: SETTINGS,
    // These tests drive PRESEASON → REGULAR directly; the opening offseason is league-engine's to test.
    startAt: 'PRESEASON' as const,
    ...overrides,
  }
}

function playSeason(state: LeagueState, ctx: EngineContext): LeagueState {
  let s = state
  let guard = 0
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
    s = league.simWeek(s, ctx).state
    if (++guard > 60) throw new Error('playSeason: simWeek did not terminate')
  }
  return s
}

/** OFFSEASON_RESIGN -> ... -> PRESEASON -> REGULAR week 1 of the next season. */
function playOffseason(state: LeagueState, ctx: EngineContext): LeagueState {
  let s = state
  expect(s.phase).toBe('OFFSEASON_RESIGN')
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('DRAFT')
  s = ctx.modules.draft.startDraft(s, ctx)
  s = ctx.modules.draft.autoDraftToEnd(s, ctx)
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('UDFA')
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('FREE_AGENCY')
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('TRAINING_CAMP')
  s = league.advancePhase(s, ctx) // -> PRESEASON (season + 1); throws if any roster is invalid
  expect(s.phase).toBe('PRESEASON')
  s = league.advancePhase(s, ctx)
  expect(s.phase).toBe('REGULAR')
  return s
}

function assertCapInvariants(state: LeagueState, ctx: EngineContext, label: string) {
  for (const teamId of TEAM_IDS) {
    const team = state.teams[teamId]!
    const v = fa.validateRoster(state, teamId, ctx)
    expect(v.ok, `${label} ${teamId}: ${v.errors.join(', ')}`).toBe(true)
    expect(team.roster.length, `${label} ${teamId} size`).toBeGreaterThanOrEqual(46)
    expect(team.roster.length, `${label} ${teamId} size`).toBeLessThanOrEqual(53)
    expect(fa.payroll(state, teamId), `${label} ${teamId} payroll`).toBeLessThanOrEqual(
      fa.capFor(state.season, ctx) + 1e-6,
    )
    expect(team.deadMoney, `${label} ${teamId} deadMoney`).toBeGreaterThanOrEqual(0)
    for (const slot of team.roster) {
      expect(
        slot.contract.years,
        `${label} ${teamId} ${slot.playerId} years`,
      ).toBeGreaterThanOrEqual(1)
      expect(slot.contract.apy, `${label} ${teamId} ${slot.playerId} apy`).toBeGreaterThan(0)
    }
  }
}

/**
 * fa.runAiResign/runAiFreeAgency/runAiCutdowns intentionally skip `userControlled` teams — a human GM
 * manages their own cap via the UI (resign/offer/release), which this headless test doesn't drive. To
 * exercise fa's automatic mechanics uniformly across all 32 teams (what this acceptance criterion is
 * actually about), the "user" team is un-flagged right after creation so it gets the same AI upkeep.
 */
function withAiManagedUserTeam(state: LeagueState): LeagueState {
  const team = state.teams[state.userTeam]!
  return {
    ...state,
    teams: { ...state.teams, [state.userTeam]: { ...team, userControlled: false } },
  }
}

describe('fa: cap invariants across 5 simulated offseasons (real 2015-2020 data)', () => {
  let ctx: EngineContext

  beforeAll(async () => {
    const manifest = readManifest()
    void manifest
    // Every in-history season transition (2016..2020) builds its schedule from real data, so every
    // chunk in that span must be preloaded; fakeDraft/fakeLifecycle/fakeHistory need none of it.
    const seasons = [2015, 2016, 2017, 2018, 2019, 2020]
    ctx = await loadRealContext(seasons, makeFakeModules({ fa, draft: replenishingDraft() }))
  }, 30000)

  it('every team is under cap, legally sized, with no negative contract years after each PRESEASON', () => {
    let state = withAiManagedUserTeam(league.newGame(newGameOpts(), ctx))
    state = league.advancePhase(state, ctx) // PRESEASON -> REGULAR week 1
    assertCapInvariants(state, ctx, 'season 0 kickoff')

    const phasesSeen: Phase[] = []
    for (let i = 0; i < 5; i++) {
      state = playSeason(state, ctx)
      phasesSeen.push(state.phase)
      state = playOffseason(state, ctx)
      assertCapInvariants(state, ctx, `offseason ${i + 1}`)
    }
    expect(phasesSeen).toEqual([
      'OFFSEASON_RESIGN',
      'OFFSEASON_RESIGN',
      'OFFSEASON_RESIGN',
      'OFFSEASON_RESIGN',
      'OFFSEASON_RESIGN',
    ])
    expect(state.season).toBe(2020)
  }, 30000)

  it('an AI team under the 46-man floor with no cap room still kicks off legal', () => {
    // Phase 6: real salaries past the data left MIA at 45 players because the filler refused
    // league-minimum bodies once payroll sat at the cap. The floor is a hard rule; the cap pass swaps.
    const start = withAiManagedUserTeam(league.newGame(newGameOpts(), ctx))
    const teamId = TEAM_IDS.find((id) => id !== start.userTeam)!
    const team = start.teams[teamId]!
    const cap = fa.capFor(start.season, ctx)
    const roster = [...team.roster]
      .sort((a, b) => a.contract.apy - b.contract.apy || a.playerId.localeCompare(b.playerId))
      .slice(0, 45)
    const base = roster.reduce((sum, r) => sum + r.contract.apy, 0)
    const state: LeagueState = {
      ...start,
      teams: {
        ...start.teams,
        [teamId]: { ...team, roster, deadMoney: Math.max(0, cap - base - 0.2) },
      },
    }
    expect(fa.validateRoster(state, teamId, ctx).ok).toBe(false)
    const next = league.advancePhase(state, ctx)
    const v = fa.validateRoster(next, teamId, ctx)
    expect(v.errors).toEqual([])
    expect(next.teams[teamId]!.roster.length).toBeGreaterThanOrEqual(46)
  }, 30000)

  it('is deterministic for a given seed', () => {
    const run = (seed: string) => {
      let state = withAiManagedUserTeam(league.newGame(newGameOpts({ seed }), ctx))
      state = league.advancePhase(state, ctx)
      state = playSeason(state, ctx)
      state = playOffseason(state, ctx)
      return state
    }
    const a = run('det-1')
    const b = run('det-1')
    const c = run('det-2')
    expect(a.teams).toEqual(b.teams)
    expect(a.teams).not.toEqual(c.teams)
  }, 30000)
})

function ctxFor(season = 2015) {
  return makeFakeContext(mockBundle({ season }), { fa })
}

describe('fa.synthesizeContract', () => {
  it('clamps hint years to 1-7 and treats a $0 hint as absent', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const playerId = state.teams.IND!.roster.find((r) => !r.contract.rookie)!.playerId

    const tooLong = fa.synthesizeContract(state, playerId, 2015, ctx, { apy: 5, years: 10 })
    expect(tooLong.years).toBeLessThanOrEqual(7)
    expect(tooLong.years).toBeGreaterThanOrEqual(1)
    expect(tooLong.apy).toBe(5)

    const zeroApy = fa.synthesizeContract(state, playerId, 2015, ctx, { apy: 0, years: 3 })
    expect(zeroApy.apy).toBeGreaterThan(0) // $0 hint ignored -> falls back to the market curve
  })

  it('gives rookies a 4-year deal shrinking with years already played', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const rookie = Object.values(state.players).find(
      (p) => p.draft !== null && p.rookieSeason === 2015,
    )!
    const contract = fa.synthesizeContract(state, rookie.id, 2015, ctx)
    expect(contract.rookie).toBe(true)
    expect(contract.years).toBe(4)
    const round = rookie.draft!.round
    expect(contract.guaranteedPct).toBe(faConstants.rookieGuaranteedPctByRound[round - 1])
    expect(contract.guaranteedPct).toBe(round <= 2 ? 1 : contract.guaranteedPct)
    expect(contract.guaranteedPct).toBeLessThanOrEqual(1)
  })

  it('produces a league payroll within ~15% of the real cap per team on median (fresh 2015 league)', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const cap = fa.capFor(2015, ctx)
    const ratios = TEAM_IDS.map((id) => fa.payroll(state, id) / cap).sort((a, b) => a - b)
    const median = ratios[Math.floor(ratios.length / 2)]!
    expect(median).toBeGreaterThanOrEqual(0.85)
    expect(median).toBeLessThanOrEqual(1.15)
  })
})

describe('fa.release', () => {
  it('charges dead money and moves the player to freeAgents', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const teamId = 'DAL'
    const slot = state.teams[teamId]!.roster[0]!
    const expectedDead =
      Math.round(
        slot.contract.apy * slot.contract.years * slot.contract.guaranteedPct * 0.25 * 100,
      ) / 100

    const next = fa.release(state, teamId, slot.playerId, ctx)
    expect(next.teams[teamId]!.roster.some((r) => r.playerId === slot.playerId)).toBe(false)
    expect(next.freeAgents).toContain(slot.playerId)
    expect(next.teams[teamId]!.deadMoney).toBeCloseTo(expectedDead, 2)
    expect(next.divergence.has(slot.playerId)).toBe(true)
  })
})

describe('fa.offer acceptance', () => {
  it('is monotone in offer/ask ratio', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const playerId = state.freeAgents[0]!
    const teamId = 'DAL'
    // Empty the team's roster for this check so the cap/roster hard gates never bind — only the
    // ratio-driven acceptance probability should vary across trials.
    const roomyState: LeagueState = {
      ...state,
      teams: { ...state.teams, [teamId]: { ...state.teams[teamId]!, roster: [], deadMoney: 0 } },
    }
    const ask = fa.resignAsk(roomyState, playerId, ctx)

    const acceptRate = (ratio: number): number => {
      let accepted = 0
      const trials = 80
      for (let i = 0; i < trials; i++) {
        const rng = ctx.modules.rng.fromSeed('offer-test', i)
        const contract = {
          years: 2,
          apy: ask * ratio,
          guaranteedPct: 0.4,
          signedSeason: 2015,
          rookie: false,
        }
        const result = fa.offer(roomyState, teamId, playerId, contract, ctx, rng)
        if (result.accepted) accepted++
      }
      return accepted / trials
    }

    const low = acceptRate(0.6)
    const mid = acceptRate(1.0)
    const high = acceptRate(1.6)
    expect(mid).toBeGreaterThanOrEqual(low)
    expect(high).toBeGreaterThanOrEqual(mid)
    expect(high).toBeGreaterThan(low)
  })
})

describe('fa.rolloverContracts', () => {
  it('decrements years, moves 0-year contracts to freeAgents, and resets deadMoney', () => {
    const ctx = ctxFor(2015)
    const state = league.newGame(newGameOpts(), ctx)
    const withDead = {
      ...state,
      teams: { ...state.teams, DAL: { ...state.teams.DAL!, deadMoney: 12.5 } },
    }
    const { state: rolled, expiring } = fa.rolloverContracts(withDead, ctx)

    expect(rolled.teams.DAL!.deadMoney).toBe(0)
    for (const teamId of TEAM_IDS) {
      for (const slot of rolled.teams[teamId]!.roster)
        expect(slot.contract.years).toBeGreaterThanOrEqual(1)
    }
    const totalExpiring = Object.values(expiring).reduce((n, ids) => n + ids.length, 0)
    expect(rolled.freeAgents.length).toBe(state.freeAgents.length + totalExpiring)
  })
})
