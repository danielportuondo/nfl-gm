/** Tunables for the Phase 2 fa scaffold; fa-cap (3C) replaces these with the fitted market tables (§6.6). */
export const faConstants = {
  /** Minimum contract as a share of the cap (≈ league minimum). */
  minCapPct: 0.003,
  /** capPct(ovr) = ((ovr − floor) / span)^exp × top — a steep curve so only elite players cost real money. */
  valueFloor: 55,
  valueSpan: 44,
  valueExp: 2.4,
  topCapPct: 0.16,
  /** Synthesized veteran length by age when the roster hint has none. */
  yearsByAge: [
    { maxAge: 26, years: 3 },
    { maxAge: 30, years: 2 },
  ],
  defaultYears: 1,
  maxYears: 5,
  veteranGuaranteedPct: 0.5,
  rookieContractYears: 4,
  gameRoster: { min: 46, max: 53 },
  offseasonRosterMax: 90,
}
