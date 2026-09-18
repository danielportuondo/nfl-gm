/**
 * engine/rng — seeded PRNG (docs/HANDOFF.md §6.3 "Determinism"). Owned by league-engine (1C).
 *
 * ALL randomness in the engine flows through an Rng derived from `LeagueState.seed` plus a scope
 * (season, week, gameId, "draft", pick number…). Same seed + same inputs ⇒ identical league.
 * Math.random is forbidden under app/src/engine (lint).
 */
import { notImplemented } from './context'

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number
  /** Gaussian sample. */
  normal(mean: number, sd: number): number
  /** True with probability p. */
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T
  /** Returns a new shuffled array; does not mutate. */
  shuffle<T>(items: readonly T[]): T[]
  /** Deterministic child stream, independent of how many draws the parent has made. */
  fork(label: string | number): Rng
}

export interface RngModule {
  /** Build an Rng from the league seed and a scope, e.g. fromSeed(seed, 2015, 3, gameId). */
  fromSeed(seed: string, ...scope: (string | number)[]): Rng
  /** Stable 32-bit string hash (used for per-player deterministic noise, e.g. consensus jitter). */
  hash(input: string): number
}

export const rngStub: RngModule = {
  fromSeed: () => notImplemented('rng.fromSeed'),
  hash: () => notImplemented('rng.hash'),
}
