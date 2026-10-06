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

/** Raw offensive production, fantasy-style: yards and touchdowns, half a point per reception, and a
 * 2-point penalty per interception. Only used to rank players against their own position group. */
export const OFFENSE_SCORE_WEIGHTS = {
  passYd: 1 / 25,
  passTd: 4,
  passInt: -2,
  rushYd: 1 / 10,
  rushTd: 6,
  recYd: 1 / 10,
  rec: 0.5,
  recTd: 6,
}

/** Raw defensive production. Interceptions are worth less than sacks on purpose: they are rarer
 * than passes defended but also far noisier, and only defensive backs can collect them. */
export const DEFENSE_SCORE_WEIGHTS = {
  sacks: 4,
  ints: 3,
  forcedFumbles: 3,
  passesDefended: 0.8,
  tackles: 0.25,
  defTd: 6,
}

/**
 * Position adjustment (offense and defense). A player's raw score is divided by the mean raw score of
 * the top `depth` players at his position that season, so the number says "how many times a typical
 * top performer", and league-wide inflation at one position (e.g. every RB running for 1,300) cancels.
 * `floor` is the smallest benchmark allowed: with a thin or short-season pool a lone player must not
 * look like 3x a typical star. Floors sit at roughly 60% of a real top-`depth` mean.
 */
export const OFFENSE_BENCHMARK = {
  QB: { depth: 12, floor: 150 },
  RB: { depth: 12, floor: 110 },
  WR: { depth: 24, floor: 100 },
  TE: { depth: 10, floor: 65 },
}

export const DEFENSE_BENCHMARK = {
  DL: { depth: 16, floor: 60 },
  LB: { depth: 16, floor: 50 },
  CB: { depth: 16, floor: 50 },
  S: { depth: 12, floor: 40 },
}

/**
 * MVP: position-adjusted score x position weight x team-success factor. A QB is 1.0; a non-QB needs a
 * season that is roughly 1.3-1.5x the best of his position to overtake an elite QB, i.e. a historic one.
 */
export const MVP_POSITION_WEIGHT = { QB: 1, RB: 0.78, WR: 0.72, TE: 0.6 }

/** Team factor = 1 + weight * (win pct - 0.5), never below `floor`: 15-1 ~ x1.5, 8-8 = x1, 4-12 ~ x0.7. */
export const MVP_TEAM_SUCCESS = { weight: 1.2, floor: 0.4 }

/** OPOY: position-adjusted score x position weight, no team factor. QBs are slightly discounted so the
 * award leans to skill positions when a QB has already taken MVP. */
export const OPOY_POSITION_WEIGHT = { QB: 0.9, RB: 1, WR: 0.95, TE: 0.7 }

/** OROY: same idea as OPOY, with ball carriers discounted a little because rookie RBs inherit the
 * biggest workloads (the sim hands the top back most of the carries). */
export const OROY_POSITION_WEIGHT = { QB: 1, RB: 0.85, WR: 1, TE: 0.8 }

/** DPOY / DROY: position-adjusted score x position weight. Pass rushers (DL, and edge LBs) decide
 * the real vote about 4 years in 5; coverage players win it rarely. */
export const DPOY_POSITION_WEIGHT = { DL: 1, LB: 0.82, CB: 0.85, S: 0.78 }
export const DROY_POSITION_WEIGHT = { DL: 1, LB: 0.9, CB: 0.85, S: 0.82 }

/** Award notes split rushing and receiving yards when the smaller part is at least this many yards. */
export const NOTE_MIN_SECONDARY_YARDS = 100

/** Coach of the year: projected win pct by depth-chart-consensus rank, 1..32, pct = topPct - spread *
 * (rank-1)/rankDenom. rankDenom is fixed at 31 (a 32-team league) regardless of how many teams are
 * actually present in state.teams, so the formula reads the same in tests and in the real league. */
export const COY_PROJECTION = {
  topPct: 0.72,
  spread: 0.44,
  rankDenom: 31,
}
