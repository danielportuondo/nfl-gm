/**
 * Procedural names for generated players — always from curves.names, never a real name (HANDOFF §6.7,
 * data ethics). `curves.names` is pipeline-curated to exclude real players' names.
 */
import type { CurvesFile, Rng } from '@contracts/index'

export function generateName(curves: CurvesFile, rng: Rng, id: string): string {
  const first = rng.fork(`${id}:first`).pick(curves.names.first)
  const last = rng.fork(`${id}:last`).pick(curves.names.last)
  return `${first} ${last}`
}
