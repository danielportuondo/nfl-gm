/**
 * §6.4: "The AI never reads truth. Enforced by import lint." Belt to that suspender — only the one
 * function that seeds a real prospect's hidden career may name truth or trajectories at all.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { draft } from '@engine/draft'
import { draftContext, stateAtDraft } from './fixture'

const dir = fileURLToPath(new URL('../../../src/engine/draft/', import.meta.url))
const TRUTH_OWNER = 'prospects.ts'
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('engine/draft hidden-data isolation', () => {
  it('only prospects.ts mentions truth or trajectories', () => {
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== TRUTH_OWNER)
      .filter((f) => {
        const code = stripComments(readFileSync(dir + f, 'utf8'))
        return (
          /\.truth\b/.test(code) || /\btrajectories\b/.test(code) || /\bTrueTrajectory\b/.test(code)
        )
      })
    expect(offenders).toEqual([])
  })

  it('loadProspects is idempotent and startDraft loads the class itself', async () => {
    const ctx = await draftContext()
    const base = stateAtDraft(ctx, 'IND')
    const once = draft.loadProspects(base, ctx)
    const twice = draft.loadProspects(once, ctx)
    expect(Object.keys(once.players).length).toBeGreaterThan(Object.keys(base.players).length)
    expect(twice.players).toBe(once.players)

    // startDraft on a state that never called loadProspects still finds a full board.
    const started = draft.startDraft(base, ctx)
    expect(started.draftRoom!.available.length).toBeGreaterThan(started.draftRoom!.order.length)
    expect(started.draftRoom!.season).toBe(base.season + 1)
  })

  it('gives every loaded prospect a hidden career and an empty draft origin', async () => {
    const ctx = await draftContext()
    const loaded = draft.loadProspects(stateAtDraft(ctx, 'IND'), ctx)
    for (const prospect of ctx.seasonData(2014)!.draft.prospects) {
      expect(loaded.players[prospect.id], prospect.id).toBeDefined()
      expect(loaded.players[prospect.id]!.draft, prospect.id).toBeNull()
      expect(loaded.scouting[prospect.id], prospect.id).toEqual(prospect.scouting)
      expect(Object.keys(loaded.truth[prospect.id]!.bySeason).length, prospect.id).toBeGreaterThan(
        0,
      )
    }
  })
})
