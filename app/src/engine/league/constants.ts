/** engine/league tunables. */

/** Weeks 1..DIVISION_ROUND_WEEKS of a generated (post-history) schedule are the double round-robin
 * within each 4-team division (6 games per team: 3 rivals home and away). */
export const DIVISION_ROUND_WEEKS = 6

/** Fixed home/away template for a 4-team division across DIVISION_ROUND_WEEKS weeks. Indices are
 * positions into the division's (sorted) 4-team array; [home, away] per game. */
export const DIVISION_ROUND_TEMPLATE: readonly (readonly [number, number])[][] = [
  [
    [0, 1],
    [2, 3],
  ],
  [
    [1, 0],
    [3, 2],
  ],
  [
    [0, 2],
    [1, 3],
  ],
  [
    [2, 0],
    [3, 1],
  ],
  [
    [0, 3],
    [1, 2],
  ],
  [
    [3, 0],
    [2, 1],
  ],
]

/** Weights for the major-awards defensive score: sacks*4 + ints*5 + forcedFumbles*3 + passesDefended
 * + tackles*0.4 + defTd*6 (docs/HANDOFF.md §6.3). Offensive score is computed inline (a standard
 * fantasy-style formula: passYds/25 + passTd*4 - passInt*2 + rushYds/10 + rushTd*6 + recYds/10 + recTd*6). */
export const DEFENSE_SCORE_WEIGHTS = {
  sacks: 4,
  ints: 5,
  forcedFumbles: 3,
  passesDefended: 1,
  tackles: 0.4,
  defTd: 6,
}

/** MVP value = offensive score * (MVP_WIN_PCT_BASE + team win pct); rewards production on winning teams. */
export const MVP_WIN_PCT_BASE = 0.5

/** Coach of the year: projected win pct by depth-chart-consensus rank, 1..32, pct = topPct - spread *
 * (rank-1)/rankDenom. rankDenom is fixed at 31 (a 32-team league) regardless of how many teams are
 * actually present in state.teams, so the formula reads the same in tests and in the real league. */
export const COY_PROJECTION = {
  topPct: 0.72,
  spread: 0.44,
  rankDenom: 31,
}
