/**
 * engine/draft tunables (HANDOFF §6.4). Balance pass (Phase 5) edits this file, never the logic.
 */
import { POSITIONS, type Position } from '@contracts/index'

const importance = (overrides: Partial<Record<Position, number>>): Record<Position, number> =>
  Object.fromEntries(POSITIONS.map((p) => [p, overrides[p] ?? 1])) as Record<Position, number>

export interface DraftConstants {
  rounds: number
  /** Picks per round in a generated (post-history) order. */
  picksPerRound: number
  /** How deep into the board the need-aware fallback looks. Keeps AI picks plausible. */
  candidateWindow: number
  /** P(ignore need entirely and take the top of the board) — §6.4 step 2. */
  bestAvailableChance: number
  /** needWeight = 1 + needScale × need × posImportance. */
  needScale: number
  /** σ of the multiplicative noise on the fallback score. */
  noiseSd: number
  /** ageAdj = 1 − agePenalty × max(0, age − ageBaseline). */
  ageBaseline: number
  agePenalty: number
  /** Consensus ovr credited to a starter slot with nobody in it. */
  replacementOvr: number
  /** Starter quality below `starterBar` is a hole; `starterSpan` scales it to 0–1. */
  starterBar: number
  starterSpan: number
  /** need = qualityWeight × qualityHole + bodyWeight × missingBodies/starters, clamped to 0–1. */
  qualityWeight: number
  bodyWeight: number
  /** Saturated = depth ≥ starters + satExtra AND starter quality ≥ satQuality. */
  satExtraMin: number
  satExtraFraction: number
  satQuality: number
  /** needWeight multiplier for a saturated position: the AI can still take a steal, rarely. */
  satPenalty: number
  /**
   * Saturation only overrides the historical pick this early. A day-three pick is depth or a lottery
   * ticket, so a stacked position is no reason to rewrite history; a first-rounder there would look
   * absurd, which is exactly what §6.4 asks the fallback to prevent.
   */
  anchorVetoMaxRound: number
  /** NeedProfile.top: positions with need ≥ topMin, at most topCount, never saturated. */
  topMin: number
  topCount: number
  /** Scales need's contribution per position; K/P should not outrank a premium position. */
  posImportance: Record<Position, number>
  /** UDFA phase: after anchored signings, teams fill to this roster size from the pool. */
  udfaFillTo: number
  /** Hard offseason roster ceiling. */
  rosterMax: number
}

export const draftConstants: DraftConstants = {
  rounds: 7,
  picksPerRound: 32,
  candidateWindow: 40,
  bestAvailableChance: 0.1,
  needScale: 0.35,
  noiseSd: 0.04,
  ageBaseline: 22,
  agePenalty: 0.02,
  replacementOvr: 45,
  starterBar: 72,
  starterSpan: 22,
  qualityWeight: 0.7,
  bodyWeight: 0.3,
  satExtraMin: 2,
  satExtraFraction: 0.5,
  satQuality: 80,
  satPenalty: 0.8,
  anchorVetoMaxRound: 2,
  topMin: 0.15,
  topCount: 3,
  posImportance: importance({ QB: 1.3, DL: 1.1, OL: 1.1, CB: 1.05, K: 0.35, P: 0.3 }),
  udfaFillTo: 70,
  rosterMax: 90,
}
