import { describe, expect, it } from 'vitest'
import { PHASES, SavedLeagueSchema, TEAM_IDS, toSaved, type LeagueState, type Phase } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { makeFakeContext } from '../fakes'

function newGameOpts(overrides: Partial<Parameters<typeof league.newGame>[0]> = {}) {
  return {
    seed: 'league-seed',
    startSeason: 2015,
    userTeam: 'IND',
    horizonSeasons: 3,
    settings: { tradeStrictness: 'balanced' as const, aiOfferFrequency: 'normal' as const, injuries: true },
    ...overrides,
  }
}

describe('league.newGame', () => {
  it('produces a SavedLeagueSchema-valid state with 32x53 rosters and the real schedule', () => {
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts(), ctx)

    const parsed = SavedLeagueSchema.safeParse(toSaved(state))
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5), null, 2)).toBe(true)

    expect(Object.keys(state.teams)).toHaveLength(32)
    for (const id of TEAM_IDS) expect(state.teams[id]!.roster).toHaveLength(53)

    expect(state.schedule.length).toBe(bundle.seasons[2015]!.schedule.games.filter((g) => g.type === 'REG').length)
    expect(state.phase).toBe('PRESEASON')
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
  let state = league.newGame(newGameOpts({ seed, startSeason: season }), ctx)
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
    expect(a.phasesSeen).toEqual(['REGULAR', 'OFFSEASON_RESIGN', 'REGULAR', 'OFFSEASON_RESIGN', 'REGULAR', 'OFFSEASON_RESIGN'])
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
    const state: LeagueState = { ...league.newGame(newGameOpts({ seed: 'sched-2027' }), ctx), season: 2027 }
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
