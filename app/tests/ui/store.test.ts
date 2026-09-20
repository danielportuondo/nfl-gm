import {
  persistenceStub,
  TEAM_IDS,
  type LeagueState,
  type PersistenceModule,
  type SaveSlotMeta,
  type TradeProposal,
  type WeekReport,
} from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague } from '@fixtures/mockLeague'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

function fixtureProposal(state: LeagueState): TradeProposal {
  const aiTeamId = TEAM_IDS.find((t) => t !== state.userTeam)!
  return {
    id: 'fixture-offer-1',
    offer: { teamId: aiTeamId, players: [state.teams[aiTeamId]!.roster[0]!.playerId], picks: [] },
    request: {
      teamId: state.userTeam,
      players: [state.teams[state.userTeam]!.roster[0]!.playerId],
      picks: [],
    },
    initiatedBy: 'AI',
    season: state.season,
    week: state.week,
  }
}

const SAVED_META: SaveSlotMeta = {
  slot: 'default',
  userTeam: 'IND',
  season: 2015,
  week: 0,
  phase: 'PRESEASON',
  startSeason: 2015,
  horizonEnd: 2017,
  savedAt: '2026-09-20T00:00:00.000Z',
  schemaVersion: 1,
}

describe('updateSettings', () => {
  it('merges a partial change into the league settings', async () => {
    const base = mockLeague()
    const store = createGameStore({ mode: 'mock' })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
    })

    store.getState().actions.updateSettings({ tradeStrictness: 'ruthless' })

    expect(store.getState().state?.settings).toEqual({
      tradeStrictness: 'ruthless',
      aiOfferFrequency: 'normal',
      injuries: true,
    })
  })
})

describe('startOver', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the league and everything that hung off it, then shows the New Game screen', async () => {
    const base = mockLeague()
    const store = createGameStore({ mode: 'mock' })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const proposal = fixtureProposal(store.getState().state!)
    store.setState({
      selectedPlayerId: proposal.offer.players[0]!,
      tradeOffers: [proposal],
      suggestedTrades: [proposal],
      dismissedSuggestionIds: [proposal.id],
      alerts: ['Kansas City signed a kicker.'],
    })

    await store.getState().actions.startOver()

    const s = store.getState()
    expect(s.state).toBeNull()
    expect(s.screen).toBe('new-game')
    expect(s.selectedPlayerId).toBeNull()
    expect(s.tradeOffers).toEqual([])
    expect(s.suggestedTrades).toEqual([])
    expect(s.dismissedSuggestionIds).toEqual([])
    expect(s.alerts).toEqual([])
  })

  it('keeps the default save and offers it again as Continue', async () => {
    const remove = vi.fn(async () => {})
    const persistence: PersistenceModule = {
      ...persistenceStub,
      listSaves: async () => [SAVED_META],
      save: async () => SAVED_META,
      remove,
    }
    const store = createGameStore({ mode: 'engine', persistence })
    store.setState({ state: mockLeague(), savedGame: null })

    await store.getState().actions.startOver()

    expect(remove).not.toHaveBeenCalled()
    expect(store.getState().savedGame).toEqual(SAVED_META)
  })

  it('writes a pending debounced autosave before leaving, and nothing after', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (_slot: string, _state: LeagueState) => SAVED_META)
    const persistence: PersistenceModule = {
      ...persistenceStub,
      listSaves: async () => [SAVED_META],
      save,
      remove: async () => {},
    }
    const store = createGameStore({ mode: 'engine', persistence })
    const league = mockLeague()
    store.setState({ state: league })
    expect(save).not.toHaveBeenCalled()

    await store.getState().actions.startOver()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('default', league)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
