/**
 * Every tunable number the trade AI uses (HANDOFF §6.5). Logic lives in the sibling modules; this is
 * the only file the balance pass (Phase 5) needs to edit.
 *
 * Value units: one "point" is roughly 1% of a fringe roster player. Calibration anchors —
 * ovr 75 starter ≈ 21, ovr 85 ≈ 54, ovr 95 ≈ 110, pick #1 ≈ 95, late first ≈ 30, a 5th ≈ 5.
 * `scale` (12) is chosen against those anchors so that a fair swap of ~75-ovr starters at
 * `balanced` lands in the 0.4–0.7 acceptance band.
 */
import type { Position, TradeConstants } from '@contracts/index'

export const tradeConstants: TradeConstants = {
  marginByStrictness: { lenient: -0.03, balanced: 0.05, strict: 0.15, ruthless: 0.3 },
  /**
   * The sigmoid scale is clamp(scaleShareOfDeal × max(valueIn, valueOut), scaleMin, scale). A fixed 12
   * pinned every deal between low-value assets near p = 0.5 whatever the ratio or the strictness: a
   * backup LB + a 7th for a 40-year-old starting QB read 55% on ruthless (DECISIONS 2026-09-28).
   */
  scale: 12,
  scaleShareOfDeal: 0.2,
  scaleMin: 1,
  /**
   * Phase 5B: a discount below 1 is free money for a patient user — scripts/qa/draftExploit.ts turned
   * seven of IND's 2016 picks into 2017 picks at p = 0.50 each and banked 157 chart points (half a
   * first) the moment the discount unwound. 0.92 halves that to 77 and still prices "next year" below
   * "this year"; 1.0 would close it completely at the cost of the flavour.
   */
  futurePickDiscount: 0.92,
  maxFirstsPerDeal: 2,
  annoyancePerLowball: 1,
  annoyanceMarginPerPoint: 0.02,
}

/** Age at which each position group stops gaining and starts costing value. */
const PEAK_AGE = {
  QB: 31,
  RB: 25,
  WR: 27,
  TE: 28,
  OL: 29,
  DL: 27,
  LB: 27,
  CB: 26,
  S: 27,
  K: 33,
  P: 33,
} satisfies Record<Position, number>

/**
 * What the trade market pays for a position group at equal rating. Quarterbacks are the only real
 * outlier; kickers and punters are nearly free.
 */
const POS_MULTIPLIER = {
  QB: 1.45,
  RB: 0.8,
  WR: 1.05,
  TE: 0.9,
  OL: 1.0,
  DL: 1.05,
  LB: 0.85,
  CB: 1.05,
  S: 0.85,
  K: 0.35,
  P: 0.3,
} satisfies Record<Position, number>

export const valueConstants = {
  peakAge: PEAK_AGE,
  posMultiplier: POS_MULTIPLIER,
  /** value = ((ovr − floor) / span)^exp × peakValue — the exponent is what makes 80+ steep. */
  ovrFloor: 45,
  ovrSpan: 50,
  ovrExp: 3.2,
  ovrPeakValue: 110,
  /** Share of (pot − ovr) folded into the rating the curve sees; fades to 0 by `potShareFlatAge`. */
  potShareMax: 0.6,
  potShareYoungAge: 21,
  potShareFlatAge: 29,
  declinePerYearPastPeak: 0.07,
  /** Quarterbacks age gracefully: at 0.07 a 40-year-old consensus-83 starter kept 37% of his talent. */
  declinePerYearPastPeakByPos: { QB: 0.04 } as Partial<Record<Position, number>>,
  declineFloor: 0.25,
  /** Value subtracted per 1% of the cap in APY, times a small surcharge per extra year owed. */
  costPerCapPct: 2.2,
  costExtraPerYear: 0.12,
  costMaxYears: 5,
  /**
   * Cost can take at most this share of talent. Uncapped, a starter on a market deal fell to the
   * `minPlayerValue` floor, level with a practice-squad body, so the AI dealt him for one.
   */
  maxCostShareOfTalent: 0.5,
  /** An albatross contract bottoms out at "worthless", never at "you owe me". */
  minPlayerValue: 0.25,
  injuryDiscountPerWeek: 0.035,
  injuryDiscountMax: 0.5,
}

/** Anti-exploit: fire sales don't work at last year's price, and the AI doesn't panic-sell either. */
export const dropConstants = {
  /** Consensus ovr lost since season start that counts as a sharp drop. */
  sharpDropPoints: 6,
  /** Extra haircut when the AI is being asked to BUY a player who just cratered. */
  buyExtraDiscount: 0.15,
  /** Floor, as a share of the player's season-start value, on what the AI will SELL one for. */
  sellFloorPct: 0.7,
}

/**
 * Rich Hill–style chart: far flatter at the top than Jimmy Johnson's, so hoarding firsts is not a
 * free exploit. Points at pick 1 = 1000; log-linear interpolation between anchors.
 */
export const pickConstants = {
  chart: [
    { pick: 1, points: 1000 },
    { pick: 5, points: 730 },
    { pick: 10, points: 570 },
    { pick: 16, points: 470 },
    { pick: 20, points: 430 },
    { pick: 26, points: 370 },
    { pick: 32, points: 320 },
    { pick: 40, points: 275 },
    { pick: 50, points: 225 },
    { pick: 64, points: 180 },
    { pick: 80, points: 140 },
    { pick: 100, points: 108 },
    { pick: 128, points: 78 },
    { pick: 160, points: 52 },
    { pick: 192, points: 34 },
    { pick: 224, points: 21 },
    { pick: 256, points: 12 },
  ] as const,
  /** Value units per 1000 chart points, i.e. pick #1 ≈ 95 — a shade under a proven superstar. */
  scalePerThousand: 95,
  tailDecayPerPick: 0.97,
  minChartPoints: 2,
  picksPerRound: 32,
  /** Rating-points equivalent of a full season of winning, when projecting an unsettled slot. */
  recordWeight: 12,
  recordRampGames: 8,
  replacementOvr: 45,
}

/**
 * Lineup-aware valuation, AI teams only (2026-10-05 playthrough: NE sold Tom Brady, its only starting
 * QB, for four players it then benched or cut and started Hoyer). Starters are the top
 * STARTER_TEMPLATE[pos] players at a position by consensus ovr.
 */
export const lineupConstants = {
  /**
   * Share of the starting lineup's talent drop (`slotTalent`, before age and contract) added to what
   * the AI gives up when a starter leaves. The rating curve is flat low and steep high, so this bites
   * for elite starters and barely registers for average ones or when a comparable starter comes back.
   */
  starterLossShare: 0.5,
  /** Share of his value an incoming player keeps when he would not crack the AI's lineup. */
  fillerShare: 0.5,
  /** Charges below this many value points are too small to mention in the evaluation's reasons. */
  reasonMinCharge: 1,
}

/**
 * Value by remaining control (2018 playthrough: 1-year free agents signed at the ask were flipped the
 * same day for 25–75 points, and their deals expired at the camp rollover weeks later). Seasons of
 * control follow the engine's real expiry (`fa.seasonsLeft`), not the `years` label: in the offseason
 * a deal signed before it has used up the season just played, one signed in it plays every year.
 */
export const controlConstants = {
  /** Share of full value carried by the 1st, 2nd and 3rd season of control; 3+ seasons = today's value. */
  seasonWeights: [0.6, 0.25, 0.15] as readonly number[],
  regularSeasonWeeks: 17,
  /** Share of a season still to play once the playoffs start. */
  playoffShare: 0.1,
  /**
   * An expiring player still on the roster at the next re-sign window carries re-signing rights, worth
   * this share of his value on a fresh market deal — so buying an expiring star cheap and re-signing
   * him at the ask is not free.
   */
  rightsShare: 0.6,
}

/** Players the user signed as free agents cannot be flipped straight away. */
export const tradeLockConstants = {
  /** An offseason or preseason signing is tradeable from this regular-season week. */
  offseasonUnlockWeek: 1,
  /** An in-season signing is tradeable this many weeks after he signed. */
  inSeasonLockWeeks: 4,
}

/**
 * Draft-slot anchor (QA M2, 2026-10-05): straight off the draft the rating model priced a first-rounder
 * at ~30% of the pick that took him (Mahomes 29.6 against a #10 slot worth 54), so selling picks before
 * the draft and buying the draftees after was a 3× arbitrage. A drafted player is worth at least
 * `slotShare` × his slot's chart value, fading by `decayByYear` as consensus catches up. Years count
 * from the draft: 0 for the offseason he was drafted in, 1 through his rookie season, 2 his second.
 */
export const rookieConstants = {
  slotShare: 0.8,
  decayByYear: [1, 0.6, 0.25] as readonly number[],
  /** Anchored rookies from these rounds are prospects, not bench filler, to a buying AI. */
  fillerExemptMaxRound: 2,
}

export const needConstants = {
  /** Consensus ovr a team wants from a starter; the shortfall below it is the need. */
  starterTarget: 72,
  /** Starters above target beyond the template count before a position reads as saturated. */
  saturatedSurplus: 2,
  topNeeds: 2,
  /** Fractions of the asset's own value. */
  topNeedBonusPct: 0.12,
  saturatedPenaltyPct: 0.1,
  losingNeedPenaltyPct: 0.08,
  /** needAdj can never dominate the deal. */
  capPct: 0.25,
}

export const acceptanceConstants = {
  inSeasonPhases: ['PRESEASON', 'REGULAR', 'PLAYOFFS'] as const,
  rosterInSeason: { min: 46, max: 53 },
  rosterOffseasonMax: 90,
  /**
   * Salary a team may take on beyond its cap room, as a share of the cap. Real teams manufacture
   * room with restructures and post-June-1 designations, and both the mock fixture and real
   * synthesized contracts leave plenty of teams nominally over — a zero-slack gate would make
   * in-season trading impossible instead of merely hard. Big contract dumps are still refused.
   */
  capSlackPct: 0.05,
  /** Annoyance stops biting past this many points of extra margin. */
  maxAnnoyanceMarginPct: 0.3,
  /** Receiving this much less than it gave is what the AI files as a lowball. */
  lowballGap: 0.1,
  maxAnnoyance: 10,
  /** The AI only counters when one more asset plausibly closes the gap. */
  counterMaxShortfallPct: 0.6,
  counterMinP: 0.5,
  counterCandidatesScanned: 6,
}

export const offerConstants = {
  countByFrequency: { rare: [0, 1], normal: [1, 2], aggressive: [2, 3] } satisfies Record<
    string,
    [number, number]
  >,
  draftOfferMax: 3,
  /** Prospects at the top of the board whose position defines "who wants this pick". */
  topProspectsConsidered: 3,
  /** The AI's own acceptance probability for an offer it makes. */
  minAiP: 0.5,
  /** What the AI is willing to pay, as a share of what it asks for. Above ~1.05 its own p drops
   *  below 0.5 unless the incoming player fills a top-2 need, so offers cluster just under par. */
  payRatioMin: 0.85,
  payRatioMax: 1.02,
  /** Plausibility band on (what the AI gives) / (what it asks), from the user's side. */
  bandMin: 0.85,
  bandMax: 1.4,
  maxAssetsPerSide: 3,
  candidatesScanned: 8,
}

/** Suggested trades (Phase 6): proactive AI-initiated deals that fill the user's top needs. */
export const suggestionConstants = {
  max: 4,
  perNeed: 2,
  /** Need positions considered, by consensus deficit. Deeper than needConstants.topNeeds so a team whose
   *  two worst spots are unfillable still gets a deal at its third. */
  needsConsidered: 3,
  /** Every team carries exactly one; nobody has a spare to deal. */
  skipPositions: ['K', 'P'] as readonly string[],
  candidatesScanned: 6,
  /** The user is never asked for a player worth more than the deal; a little slack for rounding. */
  askSlack: 1.05,
  /**
   * QA M10 (2026-10-05): day-1 suggestions asked MIA for Suh and Landry to "fill" a 0.04 OL need. A
   * need is a starting slot this many ovr below `needConstants.starterTarget`, and the incoming player
   * must beat the user's weakest starter there by `minUpgrade`.
   */
  minNeedDeficit: 2,
  minUpgrade: 3,
}
