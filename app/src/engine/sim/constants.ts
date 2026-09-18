/**
 * Every tunable number the simulation uses (HANDOFF §6.3). Logic lives in the sibling modules; this
 * file is the only place the balance pass (Phase 5) needs to edit.
 */
import type { Position, SimConstants } from '@contracts/index'

export const simConstants: SimConstants = {
  // Calibrated on the mock league: sd(team overall) ≈ 1.9 → k·sd ≈ 4.8 gives sd(wins) ≈ 3.0 / 17 games.
  k: 2.5,
  hfa: 2.0,
  marginSd: 13.5,
  totalMean: 45,
  totalSd: 10,
  /** Conditional on reaching overtime, not on playing a game. */
  tieP: 0.07,
  offenseWeights: { QB: 0.35, OL: 0.25, WRTE: 0.25, RB: 0.15 },
  defenseWeights: { DL: 0.3, LB: 0.2, CB: 0.3, S: 0.2 },
  stWeight: 0.05,
  benchFactor: 0.15,
}

export const strengthConstants = {
  /** Slots that count as starters for each position group. */
  starters: { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 3, S: 2, K: 1, P: 1 } satisfies Record<Position, number>,
  /** How many reserves behind the starters feed the bench term. */
  benchDepth: 3,
  /** Value used when a team has nobody healthy at a slot. */
  replacementValue: 42,
  /** Relative weight of each starter slot within its group (first slot plays the most). */
  slotDecay: 0.82,
  /** WR and TE share the WRTE offensive weight in this ratio. */
  wrShareOfWrte: 0.72,
  ratingMin: 40,
  ratingMax: 99,
}

/** How a point total is broken into touchdowns and kicks; also how plausible each final score is. */
export const pointsConstants = {
  /** Expected touchdowns ≈ points / this. */
  pointsPerTd: 8.5,
  tdSpread: 1,
  /** Teams kick about this many field goals a game. */
  fgMean: 1.6,
  fgSpread: 2,
  maxFg: 8,
  twoPtWeight: 0.12,
  missedXpWeight: 0.12,
  safetyWeight: 0.05,
}

export const scoreConstants = {
  totalMin: 6,
  totalMax: 90,
  /** Width of the kernel used when snapping a raw score onto a plausible football score. */
  snapSd: 2.4,
  snapWindow: 5,
  /** Chance a snapped 1-point margin is widened to 3. */
  oneMarginFixP: 0.72,
  /** A drawn margin inside ±this is a regulation tie and the game goes to overtime (≈6% of games). */
  otWindow: 1,
}

export const overtimeConstants = {
  /** Sudden death before this season. */
  modifiedFrom: 2012,
  /** 10-minute period from this season: more ties. */
  shortPeriodFrom: 2017,
  /** tieP multiplier before the 10-minute period existed. */
  longPeriodTieMult: 0.45,
  /** P(the first score in overtime is a field goal). */
  fgFirstP: 0.55,
  /** P(both teams get a possession and trade field goals) under the modified rule. */
  bothScoreP: 0.3,
  /** Expected-margin points are damped this much when deciding who wins in overtime. */
  edgeDamp: 0.35,
}

export const boxConstants = {
  yardsBase: 150,
  yardsPerPoint: 8.5,
  yardsSd: 55,
  yardsMin: 140,
  yardsMax: 620,
  passShareMean: 0.61,
  passShareSd: 0.08,
  passShareMin: 0.35,
  passShareMax: 0.82,
  ypaMean: 7.0,
  ypaSd: 1.4,
  ypaMin: 4,
  ypaMax: 11,
  cmpMean: 0.62,
  cmpSd: 0.07,
  cmpMin: 0.35,
  cmpMax: 0.85,
  ypcMean: 4.2,
  ypcSd: 1.0,
  ypcMin: 2.2,
  ypcMax: 6.5,
  passAttMin: 12,
  passAttMax: 60,
  rushAttMin: 10,
  rushAttMax: 45,
  /** P(a touchdown was a passing touchdown). */
  passTdShare: 0.62,
  intDist: [0.45, 0.3, 0.15, 0.07, 0.03],
  fgMissP: [0.25, 0.08],
  puntsBase: 7.5,
  puntsPerPoint: 0.09,
  puntsSd: 1.6,
  puntYdsMean: 45,
  puntYdsSd: 4,
  tacklesMean: 62,
  tacklesSd: 8,
  sacksMean: 2.4,
  sacksSd: 1.5,
  sacksMax: 8,
  ffDist: [0.55, 0.3, 0.12, 0.03],
  pdMean: 5,
  pdSd: 2,
  pdMax: 12,
  /** Log-normal σ of the per-player usage noise. */
  usageNoiseSd: 0.32,
  /** How strongly true value tilts usage inside a position group. */
  valueTilt: 0.03,
  rushWeights: { QB: 0.07, RB: [0.5, 0.26, 0.11], WR: 0.03 },
  recWeights: { WR: [0.22, 0.17, 0.11, 0.06], TE: [0.13, 0.05], RB: [0.13, 0.06] },
  tackleWeights: { DL: 0.07, LB: 0.13, CB: 0.08, S: 0.1 },
  sackWeights: { DL: 0.25, LB: 0.12, CB: 0.02, S: 0.02 },
  intWeights: { DL: 0.02, LB: 0.1, CB: 0.3, S: 0.25 },
  pdWeights: { DL: 0.03, LB: 0.12, CB: 0.32, S: 0.2 },
  ffWeights: { DL: 0.2, LB: 0.25, CB: 0.15, S: 0.15 },
  /** Defenders used per group when spreading defensive stats. */
  defenders: { DL: 5, LB: 4, CB: 4, S: 3 } satisfies Record<'DL' | 'LB' | 'CB' | 'S', number>,
}

export const injuryConstants = {
  /** Players who dress for a game; the injury roll is made for each of them. */
  activePerGame: 46,
  /**
   * The fitted per-player rates describe starters over a full workload; scaling up puts the league at
   * roughly one multi-week injury per team per game, which is what real injury reports look like.
   */
  rateScale: 2.8,
  maxWeeksOut: 22,
}
