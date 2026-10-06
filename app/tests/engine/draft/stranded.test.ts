/**
 * QA 2018 M1: an anchor vetoed for saturation in rounds 1–2 used to be stranded for good — every later
 * slot took its own anchor, and the need-aware fallback only ran where a slot's anchor was gone, so
 * real first- and second-rounders fell to day three or out of the draft. Sim-order drafts (every draft
 * after the opening one) must bring them back into contention without loosening history anchoring.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState } from '@contracts/index'
import { draft } from '@engine/draft'
import { AARON_DONALD, draftContext, stateAtDraft } from './fixture'
import { classContext, realPickOf, simOrderDraft } from './simFixture'

const CLASSES = [2018, 2019, 2020] as const
const SEEDS = ['a', 'b', 'c'] as const

interface Run {
  season: number
  seed: string
  done: LeagueState
  real: Map<string, number>
  simPick: Map<string, number>
}

function within(run: Run, n: number): number {
  const log = run.done.draftRoom!.log
  const near = log.filter((e) => {
    const realPick = run.real.get(e.playerId)
    return realPick !== undefined && Math.abs(realPick - e.pick) <= n
  })
  return near.length / log.length
}

describe('sim-order drafts bring vetoed anchors back', () => {
  const runs: Run[] = []

  beforeAll(async () => {
    for (const season of CLASSES) {
      const ctx: EngineContext = await classContext(season)
      for (const seed of SEEDS) {
        const done = draft.autoDraftToEnd(
          draft.startDraft(simOrderDraft(ctx, season, seed), ctx),
          ctx,
        )
        runs.push({
          season,
          seed,
          done,
          real: realPickOf(ctx, season),
          simPick: new Map(done.draftRoom!.log.map((e) => [e.playerId, e.pick])),
        })
      }
    }
  }, 300_000)

  it('drafts every real top-64 prospect by about pick 96', () => {
    for (const run of runs) {
      for (const [id, realPick] of run.real) {
        if (realPick > 64) continue
        const name = run.done.players[id]?.name ?? id
        expect(
          run.simPick.get(id),
          `${run.season}/${run.seed} ${name} (real #${realPick})`,
        ).toBeLessThanOrEqual(96)
      }
    }
  })

  it('takes Nick Chubb (real #35) in round 2 or 3', () => {
    for (const run of runs.filter((r) => r.season === 2018)) {
      const chubb = Object.keys(run.done.players).find(
        (id) => run.done.players[id]!.name === 'Nick Chubb' && run.real.has(id),
      )!
      const entry = run.done.draftRoom!.log.find((e) => e.playerId === chubb)
      expect(entry?.round, run.seed).toBeGreaterThanOrEqual(2)
      expect(entry?.round, run.seed).toBeLessThanOrEqual(3)
    }
  })

  it('keeps history anchoring strong', () => {
    for (const run of runs) {
      const log = run.done.draftRoom!.log
      const label = `${run.season}/${run.seed}`
      expect(log.filter((e) => e.historical).length / log.length, label).toBeGreaterThanOrEqual(
        0.86,
      )
      expect(within(run, 8), label).toBeGreaterThanOrEqual(0.97)
    }
  })
})

/** Fingerprints recorded before the M1 change: the opening draft keeps its old picks exactly. */
describe('opening draft unchanged', () => {
  const fingerprint = (state: LeagueState): string => {
    let h = 0
    for (const e of state.draftRoom!.log) {
      for (const ch of `${e.pick}:${e.team}:${e.playerId};`) h = (h * 31 + ch.charCodeAt(0)) | 0
    }
    return (h >>> 0).toString(16)
  }

  it('reproduces the 2014 redraft and the Aaron Donald at #1 draft pick for pick', async () => {
    const ctx = await draftContext()
    const redraft = draft.autoDraftToEnd(draft.startDraft(stateAtDraft(ctx, 'IND'), ctx), ctx)
    const started = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    const donald = draft.autoDraftToEnd(draft.userPick(started, AARON_DONALD, ctx), ctx)
    expect([fingerprint(redraft), fingerprint(donald)]).toEqual(OPENING_FINGERPRINTS)
  })
})

const OPENING_FINGERPRINTS = ['5a6ce791', 'a28ac26d']
