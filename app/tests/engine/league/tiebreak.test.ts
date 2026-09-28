/**
 * QA regression: compareTeams() used to be a pairwise comparator fed straight into Array.sort, which is
 * non-transitive when 3+ teams are tied on win pct with a head-to-head cycle (A beat B, B beat C, C beat
 * A). The fix (engine/league/index.ts#orderTeamsByTiebreak) buckets the tied group by each criterion in
 * turn (pct -> group head-to-head pct -> point diff -> team id) and recurses into ties only, so a cycle
 * can never produce a contradictory order — it just falls through to point diff, then team id.
 */
import { describe, expect, it } from 'vitest'
import type { Game, GameResult, LeagueState, TeamId } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { league } from '@engine/league'
import { makeFakeContext } from '../fakes'

function newGameOpts(overrides: Partial<Parameters<typeof league.newGame>[0]> = {}) {
  return {
    seed: 'tiebreak-seed',
    startSeason: 2015,
    userTeam: 'IND' as TeamId,
    horizonSeasons: 1,
    settings: {
      tradeStrictness: 'balanced' as const,
      aiOfferFrequency: 'normal' as const,
      injuries: true,
    },
    ...overrides,
  }
}

/** A full, schema-valid regular season (schedule + results) to patch a 3-way tie onto. */
function playRegularSeason(seed: string) {
  const bundle = mockBundle({ season: 2015 })
  const ctx = makeFakeContext(bundle)
  let state = league.newGame(newGameOpts({ seed, startAt: 'PRESEASON' }), ctx)
  state = league.advancePhase(state, ctx) // PRESEASON -> REGULAR week 1
  let guard = 0
  while (state.phase === 'REGULAR') {
    state = league.simWeek(state, ctx).state
    guard++
    if (guard > 30) throw new Error('playRegularSeason: simWeek did not terminate')
  }
  return { state, ctx }
}

/**
 * mockBundle's fixture schedule is a simplified round-robin (docs/DECISIONS.md Phase 1 follow-ups:
 * "roundRobin home/away imbalance") that doesn't guarantee every division pair meets within the
 * season's week count, so tests inject a fresh, uniquely-idâ€™d game rather than depending on one
 * already existing in state.schedule. `divRank`/`confRank` read `state.teams[id].record` directly
 * (set by `equalizeRecords`), not a sum over `state.results`, so adding extra games doesn't perturb it
 * — only the head-to-head tiebreak, which does read state.results/schedule, sees them.
 */
let syntheticWeek = 90
function forceWin(state: LeagueState, winner: TeamId, loser: TeamId): LeagueState {
  const week = syntheticWeek++
  const game: Game = {
    id: `${state.season}-REG-${week}-${loser}@${winner}`,
    season: state.season,
    week,
    type: 'REG',
    home: winner,
    away: loser,
  }
  const result: GameResult = {
    gameId: game.id,
    homeScore: 24,
    awayScore: 17,
    overtime: false,
    injuries: [],
  }
  return { ...state, schedule: [...state.schedule, game], results: [...state.results, result] }
}

/** Force A, B, C (and, so it never contends, D) to identical records and point differentials so
 * win pct and point diff both say "tied" and only head-to-head can separate them. */
function equalizeRecords(state: LeagueState, teams: TeamId[]): LeagueState {
  const record = { wins: 9, losses: 8, ties: 0, pointsFor: 300, pointsAgainst: 290 }
  const updated = { ...state.teams }
  for (const t of teams) updated[t] = { ...updated[t]!, record: { ...record } }
  return { ...state, teams: updated }
}

const A: TeamId = 'IND'
const B: TeamId = 'HOU'
const C: TeamId = 'TEN'
const D: TeamId = 'JAX' // fourth AFC South team; kept clearly worse so it never enters the tied group.

function southDivRanks(state: LeagueState, ctx: ReturnType<typeof makeFakeContext>) {
  const rows = league.standings(state, ctx)
  return Object.fromEntries(
    rows.filter((r) => [A, B, C, D].includes(r.teamId)).map((r) => [r.teamId, r.divRank]),
  )
}

describe('league standings tiebreak: 3+ way head-to-head cycle', () => {
  it('resolves a strict A>B>C>A cycle to a transitive, deterministic order (falls through to team id)', () => {
    const { state: base, ctx } = playRegularSeason('cycle-1')
    let state = equalizeRecords(base, [A, B, C])
    state = forceWin(state, A, B)
    state = forceWin(state, B, C)
    state = forceWin(state, C, A)

    const ranks = southDivRanks(state, ctx)
    // Head-to-head among {A,B,C} is 0.5/0.5/0.5 (each 1-1 within the group) and point diff is tied too,
    // so the only thing left to break the tie is team id: HOU < IND < TEN alphabetically.
    expect(ranks[B]).toBeLessThan(ranks[A]!) // HOU before IND
    expect(ranks[A]).toBeLessThan(ranks[C]!) // IND before TEN
    expect(ranks[D]).toBeGreaterThan(ranks[C]!) // JAX (worse record) stays last

    // Re-derive the same scenario with the cycle built in the opposite rotational direction — the
    // group head-to-head pct is still 0.5/0.5/0.5, so the result must be identical regardless of which
    // direction the cyclic wins were assigned in.
    let reverseState = equalizeRecords(base, [A, B, C])
    reverseState = forceWin(reverseState, A, C)
    reverseState = forceWin(reverseState, C, B)
    reverseState = forceWin(reverseState, B, A)
    const reverseRanks = southDivRanks(reverseState, ctx)
    expect(reverseRanks).toEqual(ranks)

    // seedPlayoffs() shares the same tiebreak function (a second call site) — its conference ordering
    // of A/B/C must not contradict standings()'s divRank ordering.
    const afcSeeds = league
      .seedPlayoffs(state, ctx)
      .seeds.filter((s) => [A, B, C].includes(s.teamId))
    const seedOf = new Map(afcSeeds.map((s) => [s.teamId, s.seed]))
    if (seedOf.has(A) && seedOf.has(B)) expect(seedOf.get(B)!).toBeLessThan(seedOf.get(A)!)
    if (seedOf.has(A) && seedOf.has(C)) expect(seedOf.get(A)!).toBeLessThan(seedOf.get(C)!)
  })

  it('a team that swept the other two in a 3-way tie ranks first', () => {
    const { state: base, ctx } = playRegularSeason('sweep-1')
    let state = equalizeRecords(base, [A, B, C])
    state = forceWin(state, A, B) // A beats B
    state = forceWin(state, A, C) // A beats C
    state = forceWin(state, B, C) // B beats C (direction irrelevant to A's rank)

    const ranks = southDivRanks(state, ctx)
    expect(ranks[A]).toBeLessThan(ranks[B]!)
    expect(ranks[A]).toBeLessThan(ranks[C]!)
    expect(ranks[D]).toBeGreaterThan(ranks[A]!)
  })

  it('a normal (non-tied) division and conference are unaffected', () => {
    const { state, ctx } = playRegularSeason('normal-1')
    const rows = league.standings(state, ctx)
    expect(rows).toHaveLength(32)
    const southRows = rows.filter((r) => [A, B, C, D].includes(r.teamId))
    expect(new Set(southRows.map((r) => r.divRank))).toEqual(new Set([1, 2, 3, 4]))
  })
})
