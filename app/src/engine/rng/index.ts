/**
 * engine/rng — seeded PRNG (docs/HANDOFF.md §6.3 "Determinism"). Implements RngModule (contracts/engine/rng.ts).
 *
 * Every Rng is a pure function of a "stream key" string (seed + scope joined). `fork` derives a child
 * stream key by appending the label, so a fork's sequence never depends on how many draws its parent
 * has already made — only on the seed, the scope, and the fork label.
 */
import type { Rng, RngModule } from '@contracts/index'

/** FNV-1a 32-bit hash. Stable across platforms (no reliance on Number precision beyond 32 bits). */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, decent-quality 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRng(streamKey: string): Rng {
  const draw = mulberry32(fnv1a(streamKey))

  const next = (): number => draw()

  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`rng.int: max (${max}) < min (${min})`)
    return min + Math.floor(next() * (max - min + 1))
  }

  const normal = (mean: number, sd: number): number => {
    let u = 0
    let v = 0
    while (u === 0) u = next()
    while (v === 0) v = next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  const chance = (p: number): boolean => next() < p

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('rng.pick: empty array')
    return items[int(0, items.length - 1)]!
  }

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i)
      const tmp = out[i]!
      out[i] = out[j]!
      out[j] = tmp
    }
    return out
  }

  const fork = (label: string | number): Rng => makeRng(`${streamKey}/fork:${label}`)

  return { next, int, normal, chance, pick, shuffle, fork }
}

export const rng: RngModule = {
  fromSeed: (seed, ...scope) => makeRng([seed, ...scope.map(String)].join(':')),
  hash: (input) => fnv1a(input),
}
