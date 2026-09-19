import type { LeagueState, WeekReport } from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague } from '@fixtures/mockLeague'
import { describe, expect, it } from 'vitest'

/**
 * Regression for docs/HANDOFF.md Phase 5A brief item 6: Season Recap must appear "when the phase
 * leaves PLAYOFFS", including when the user fast-forwards with "Sim season" and the whole
 * REGULAR -> PLAYOFFS -> OFFSEASON_RESIGN run happens inside one store call. `simSeason` used to
 * compare only the state from before the whole run to the final state, so a mid-run PLAYOFFS exit
 * was invisible to the by-week check and the auto-navigation never fired.
 */
describe('simSeason auto-navigation', () => {
  it('routes to Season Recap the moment a fast-forwarded run crosses out of PLAYOFFS', async () => {
    const base = mockLeague()
    const steps: LeagueState[] = [
      { ...base, phase: 'PLAYOFFS' },
      { ...base, phase: 'OFFSEASON_RESIGN' },
    ]
    let call = 0
    const fakeSimWeek = (state: LeagueState): WeekReport => {
      const next = steps[call] ?? state
      call += 1
      return { state: next, events: [], gamesPlayed: 0 }
    }

    const store = createGameStore({
      mode: 'mock',
      modules: { league: { ...defaultEngineModules.league, simWeek: fakeSimWeek } },
    })

    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({ state: { ...s.state!, phase: 'REGULAR' } }))

    await store.getState().actions.simSeason()

    expect(store.getState().screen).toBe('season-recap')
    expect(store.getState().state?.phase).toBe('OFFSEASON_RESIGN')
  })
})
