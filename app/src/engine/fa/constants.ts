/**
 * Tunables for engine/fa (§6.6). All money in $M, all percentages as shares of the season cap.
 *
 * The market curve isn't fit against the contracts data with real regression tooling (out of scope for
 * this pass); it's a hand-shaped curve calibrated by eye against known 2012–2023 APY-as-%-of-cap
 * benchmarks (elite QBs ~15–20% of cap, elite non-QB pass rushers/CBs ~12–18%, RBs and specialists far
 * less). `positionMultiplier` and the age-decline knobs are the documented assumption the brief asks for;
 * qa-balance (Phase 5) is expected to retune these against real payroll distributions.
 */
import type { Position } from '@contracts/index'

export const faConstants = {
  /** Minimum contract as a share of the cap (≈ league minimum). */
  minCapPct: 0.003,
  /** Ceiling on any single synthesized contract, as a share of the cap. */
  maxCapPct: 0.28,
  /** capPct(ovr) = ((ovr − floor) / span)^exp × top — steep, so only elite players cost real money. */
  valueFloor: 55,
  valueSpan: 44,
  /**
   * Phase 5B measured this curve at 73–77 % of the cap in league mean payroll (real NFL is 95–100 %).
   * 2.1 lifts it to 84–87 % and 2.1 + topCapPct 0.20 to 92–94 %, but a 2023-era team whose real
   * contracts already fill the cap then has zero room: SEA's 2024 cutdown went from $8.3M to $37.7M
   * of dead money and its free-agency budget to $0. Left at 2.4 pending a call from the orchestrator;
   * the full sweep is in scripts/qa/REPORT.md (`pnpm exec tsx scripts/qa/faSweep.ts`).
   */
  valueExp: 2.4,
  topCapPct: 0.16,
  /** Relative market price by position at equal ovr (QB premium, RB/specialist discount). */
  positionMultiplier: {
    QB: 1.4, RB: 0.55, WR: 0.95, TE: 0.7, OL: 0.85, DL: 1.0, LB: 0.75, CB: 0.9, S: 0.65, K: 0.35, P: 0.3,
  } as Record<Position, number>,
  /** Age a position typically peaks at (mirrors HANDOFF §6.7's curve description). */
  peakAge: {
    QB: 31, RB: 25, WR: 27, TE: 28, OL: 29, DL: 27, LB: 27, CB: 26, S: 27, K: 33, P: 33,
  } as Record<Position, number>,
  /** Years past peak before the market starts discounting a veteran's price. */
  declineGraceYears: 3,
  /** Per-year price decay multiplier once past peak + grace. */
  declinePerYear: 0.85,
  /** RBs get cut off harder once past their (already-early) decline point. */
  rbDeclinePerYear: 0.72,
  /** Synthesized veteran length by age when no hint is given — younger players get longer deals. */
  yearsByAge: [
    { maxAge: 24, years: 5 },
    { maxAge: 27, years: 4 },
    { maxAge: 30, years: 3 },
    { maxAge: 33, years: 2 },
  ],
  defaultYears: 1,
  /** Cap on a default (hint-less) synthesized veteran deal; explicit hints may still reach the schema max. */
  maxYears: 5,
  /** Contract.years schema bound (see contracts/schemas.ts ContractSchema). */
  contractYearsSchemaMax: 7,
  veteranGuaranteedPct: 0.5,
  udfaGuaranteedPct: 0.1,
  rookieContractYears: 4,
  udfaContractYears: 3,
  /**
   * Rookie scale: pct(overallPick) = max(minCapPct, topPct * exp(-decay * (pick - 1))). The 2011 CBA
   * halved the top of the scale (Bradford 2010 ≈ 10% of cap; Luck 2012 ≈ 4.6%), so the top depends on
   * the draft year.
   */
  rookieScale: { topPct: 0.1, topPctFromCbaSeason: 0.047, cbaSeason: 2011, decay: 0.045 },
  /** Share of a rookie deal that is guaranteed, by round; late picks are cheap to cut (5B, dead-money finding). */
  rookieGuaranteedPctByRound: [1, 1, 0.6, 0.35, 0.2, 0.1, 0.1],
  /** Re-sign ask = marketApy × (1 ± jitter), seeded per player. */
  resignAskJitter: 0.1,
  gameRoster: { min: 46, max: 53 },
  offseasonRosterMax: 90,
  /** Release: dead money = this share of remaining guaranteed money (apy × years × guaranteedPct). */
  deadMoneyPct: 0.25,
  /**
   * Free-agent bidding curve (§6.6 "user signs at ask"). p = sigmoid(askSlope × (offer/ask − 1) +
   * atAskBias + qualityWeight × (teamQuality − 0.5)).
   *
   * Phase 5B measured the shipped curve (slope 3, no bias) at p = 0.48 for an offer at the ask from an
   * average team — the brief wants 0.7–0.8. `atAskBias` 1.1 puts an at-ask offer at 0.75, and the
   * steeper `askSlope` keeps a 15 % lowball at 0.48 so the ask still means something.
   *
   * NOT YET READ BY fa/index.ts — `acceptProbability` still hard-codes `3 * (ratio - 1) + (quality -
   * 0.5)`. See CONTRACT REQUESTS in scripts/qa/REPORT.md for the two-line change that consumes this.
   */
  acceptance: { askSlope: 8, atAskBias: 1.1, qualityWeight: 1 },
  /** Value/need fallback (no history anchor) re-sign threshold and base willingness. */
  aiResignOvrThreshold: 62,
  aiResignBaseChance: 0.55,
}
