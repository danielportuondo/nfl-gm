/**
 * engine/lifecycle tunables (docs/HANDOFF.md §6.7). Kept out of the logic so the Phase 5 balance pass
 * can retune without touching behavior. Every constant here that is NOT sourced from `curves.json` /
 * `injuryModel.json` is a documented assumption — see the comment on each.
 */

/** Fallback aging σ when a position is missing from curves.aging (should not happen with real data). */
export const DEFAULT_AGING_SD = 4

/**
 * `curves.retirement[pos].byAge` is defined "at position-mean value" (DATA_CONTRACT). The data files
 * do not export that mean, so we assume a single position-agnostic baseline on the shared 40–99 scale.
 * ASSUMPTION — flagged as a CONTRACT REQUEST (curves could export a per-position mean value instead).
 */
export const RETIREMENT_VALUE_BASELINE = 65

/** Clamp for the logistic transform so p=0 or p=1 in the fitted curve never yields ±Infinity in logit space. */
export const RETIREMENT_PROB_EPSILON = 1e-4

// --- refreshScouting (post-history / procedural noisy view of truth) --------------------------

/** Base σ of veteran ovr noise vs. the prior season's true value, before experience shrinkage. */
export const VETERAN_OVR_NOISE_BASE_SD = 2.5
/** Noise floor so very experienced veterans still have *some* scouting uncertainty. */
export const VETERAN_OVR_NOISE_MIN_SD = 0.5

export const CONFIDENCE_BASE = 0.3
export const CONFIDENCE_PER_SEASON = 0.08
export const CONFIDENCE_MAX = 0.95

/** Scales the pick→pedigree pot bump (slotGrade.pot at the player's pick vs. the last-round baseline). */
export const PEDIGREE_BUMP_SCALE = 0.1
export const PEDIGREE_BUMP_MAX = 3
/** Reference "last pick" used as the zero-pedigree baseline for the bump above. */
export const PEDIGREE_BASELINE_PICK = 224

// --- generateDraftClass -------------------------------------------------------------------------

/** Class size jitter around curves.classSize (real classes vary a little year to year). */
export const CLASS_SIZE_JITTER = 8

/** Fraction of slotGrade.sd applied as consensus noise per drafted prospect (ovr and pot independently).
 * Full sd over-disperses the class-wide pot quantiles vs. any single real class (see lifecycle report);
 * this fraction was chosen by comparing against several real classes. */
export const DRAFT_SLOT_NOISE_SCALE = 0.2
export const UDFA_POT_NOISE_SD = 1

export const ROOKIE_CONFIDENCE_DRAFTED = 0.25
export const ROOKIE_CONFIDENCE_UDFA = 0.15

/** Assumed quantile levels for curves.udfaGrade.potQuantiles — the schema does not pin them down;
 * mirrors OutcomeTableSchema.quantiles' convention. CONTRACT REQUEST: pin these down explicitly. */
export const UDFA_POT_QUANTILE_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9] as const

/** Rookie age range (college seniors/underclassmen), matching the fixture's convention. */
export const ROOKIE_AGE_MIN = 20
export const ROOKIE_AGE_MAX = 23

/** Per-year noise added on top of the interpolated outcome-quantile trajectory. */
export const OUTCOME_YEAR_NOISE_SD = 1.5
/** A "bust" (rolled against bustRate) samples its career percentile from the bottom of the outcome
 * distribution and leaves the league within this many years (§6.2 "out of league by year 4"). */
export const BUST_PERCENTILE_CAP = 0.3
export const BUST_MAX_CAREER_YEARS = 4

// --- tickInjuries (permanent loss) --------------------------------------------------------------

/** Guard: an injury reappearing after a season boundary (no weekly ticks over the offseason) is
 * treated as long regardless of the calendar gap. */
export const CROSS_SEASON_INJURY_IS_LONG = true
