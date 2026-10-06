/**
 * QA M2 (2026-10-05): straight off the 2017 draft a first-rounder was worth ~30% of the pick that took
 * him, so selling picks before the draft and buying the draftees after was a 3× arbitrage. A draftee
 * is now anchored to his slot's chart value and the anchor fades over his first two seasons.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, PlayerId } from '@contracts/index'
import { trade } from '@engine/trade'
import { pickConstants } from '@engine/trade/constants'
import { chartPoints, rookieSlotAnchor } from '@engine/trade/value'
import { loadRealContext } from '../../../scripts/lib/publicData'

const SETTINGS = {
  tradeStrictness: 'balanced' as const,
  aiOfferFrequency: 'normal' as const,
  injuries: true,
}

describe('trade — draftees are worth most of their slot (real 2017 draft)', () => {
  let ctx: EngineContext
  let state: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext([2017, 2018, 2019])
    const opening = ctx.modules.league.newGame(
      {
        seed: 'rookies',
        startSeason: 2017,
        userTeam: 'MIA',
        horizonSeasons: 3,
        settings: SETTINGS,
      },
      ctx,
    )
    state = ctx.modules.draft.autoDraftToEnd(ctx.modules.draft.startDraft(opening, ctx), ctx)
  }, 60000)

  const slotValue = (pick: number) => chartPoints(pick) * (pickConstants.scalePerThousand / 1000)

  function meanRatio(from: number, to: number): number {
    const ratios = Object.values(state.players)
      .filter((p) => p.draft?.season === 2017 && p.draft.pick >= from && p.draft.pick <= to)
      .map((p) => trade.playerValue(state, p.id, ctx) / slotValue(p.draft!.pick))
    expect(ratios.length).toBeGreaterThanOrEqual(8)
    return ratios.reduce((s, r) => s + r, 0) / ratios.length
  }

  it('rounds 1–2 land at 70–90% of the slot, later rounds at 60–100%', () => {
    for (const [from, to] of [
      [1, 10],
      [11, 32],
      [33, 64],
    ] as const) {
      const ratio = meanRatio(from, to)
      expect(ratio, `picks ${from}–${to}`).toBeGreaterThanOrEqual(0.7)
      expect(ratio, `picks ${from}–${to}`).toBeLessThanOrEqual(0.9)
    }
    for (const [from, to] of [
      [65, 128],
      [129, 256],
    ] as const) {
      const ratio = meanRatio(from, to)
      expect(ratio, `picks ${from}–${to}`).toBeGreaterThanOrEqual(0.6)
      expect(ratio, `picks ${from}–${to}`).toBeLessThanOrEqual(1)
    }
  })

  it('the anchor fades over the first two seasons and is gone by the third', () => {
    const mahomes = Object.values(state.players).find((p) => p.name === 'Patrick Mahomes')!.id
    const later = (years: number): LeagueState => ({ ...state, season: state.season + years })
    const anchors = [0, 1, 2, 3].map((years) => rookieSlotAnchor(later(years), mahomes))
    expect(anchors[0]).toBeGreaterThan(anchors[1]!)
    expect(anchors[1]).toBeGreaterThan(anchors[2]!)
    expect(anchors[3]).toBe(0)
  })

  it('control: a fourth-year first-rounder is valued exactly as if undrafted', () => {
    const veteran: PlayerId = Object.values(state.players)
      .filter((p) => p.draft?.season === 2014 && p.draft.round === 1)
      .map((p) => p.id)
      .find((id) => state.scouting[id] !== undefined)!
    const undrafted: LeagueState = {
      ...state,
      players: { ...state.players, [veteran]: { ...state.players[veteran]!, draft: null } },
    }
    expect(trade.playerValue(state, veteran, ctx)).toBe(trade.playerValue(undrafted, veteran, ctx))
  })
})
