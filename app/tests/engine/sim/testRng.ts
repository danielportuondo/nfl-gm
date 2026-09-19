/**
 * A minimal seeded Rng for sim tests and the calibration harness. engine/rng (1C) is built in
 * parallel; sim only ever takes an Rng as a parameter, so this stands in until Phase 2 swaps it.
 */
import type { Rng, RngModule } from '@contracts/index'

export function hash(input: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619)
  }
  h ^= h >>> 15
  return h >>> 0
}

class TestRng implements Rng {
  private state: number

  constructor(private readonly seed: number) {
    this.state = seed >>> 0
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  normal(mean: number, sd: number): number {
    const u = 1 - this.next()
    const v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]!
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      const tmp = out[i]!
      out[i] = out[j]!
      out[j] = tmp
    }
    return out
  }

  fork(label: string | number): Rng {
    return new TestRng(hash(`${this.seed}:${label}`))
  }
}

export const testRng: RngModule = {
  fromSeed: (seed: string, ...scope: (string | number)[]) =>
    new TestRng(hash([seed, ...scope].join('|'))),
  hash,
}
