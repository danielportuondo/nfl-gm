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
