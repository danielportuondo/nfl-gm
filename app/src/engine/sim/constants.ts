/**
 * Every tunable number the simulation uses (HANDOFF §6.3). Logic lives in the sibling modules; this
 * file is the only place the balance pass (Phase 5) needs to edit.
 */
import type { Position, SimConstants } from '@contracts/index'

export const simConstants: SimConstants = {
  // Phase 5B: re-calibrated on real seasons, where sd(team overall) is 2.6–3.2, not the mock's 1.9.
  // k = 2.5 put sd(wins) at 3.3–3.5 in history and 3.5–3.8 in procedural seasons; 2.1 lands both at
  // the §6.3 target of ≈ 3.0 without moving the win correlation (0.858 → 0.858 on 2015).
  k: 2.1,
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
  starters: {
    QB: 1,
    RB: 1,
    WR: 3,
    TE: 1,
    OL: 5,
    DL: 4,
    LB: 3,
    CB: 3,
    S: 2,
    K: 1,
    P: 1,
  } satisfies Record<Position, number>,
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
  /** Chance a snapped 1-point margin is widened to 3. Phase 5B: 0.72 left 1-point games at 1.0 %. */
  oneMarginFixP: 0.38,
  /** A drawn margin inside ±this is a regulation tie and the game goes to overtime (≈6% of games). */
  otWindow: 1.3,
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

/**
 * Yards follow from the final score, never the other way round, so these move box stats without
 * moving a single result. Calibrated on 2015–2019 (tests/engine/sim/boxDistribution.test.ts): ~357
 * gross yards, ~35 pass attempts and ~114 rush yards per team-game, ~10 thousand-yard rushers,
 * ~12 four-thousand-yard passers and ~22 thousand-yard receivers a season.
 */
export const boxConstants = {
  yardsBase: 162,
  yardsPerPoint: 8.5,
  yardsSd: 55,
  yardsMin: 140,
  yardsMax: 620,
  passShareMean: 0.68,
  passShareSd: 0.08,
  passShareMin: 0.35,
  passShareMax: 0.82,
  /** Gross yards per attempt (sacks are not subtracted from box passing yards). */
  ypaMean: 7.1,
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
  /**
   * P(a touchdown was scored by the defense or on a return). NFL 2012–2023: 70–90 of ~1,300 TDs a
   * season (≈ 0.15 per team-game); about two thirds of them interception or fumble returns.
   */
  nonOffenseTdShare: 0.055,
  defShareOfNonOffenseTd: 0.65,
  /**
   * P(an offensive touchdown was a passing touchdown). 0.62 of all TDs before non-offensive TDs
   * existed; 0.656 of offensive TDs keeps passing TDs where they were (real 2015: 805 of 1,231).
   */
  passTdShare: 0.656,
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
  rushWeights: { QB: 0.08, RB: [0.43, 0.28, 0.12], WR: 0.03 },
  recWeights: { WR: [0.24, 0.17, 0.11, 0.06], TE: [0.13, 0.05], RB: [0.12, 0.05] },
  tackleWeights: { DL: 0.07, LB: 0.13, CB: 0.08, S: 0.1 },
  sackWeights: { DL: 0.25, LB: 0.12, CB: 0.02, S: 0.02 },
  intWeights: { DL: 0.02, LB: 0.1, CB: 0.3, S: 0.25 },
  pdWeights: { DL: 0.03, LB: 0.12, CB: 0.32, S: 0.2 },
  ffWeights: { DL: 0.2, LB: 0.25, CB: 0.15, S: 0.15 },
  /** Who takes a turnover back for a score, and who is in the end zone for a safety. */
  defTdWeights: { DL: 0.06, LB: 0.12, CB: 0.3, S: 0.22 },
  safetyWeights: { DL: 0.3, LB: 0.15, CB: 0.03, S: 0.03 },
  /** Kick and punt returners come from the back of the depth chart, not the starters. */
  returnWeights: { WR: [0.03, 0.08, 0.22, 0.2], RB: [0.03, 0.18, 0.12], CB: [0.03, 0.08, 0.2] },
  /** Defenders used per group when spreading defensive stats. */
  defenders: { DL: 5, LB: 4, CB: 4, S: 3 } satisfies Record<'DL' | 'LB' | 'CB' | 'S', number>,
}

export const injuryConstants = {
  /** Players who dress for a game; the injury roll is made for each of them. */
  activePerGame: 46,
  /**
   * `injuryModel.ratePerPlayerGame` is fit from injuries_2012–2025 and already describes real spells:
   * unscaled it gives 1.02 injuries per team-game. §6.3's target is the calibration band: 0.6–1.6 total
   * and 0.35–0.8 multi-week per team-game. Durations follow players onto reserve (weekly roster `RES`
   * status), so about 53 % of injuries last 2+ weeks and 12 % run to season end. 1.1 lands 2015 at
   * ≈ 1.12 total and ≈ 0.59 multi-week (≈ 10 multi-week injuries per team-season, what NFL IR usage
   * looks like).
   */
  rateScale: 1.1,
  maxWeeksOut: 22,
}
