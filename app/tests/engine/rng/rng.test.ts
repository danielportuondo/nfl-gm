import { describe, expect, it } from 'vitest'
import { rng } from '@engine/rng'

describe('engine/rng determinism', () => {
  it('same seed + scope produces an identical sequence', () => {
    const a = rng.fromSeed('seed-1', 2015, 3, 'game-42')
    const b = rng.fromSeed('seed-1', 2015, 3, 'game-42')
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('different scope produces a different sequence', () => {
    const a = rng.fromSeed('seed-1', 2015, 3, 'game-42')
    const b = rng.fromSeed('seed-1', 2015, 4, 'game-42')
    expect(a.next()).not.toBe(b.next())
  })

  it('fork streams are independent of parent draw count', () => {
    const parentUndrawn = rng.fromSeed('seed-1', 'league')
    const forkFresh = parentUndrawn.fork('draft')

    const parentDrawn = rng.fromSeed('seed-1', 'league')
    for (let i = 0; i < 1000; i++) parentDrawn.next()
    const forkAfterDraws = parentDrawn.fork('draft')

    const seqFresh = Array.from({ length: 20 }, () => forkFresh.next())
    const seqAfter = Array.from({ length: 20 }, () => forkAfterDraws.next())
    expect(seqFresh).toEqual(seqAfter)
  })

  it('normal(0,1) over 20k draws has mean and sd close to spec', () => {
    const r = rng.fromSeed('seed-normal')
    const n = 20000
    const samples = Array.from({ length: n }, () => r.normal(0, 1))
    const mean = samples.reduce((s, x) => s + x, 0) / n
    const variance = samples.reduce((s, x) => s + (x - mean) ** 2, 0) / n
    const sd = Math.sqrt(variance)
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(Math.abs(sd - 1)).toBeLessThan(0.03)
  })

  it('int(min,max) is inclusive on both bounds', () => {
    const r = rng.fromSeed('seed-int')
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 5))
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it('hash is a stable 32-bit non-negative integer', () => {
    const h1 = rng.hash('hello')
    const h2 = rng.hash('hello')
    expect(h1).toBe(h2)
    expect(Number.isInteger(h1)).toBe(true)
    expect(h1).toBeGreaterThanOrEqual(0)
    expect(rng.hash('world')).not.toBe(h1)
  })
})
