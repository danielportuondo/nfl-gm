import { SeasonNotLoadedError, type EngineContext, type Season } from '@contracts/index'
import { seasonStartOvr } from '@engine/trade/value'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { describe, expect, it } from 'vitest'
import { makeFakeContext } from '../fakes'

/** A context that, like the app and the scripts, throws for an in-history season that is not loaded. */
function strictContext(): EngineContext {
  const bundle = mockBundle({ season: 2015 })
  const ctx = makeFakeContext(bundle)
  return {
    ...ctx,
    seasonData: (season: Season) => {
      const chunk = bundle.seasons[season]
      if (chunk) return chunk
      throw new SeasonNotLoadedError(season)
    },
  }
}

describe('seasonStartOvr in the opening offseason', () => {
  it('is empty before the first season and never asks for the prior chunk', () => {
    const ctx = strictContext()
    const opening = {
      ...mockLeague({ season: 2015 }),
      season: 2014,
      startSeason: 2015,
      phase: 'DRAFT' as const,
    }
    expect(seasonStartOvr(opening, ctx).size).toBe(0)
  })

  it('still reads the season chunk once the season is under way', () => {
    const ctx = strictContext()
    expect(seasonStartOvr(mockLeague({ season: 2015 }), ctx).size).toBeGreaterThan(0)
  })
})
