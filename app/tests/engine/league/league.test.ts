import { describe, expect, it, vi } from 'vitest'
import {
  PHASES,
  SavedLeagueSchema,
  TEAM_IDS,
  toSaved,
  type LeagueState,
  type Phase,
} from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { fakeFa, fakeLifecycle, makeFakeContext } from '../fakes'

/** toSaved stamps savedAt with the real clock, so determinism checks must ignore it. */
function withoutSavedAt(saved: ReturnType<typeof toSaved>) {
  return { ...saved, savedAt: undefined }
}

function newGameOpts(overrides: Partial<Parameters<typeof league.newGame>[0]> = {}) {
  return {
    seed: 'league-seed',
    startSeason: 2015,
    userTeam: 'IND',
    horizonSeasons: 3,
    settings: {
      tradeStrictness: 'balanced' as const,
      aiOfferFrequency: 'normal' as const,
      injuries: true,
    },
    ...overrides,
  }
}

describe('league.newGame', () => {
  it('produces a SavedLeagueSchema-valid state with 32x53 rosters and the real schedule', () => {
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts({ startAt: 'PRESEASON' }), ctx)

    const parsed = SavedLeagueSchema.safeParse(toSaved(state))
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5), null, 2)).toBe(true)

    expect(Object.keys(state.teams)).toHaveLength(32)
    for (const id of TEAM_IDS) expect(state.teams[id]!.roster).toHaveLength(53)

    expect(state.schedule.length).toBe(
      bundle.seasons[2015]!.schedule.games.filter((g) => g.type === 'REG').length,
    )
    expect(state.phase).toBe('PRESEASON')
  })
})

/** A mock 2015 bundle with one member of the 2015 class already on IND's opening-day roster. */
function bundleWithRosteredRookie() {
  const bundle = mockBundle({ season: 2015 })
  const sd = bundle.seasons[2015]!
  const rookie = sd.draft.prospects[0]!
  sd.players.players.push({ ...rookie, trueValue: rookie.scouting.ovr, team: 'IND' })
  sd.rosters.rosters.IND!.push({ playerId: rookie.id, apy: 1, years: 4, depth: 99 })
  return { bundle, rookie }
}

describe('league.newGame opening offseason', () => {
  it('opens at the DRAFT phase of the season before, with the start class off the rosters', () => {
    const { bundle, rookie } = bundleWithRosteredRookie()
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts(), ctx)

    expect(state.season).toBe(2014)
    expect(state.startSeason).toBe(2015)
    expect(state.phase).toBe('DRAFT')
    expect(state.week).toBe(0)
    expect(state.schedule).toHaveLength(0)
    expect(state.draftRoom).toBeNull()

    expect(state.players[rookie.id]).toBeUndefined()
    expect(state.scouting[rookie.id]).toBeUndefined()
    expect(state.truth[rookie.id]).toBeUndefined()
    expect(state.freeAgents).not.toContain(rookie.id)
    for (const id of TEAM_IDS)
      expect(
        state.teams[id]!.roster.some((r) => r.playerId === rookie.id),
        id,
      ).toBe(false)
    expect(state.teams.IND!.roster).toHaveLength(53)

    const seasons = new Set(state.picks.map((p) => p.season))
    expect(seasons).toEqual(new Set([2015, 2016, 2017]))
    const classPicks = state.picks.filter((p) => p.season === 2015)
    expect(classPicks.length).toBeGreaterThan(0)
    expect(classPicks.every((p) => p.pick !== null)).toBe(true)

    const parsed = SavedLeagueSchema.safeParse(toSaved(state))
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5), null, 2)).toBe(true)
  })

  it("startAt 'PRESEASON' keeps opening day: rookies rostered, picks for +1/+2, schedule built", () => {
    const { bundle, rookie } = bundleWithRosteredRookie()
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts({ startAt: 'PRESEASON' }), ctx)

    expect(state.season).toBe(2015)
    expect(state.phase).toBe('PRESEASON')
    expect(state.players[rookie.id]).toBeDefined()
    expect(state.teams.IND!.roster.some((r) => r.playerId === rookie.id)).toBe(true)
    expect(new Set(state.picks.map((p) => p.season))).toEqual(new Set([2016, 2017]))
    expect(state.schedule.length).toBeGreaterThan(0)
  })

  it('is deterministic for a seed', () => {
    const ctx = makeFakeContext(mockBundle({ season: 2015 }))
    const a = league.newGame(newGameOpts({ seed: 'open-a' }), ctx)
    const b = league.newGame(newGameOpts({ seed: 'open-a' }), ctx)
    expect(withoutSavedAt(toSaved(a))).toEqual(withoutSavedAt(toSaved(b)))
  })
})

/** Drive one full season loop (REGULAR + PLAYOFFS via simWeek, offseason via advancePhase). */
function playSeason(state: LeagueState, ctx: ReturnType<typeof makeFakeContext>): LeagueState {
  let s = state
  let guard = 0
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
    s = league.simWeek(s, ctx).state
    guard++
    if (guard > 60) throw new Error('playSeason: simWeek did not terminate')
  }
  return s
}

/** Drive every offseason phase from OFFSEASON_RESIGN back to REGULAR week 1 of the next season. */
function playOffseason(state: LeagueState, ctx: ReturnType<typeof makeFakeContext>): LeagueState {
  let s = state
  expect(s.phase).toBe('OFFSEASON_RESIGN')
  s = league.advancePhase(s, ctx) // -> DRAFT
  expect(s.phase).toBe('DRAFT')
  s = ctx.modules.draft.startDraft(s, ctx)
  s = ctx.modules.draft.autoDraftToEnd(s, ctx)
  s = league.advancePhase(s, ctx) // -> UDFA
  expect(s.phase).toBe('UDFA')
  s = league.advancePhase(s, ctx) // -> FREE_AGENCY
  expect(s.phase).toBe('FREE_AGENCY')
  s = league.advancePhase(s, ctx) // -> TRAINING_CAMP
  expect(s.phase).toBe('TRAINING_CAMP')
  s = league.advancePhase(s, ctx) // -> PRESEASON (season + 1)
  expect(s.phase).toBe('PRESEASON')
  s = league.advancePhase(s, ctx) // -> REGULAR week 1
  expect(s.phase).toBe('REGULAR')
  return s
}

function playThreeSeasons(seed: string, season = 2015) {
  const bundle = mockBundle({ season })
  const ctx = makeFakeContext(bundle)
  let state = league.newGame(newGameOpts({ seed, startSeason: season, startAt: 'PRESEASON' }), ctx)
  state = league.advancePhase(state, ctx) // PRESEASON -> REGULAR week 1
  const phasesSeen: Phase[] = [state.phase]
  // Bracket for each season, captured right as its Super Bowl completes (before records reset).
  const brackets = []
  for (let i = 0; i < 3; i++) {
    state = playSeason(state, ctx)
    phasesSeen.push(state.phase)
    brackets.push(league.seedPlayoffs(state, ctx))
    if (i < 2) {
      state = playOffseason(state, ctx)
      phasesSeen.push(state.phase)
    }
  }
  return { state, ctx, phasesSeen, brackets }
}

describe('league season loop (fakes)', () => {
  it('cycles phases in PHASES order and is deterministic for a given seed', () => {
    const a = playThreeSeasons('season-loop-1')
    const b = playThreeSeasons('season-loop-1')
    const c = playThreeSeasons('season-loop-2')

    expect(a.state.history).toEqual(b.state.history)
    expect(a.state.history).not.toEqual(c.state.history)
    expect(a.state.history).toHaveLength(3)
    expect(a.state.season).toBe(2017)

    // playOffseason() already asserts each intermediate phase in PHASES order (DRAFT -> UDFA ->
    // FREE_AGENCY -> TRAINING_CAMP -> PRESEASON -> REGULAR) between the coarse checkpoints below.
    expect(a.phasesSeen).toEqual([
      'REGULAR',
      'OFFSEASON_RESIGN',
      'REGULAR',
      'OFFSEASON_RESIGN',
      'REGULAR',
      'OFFSEASON_RESIGN',
    ])
    expect(PHASES).toContain(a.state.phase)
  })

  it('produces standings with valid division and conference ranks', () => {
    const { state, ctx } = playThreeSeasons('standings-1')
    const rows = league.standings(state, ctx)
    expect(rows).toHaveLength(32)
    for (const row of rows) {
      expect(row.confRank).toBeGreaterThanOrEqual(1)
      expect(row.confRank).toBeLessThanOrEqual(16)
      expect(row.divRank).toBeGreaterThanOrEqual(1)
      expect(row.divRank).toBeLessThanOrEqual(4)
    }
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(32)
  })

  it('2015 bracket: 12 teams, 4 byes, 11 games', () => {
    const { brackets } = playThreeSeasons('bracket-2015', 2015)
    const bracket = brackets[0]!
    const totalGames = bracket.rounds.reduce((n, r) => n + r.games.length, 0)
    const byes = bracket.seeds.filter((s) => s.seed <= 2).length
    expect(bracket.seeds).toHaveLength(12)
    expect(byes).toBe(4)
    expect(totalGames).toBe(11)
    expect(bracket.champion).not.toBeNull()
  })

  it('2021 bracket: 14 teams, 2 byes, 13 games', () => {
    const { brackets } = playThreeSeasons('bracket-2021', 2021)
    const bracket = brackets[0]!
    const totalGames = bracket.rounds.reduce((n, r) => n + r.games.length, 0)
    const byes = bracket.seeds.filter((s) => s.seed <= 1).length
    expect(bracket.seeds).toHaveLength(14)
    expect(byes).toBe(2)
    expect(totalGames).toBe(13)
    expect(bracket.champion).not.toBeNull()
  })

  it('generated 2027 schedule: every team plays 17 games with exactly one bye', () => {
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle)
    const state: LeagueState = {
      ...league.newGame(newGameOpts({ seed: 'sched-2027' }), ctx),
      season: 2027,
    }
    const games = league.buildSchedule(state, ctx)
    const perTeam = new Map<string, number>()
    for (const g of games) {
      perTeam.set(g.home, (perTeam.get(g.home) ?? 0) + 1)
      perTeam.set(g.away, (perTeam.get(g.away) ?? 0) + 1)
    }
    expect(perTeam.size).toBe(32)
    for (const [, count] of perTeam) expect(count).toBe(17)

    const weeksPlayed = new Map<string, Set<number>>()
    for (const g of games) {
      for (const t of [g.home, g.away]) {
        const set = weeksPlayed.get(t) ?? new Set<number>()
        set.add(g.week)
        weeksPlayed.set(t, set)
      }
    }
    for (const [, weeks] of weeksPlayed) expect(weeks.size).toBe(17) // one week (of 18) unused: the bye
  })
})

function snapshotContracts(state: LeagueState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const id of TEAM_IDS)
    for (const slot of state.teams[id]!.roster) out[`${id}:${slot.playerId}`] = slot.contract
  return out
}

/** DRAFT → UDFA → FREE_AGENCY → TRAINING_CAMP → PRESEASON with the draft fakes. */
function playOpeningOffseason(state: LeagueState, ctx: ReturnType<typeof makeFakeContext>) {
  let s = ctx.modules.draft.startDraft(state, ctx)
  s = ctx.modules.draft.autoDraftToEnd(s, ctx)
  s = league.advancePhase(s, ctx) // -> UDFA
  s = league.advancePhase(s, ctx) // -> FREE_AGENCY
  s = league.advancePhase(s, ctx) // -> TRAINING_CAMP
  s = league.advancePhase(s, ctx) // -> PRESEASON (opening rollover)
  return s
}

describe('league opening rollover', () => {
  it('rolls into startSeason without ticking contracts, progressing or retiring anyone', () => {
    const rollover = vi.fn(fakeFa.rolloverContracts)
    const progress = vi.fn(fakeLifecycle.progressSeason)
    const retire = vi.fn(fakeLifecycle.retirements)
    const refresh = vi.fn(fakeLifecycle.refreshScouting)
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle, {
      fa: { ...fakeFa, rolloverContracts: rollover },
      lifecycle: {
        ...fakeLifecycle,
        progressSeason: progress,
        retirements: retire,
        refreshScouting: refresh,
      },
    })
    const opening = league.newGame(newGameOpts(), ctx)
    const withDeadMoney: LeagueState = {
      ...opening,
      teams: { ...opening.teams, IND: { ...opening.teams.IND!, deadMoney: 5 } },
    }
    const before = snapshotContracts(withDeadMoney)

    const s = playOpeningOffseason(withDeadMoney, ctx)

    expect(s.season).toBe(2015)
    expect(s.phase).toBe('PRESEASON')
    expect(s.week).toBe(0)
    expect(rollover).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
    expect(retire).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(snapshotContracts(s)).toEqual(before)
    expect(s.scouting).toEqual(opening.scouting)
    for (const id of TEAM_IDS) expect(s.teams[id]!.deadMoney, id).toBe(0)
    expect(s.schedule.length).toBe(
      bundle.seasons[2015]!.schedule.games.filter((g) => g.type === 'REG').length,
    )
    expect(new Set(s.picks.map((p) => p.season))).toEqual(new Set([2015, 2016, 2017]))
  })

  it('runs the normal rollover after the first season is played', () => {
    const rollover = vi.fn(fakeFa.rolloverContracts)
    const progress = vi.fn(fakeLifecycle.progressSeason)
    const ctx = makeFakeContext(mockBundle({ season: 2015 }), {
      fa: { ...fakeFa, rolloverContracts: rollover },
      lifecycle: { ...fakeLifecycle, progressSeason: progress },
    })
    let s = playOpeningOffseason(league.newGame(newGameOpts(), ctx), ctx)
    s = league.advancePhase(s, ctx) // PRESEASON -> REGULAR
    s = playSeason(s, ctx)
    expect(s.phase).toBe('OFFSEASON_RESIGN')
    s = playOffseason(s, ctx)
    expect(s.season).toBe(2016)
    expect(rollover).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledTimes(1)
  })

  it('is deterministic through the opening offseason', () => {
    const run = () => {
      const ctx = makeFakeContext(mockBundle({ season: 2015 }))
      return toSaved(
        playOpeningOffseason(league.newGame(newGameOpts({ seed: 'roll-a' }), ctx), ctx),
      )
    }
    expect(withoutSavedAt(run())).toEqual(withoutSavedAt(run()))
  })
})
