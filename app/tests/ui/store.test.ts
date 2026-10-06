import {
  NotImplementedError,
  persistenceStub,
  TEAM_IDS,
  type CutdownPlan,
  type DraftRoomState,
  type LeagueState,
  type PersistenceModule,
  type PlayerId,
  type SaveSlotMeta,
  type TeamId,
  type TradeProposal,
  type WeekReport,
} from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { MemoryDataSource } from '@data/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function until(pred: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

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

/** Fake fa.release that actually removes the roster slot, so releaseMany's loop is observable. */
function fakeRosterRelease(state: LeagueState, teamId: TeamId, playerId: PlayerId): LeagueState {
  const team = state.teams[teamId]!
  return {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: { ...team, roster: team.roster.filter((s) => s.playerId !== playerId) },
    },
  }
}

describe('releaseMany', () => {
  it('releases every id, leaves exactly one toast, and sets state once', async () => {
    const base = mockLeague()
    const idsToCut = base.teams[base.userTeam]!.roster.slice(0, 2).map((s) => s.playerId)
    const release = vi.fn(fakeRosterRelease)
    const store = createGameStore({
      mode: 'mock',
      modules: { fa: { ...defaultEngineModules.fa, release } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })

    // "Sets state once at the end": the league state reference should change exactly once, distinct
    // from the busy-flag toggles around the call (which replace `.busy`, not `.state`).
    let stateChanges = 0
    let prevState = store.getState().state
    const unsubscribe = store.subscribe((s) => {
      if (s.state !== prevState) {
        stateChanges += 1
        prevState = s.state
      }
    })

    await store.getState().actions.releaseMany(idsToCut)
    unsubscribe()

    expect(release).toHaveBeenCalledTimes(2)
    const rosterAfter = store.getState().state!.teams[base.userTeam]!.roster
    expect(rosterAfter.some((s) => idsToCut.includes(s.playerId))).toBe(false)
    expect(stateChanges).toBe(1)

    expect(store.getState().toasts).toHaveLength(1)
    expect(store.getState().toasts[0]?.text).toBe('Released 2 players')
  })

  it('uses the singular label for one release', async () => {
    const base = mockLeague()
    const id = base.teams[base.userTeam]!.roster[0]!.playerId
    const store = createGameStore({
      mode: 'mock',
      modules: { fa: { ...defaultEngineModules.fa, release: fakeRosterRelease } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })

    await store.getState().actions.releaseMany([id])

    expect(store.getState().toasts).toHaveLength(1)
    expect(store.getState().toasts[0]?.text).toBe('Released 1 player')
  })
})

describe("the user's depth chart follows roster moves", () => {
  it('drops a released player and adds a signing right away', async () => {
    const base = mockLeague()
    const offer = (state: LeagueState, teamId: TeamId, playerId: PlayerId) => {
      const team = state.teams[teamId]!
      const slot = { ...team.roster[0]!, playerId }
      return {
        accepted: true,
        state: {
          ...state,
          teams: { ...state.teams, [teamId]: { ...team, roster: [...team.roster, slot] } },
          freeAgents: state.freeAgents.filter((id) => id !== playerId),
        },
      }
    }
    const store = createGameStore({
      mode: 'mock',
      modules: {
        fa: { ...defaultEngineModules.fa, release: fakeRosterRelease, offer: offer as never },
      },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const league = store.getState().state!
    const user = league.teams[league.userTeam]!
    const cut = user.roster[0]!.playerId
    const signee = league.freeAgents[0]!
    const signeePos = league.players[signee]!.pos

    await store.getState().actions.release(cut)
    const afterCut = store.getState().state!.teams[league.userTeam]!.depthChart
    expect(Object.values(afterCut).flat()).not.toContain(cut)

    await store.getState().actions.offerContract(signee, user.roster[0]!.contract)
    const afterSign = store.getState().state!.teams[league.userTeam]!.depthChart
    expect(afterSign[signeePos]).toContain(signee)
  })
})

describe('exportSave', () => {
  it('is a no-op without state', () => {
    const store = createGameStore({ mode: 'mock' })
    expect(store.getState().actions.exportSave()).toBeUndefined()
  })

  it('returns the persistence JSON and a file name built from the team and season', async () => {
    const base = mockLeague()
    const exportJson = vi.fn(() => '{"a":1}')
    const persistence: PersistenceModule = { ...persistenceStub, exportJson }
    const store = createGameStore({ mode: 'engine', persistence })
    store.setState({ state: base })

    const result = store.getState().actions.exportSave()

    expect(exportJson).toHaveBeenCalledWith(base)
    expect(result?.json).toBe('{"a":1}')
    expect(result?.fileName).toMatch(/^gridiron-gm-[a-z]+-\d{4}-w\d+\.json$/)
  })
})

describe('importSave', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('toasts an error and leaves everything untouched on a bad file', async () => {
    const base = mockLeague()
    const importJson = vi.fn(() => {
      throw new Error('not a save file')
    })
    const save = vi.fn(async () => SAVED_META)
    const persistence: PersistenceModule = { ...persistenceStub, importJson, save }
    const store = createGameStore({ mode: 'engine', persistence })
    const proposal = fixtureProposal(base)
    store.setState({ state: base, tradeOffers: [proposal], screen: 'settings' })

    await store.getState().actions.importSave('not json')

    expect(store.getState().state).toBe(base)
    expect(store.getState().tradeOffers).toEqual([proposal])
    expect(store.getState().screen).toBe('settings')
    expect(save).not.toHaveBeenCalled()
    const toast = store.getState().toasts.at(-1)
    expect(toast?.tone).toBe('error')
    expect(toast?.text).toBe('Could not import the save file: not a save file')
  })

  it('sets state, clears derived slices, saves, and routes to dashboard for an in-progress league', async () => {
    const base = mockLeague()
    const imported: LeagueState = { ...mockLeague({ season: 2018 }), outcome: 'IN_PROGRESS' }
    const importJson = vi.fn(() => imported)
    const calls: string[] = []
    const save = vi.fn(async (_slot: string, state: LeagueState) => {
      calls.push('save')
      expect(state).toBe(imported)
      return SAVED_META
    })
    const persistence: PersistenceModule = { ...persistenceStub, importJson, save }
    const store = createGameStore({ mode: 'engine', persistence })
    const proposal = fixtureProposal(base)
    store.setState({
      state: base,
      tradeOffers: [proposal],
      suggestedTrades: [proposal],
      dismissedSuggestionIds: [proposal.id],
      alerts: ['something happened'],
      selectedPlayerId: proposal.offer.players[0]!,
    })

    await store.getState().actions.importSave('{"a":1}')

    expect(store.getState().state).toBe(imported)
    expect(store.getState().selectedPlayerId).toBeNull()
    expect(store.getState().tradeOffers).toEqual([])
    expect(store.getState().suggestedTrades).toEqual([])
    expect(store.getState().dismissedSuggestionIds).toEqual([])
    expect(store.getState().alerts).toEqual([])
    expect(save).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['save'])
    expect(store.getState().screen).toBe('dashboard')
    const toast = store.getState().toasts.at(-1)
    expect(toast?.tone).toBe('success')
    expect(toast?.text).toBe('Imported')
  })

  it('routes to end-game when the imported league is no longer in progress', async () => {
    const imported: LeagueState = { ...mockLeague(), outcome: 'HORIZON_EXPIRED' }
    const persistence: PersistenceModule = {
      ...persistenceStub,
      importJson: () => imported,
      save: async () => SAVED_META,
    }
    const store = createGameStore({ mode: 'engine', persistence })
    store.setState({ state: mockLeague() })

    await store.getState().actions.importSave('{"a":1}')

    expect(store.getState().screen).toBe('end-game')
  })

  it('cancels a pending debounced autosave from the old game instead of writing it', async () => {
    vi.useFakeTimers()
    const imported: LeagueState = { ...mockLeague({ season: 2019 }), outcome: 'IN_PROGRESS' }
    const save = vi.fn(async (_slot: string, _state: LeagueState) => SAVED_META)
    const persistence: PersistenceModule = {
      ...persistenceStub,
      importJson: () => imported,
      save,
    }
    const store = createGameStore({ mode: 'engine', persistence })
    const league = mockLeague()
    store.setState({ state: league })
    // Trigger the debounced autosave subscription (see `startOver` tests for the pattern) — this
    // timer belongs to the OLD game and must never fire.
    const oldState = { ...league, week: 1 }
    store.setState({ state: oldState })
    expect(save).not.toHaveBeenCalled()

    await store.getState().actions.importSave('{"a":1}')

    expect(save).toHaveBeenCalledWith('default', imported)
    expect(save.mock.calls.some(([, s]) => s === oldState)).toBe(false)

    // A fresh debounce may legitimately schedule for the *imported* state; only the old one is banned.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(save.mock.calls.some(([, s]) => s === oldState)).toBe(false)
  })

  it('in mock mode sets state and routes without touching persistence', async () => {
    const base = mockLeague()
    const imported: LeagueState = { ...mockLeague({ season: 2020 }), outcome: 'IN_PROGRESS' }
    const store = createGameStore({
      mode: 'mock',
      persistence: { ...persistenceStub, importJson: () => imported },
    })
    store.setState({ state: base })

    await store.getState().actions.importSave('{"a":1}')

    expect(store.getState().state).toBe(imported)
    expect(store.getState().screen).toBe('dashboard')
  })
})

describe('cutdownPlan', () => {
  it('returns null with no state', () => {
    const store = createGameStore({ mode: 'mock' })
    expect(store.getState().actions.cutdownPlan([])).toBeNull()
  })

  it('forwards protect to fa.suggestCutdown', async () => {
    const base = mockLeague()
    const fakePlan: CutdownPlan = {
      cuts: [],
      sizeAfter: 53,
      payrollAfter: 100,
      capSpaceAfter: 5,
      ok: true,
    }
    const suggestCutdown = vi.fn(() => fakePlan)
    const store = createGameStore({
      mode: 'mock',
      modules: { fa: { ...defaultEngineModules.fa, suggestCutdown } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const protect = [base.teams[base.userTeam]!.roster[0]!.playerId]

    const result = store.getState().actions.cutdownPlan(protect)

    expect(result).toBe(fakePlan)
    expect(suggestCutdown).toHaveBeenCalledWith(
      expect.objectContaining({ userTeam: base.userTeam }),
      base.userTeam,
      expect.anything(),
      protect,
    )
  })
})

describe('engine-mode chunk loading', () => {
  it('never requests a season chunk the manifest does not list', async () => {
    const bundle = mockBundle({ season: 2015 })
    const source = MemoryDataSource(bundle)
    const loadSeason = vi.fn(source.loadSeason)
    const opening: LeagueState = {
      ...mockLeague({ season: 2015 }),
      season: 2014,
      startSeason: 2015,
      phase: 'DRAFT',
    }
    const persistence: PersistenceModule = {
      ...persistenceStub,
      load: async () => opening,
      listSaves: async () => [],
    }
    const store = createGameStore({
      mode: 'engine',
      dataSource: { ...source, loadSeason },
      persistence,
    })
    await until(() => store.getState().dataStatus === 'ready')

    await store.getState().actions.continueGame()

    expect(store.getState().state?.season).toBe(2014)
    expect(loadSeason.mock.calls.map(([s]) => s)).toEqual([2015])
  })
})

/**
 * Regression: accepting a draft-room offer hands the on-clock pick to the AI team, but the engine
 * leaves running the draft on to the caller (`draft.advance` re-syncs owners; docs/DECISIONS.md
 * Phase 3). The store used to stop after `trade.submit`, so the room sat with an AI team on the
 * clock until the user pressed "Sim to my pick".
 */
describe('trades during the draft', () => {
  const DRAFT_SEASON = 2015
  const AI_TEAM = 'CLE'

  /** Round 1 with the user's pick (or the AI's) on the clock at index 0 and the other right behind. */
  function withDraftRoom(state: LeagueState, first: 'user' | 'ai' = 'user'): LeagueState {
    const firstTeam = first === 'user' ? state.userTeam : AI_TEAM
    const order = state.picks
      .filter((p) => p.season === DRAFT_SEASON && p.round === 1)
      .sort((a, b) => (a.owner === firstTeam ? -1 : b.owner === firstTeam ? 1 : 0))
    return {
      ...state,
      phase: 'DRAFT',
      draftRoom: {
        season: DRAFT_SEASON,
        status: 'ON_CLOCK',
        currentPickIndex: 0,
        order,
        available: [],
        udfaPool: [],
        log: [],
        pendingOffers: [],
      },
    }
  }

  function pickSwapOffer(state: LeagueState): TradeProposal {
    const onClock = state.draftRoom!.order[0]!
    return {
      id: 'draft-offer-1',
      offer: {
        teamId: AI_TEAM,
        players: [],
        picks: [{ season: DRAFT_SEASON, round: 1, originalTeam: AI_TEAM }],
      },
      request: {
        teamId: state.userTeam,
        players: [],
        picks: [
          { season: onClock.season, round: onClock.round, originalTeam: onClock.originalTeam },
        ],
      },
      initiatedBy: 'AI',
      season: state.season,
      week: state.week,
    }
  }

  /** Accepts everything and applies it with the real `execute`, so pick owners move as in the game. */
  const acceptingSubmit: typeof defaultEngineModules.trade.submit = (state, proposal, ctx) => ({
    accepted: true,
    evaluation: { valueIn: 1, valueOut: 1, needAdj: 0, margin: 0, p: 1, valid: true, reasons: [] },
    counter: null,
    state: defaultEngineModules.trade.execute(state, proposal, ctx),
  })

  /** Makes one AI pick; with the user on the clock it changes nothing (the real one adds offers). */
  const fakeAdvance = (state: LeagueState, _ctx?: unknown, _opts?: { single?: boolean }) => {
    const room = state.draftRoom!
    if (room.order[room.currentPickIndex]?.owner === state.userTeam) return state
    return { ...state, draftRoom: { ...room, currentPickIndex: room.currentPickIndex + 1 } }
  }

  async function draftStore(first: 'user' | 'ai' = 'user') {
    const base = mockLeague()
    const advance = vi.fn(fakeAdvance)
    const store = createGameStore({
      mode: 'mock',
      modules: {
        trade: { ...defaultEngineModules.trade, submit: acceptingSubmit },
        draft: { ...defaultEngineModules.draft, advance },
      },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({ state: withDraftRoom(s.state!, first) }))
    return { store, advance }
  }

  it('runs the draft on when an accepted offer takes the on-clock pick from the user', async () => {
    const { store, advance } = await draftStore()
    const offer = pickSwapOffer(store.getState().state!)
    store.setState((s) => ({
      state: { ...s.state!, draftRoom: { ...s.state!.draftRoom!, pendingOffers: [offer] } },
    }))

    await store.getState().actions.respondToOffer(offer, true)

    expect(advance).toHaveBeenCalledTimes(1)
    const handedOver = advance.mock.calls[0]![0]
    // The new owner makes the pick and the room stops on the next one.
    expect(advance.mock.calls[0]![2]).toEqual({ single: true })
    expect(handedOver.draftRoom!.order[0]!.owner).toBe(AI_TEAM)
    expect(handedOver.draftRoom!.pendingOffers).toEqual([])
    expect(store.getState().state!.draftRoom!.currentPickIndex).toBe(1)
    expect(store.getState().toasts.map((t) => t.text)).toEqual(['Trade accepted'])
  })

  it('leaves the room alone when the accepted trade keeps the user on the clock', async () => {
    const { store, advance } = await draftStore()
    const state = store.getState().state!
    const playerDeal = fixtureProposal(state)
    const stillPending = { ...pickSwapOffer(state), id: 'draft-offer-2' }
    store.setState((s) => ({
      state: {
        ...s.state!,
        draftRoom: { ...s.state!.draftRoom!, pendingOffers: [playerDeal, stillPending] },
      },
    }))

    await store.getState().actions.respondToOffer(playerDeal, true)

    expect(advance).not.toHaveBeenCalled()
    expect(store.getState().state!.draftRoom!.currentPickIndex).toBe(0)
    expect(store.getState().state!.draftRoom!.pendingOffers).toEqual([stillPending])
  })

  it('runs the draft on when the user trades the on-clock pick away from the Trade Center', async () => {
    const { store, advance } = await draftStore()
    const state = store.getState().state!
    const onClock = state.draftRoom!.order[0]!
    const proposal: TradeProposal = {
      id: 'user-offer-1',
      offer: {
        teamId: state.userTeam,
        players: [],
        picks: [
          { season: onClock.season, round: onClock.round, originalTeam: onClock.originalTeam },
        ],
      },
      request: {
        teamId: AI_TEAM,
        players: [],
        picks: [{ season: DRAFT_SEASON, round: 1, originalTeam: AI_TEAM }],
      },
      initiatedBy: 'USER',
      season: state.season,
      week: state.week,
    }

    await store.getState().actions.proposeTrade(proposal)

    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance.mock.calls[0]![2]).toEqual({ single: true })
    expect(advance.mock.calls[0]![0].draftRoom!.order[0]!.owner).toBe(AI_TEAM)
    expect(store.getState().state!.draftRoom!.currentPickIndex).toBe(1)
  })

  /** QA M3: trading up for the pick an AI team is on the clock with. */
  it('puts the user on the clock after trading for the on-clock pick', async () => {
    const { store, advance } = await draftStore('ai')
    const state = store.getState().state!
    const onClock = state.draftRoom!.order[0]!
    expect(onClock.owner).toBe(AI_TEAM)
    const ours = state.draftRoom!.order.find((p) => p.owner === state.userTeam)!
    const proposal: TradeProposal = {
      id: 'user-trade-up',
      offer: {
        teamId: state.userTeam,
        players: [],
        picks: [{ season: ours.season, round: ours.round, originalTeam: ours.originalTeam }],
      },
      request: {
        teamId: AI_TEAM,
        players: [],
        picks: [
          { season: onClock.season, round: onClock.round, originalTeam: onClock.originalTeam },
        ],
      },
      initiatedBy: 'USER',
      season: state.season,
      week: state.week,
    }

    await store.getState().actions.proposeTrade(proposal)

    // A plain advance with the user on the clock only fetches offers; no pick is made.
    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance.mock.calls[0]![2]).toBeUndefined()
    const room = store.getState().state!.draftRoom!
    expect(room.currentPickIndex).toBe(0)
    expect(room.order[0]!.owner).toBe(state.userTeam)
  })

  it('does not sim on after a trade that leaves the same AI team on the clock', async () => {
    const { store, advance } = await draftStore('ai')
    const playerDeal = { ...fixtureProposal(store.getState().state!), initiatedBy: 'USER' as const }

    await store.getState().actions.proposeTrade(playerDeal)

    expect(advance).not.toHaveBeenCalled()
    expect(store.getState().state!.draftRoom!.currentPickIndex).toBe(0)
  })
})

/** QA M3: the room pauses on every pick instead of running the AI to the user's next one. */
describe('draft room pacing', () => {
  function room(owners: TeamId[]): DraftRoomState {
    return {
      season: 2016,
      status: 'ON_CLOCK',
      currentPickIndex: 0,
      order: owners.map((owner, i) => ({
        season: 2016,
        round: 1,
        pick: i + 1,
        originalTeam: owner,
        owner,
        playerId: null,
      })),
      available: [],
      udfaPool: [],
      log: [],
      pendingOffers: [],
    }
  }

  async function pacedStore(owners: (user: TeamId, ai: TeamId) => TeamId[]) {
    const base = mockLeague()
    const aiTeam = TEAM_IDS.find((t) => t !== base.userTeam)!
    const advance = vi.fn(
      (state: LeagueState, _ctx?: unknown, _opts?: { single?: boolean }) => state,
    )
    const userPick = vi.fn((state: LeagueState) => ({
      ...state,
      draftRoom: { ...state.draftRoom!, currentPickIndex: state.draftRoom!.currentPickIndex + 1 },
    }))
    const store = createGameStore({
      mode: 'mock',
      modules: { draft: { ...defaultEngineModules.draft, advance, userPick } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({
      state: { ...s.state!, phase: 'DRAFT', draftRoom: room(owners(base.userTeam, aiTeam)) },
    }))
    return { store, advance }
  }

  it('stops on the next pick after the user picks', async () => {
    const { store, advance } = await pacedStore((user, ai) => [user, ai, ai, user])

    await store.getState().actions.makePick('p1')

    expect(advance).not.toHaveBeenCalled()
    expect(store.getState().state!.draftRoom!.currentPickIndex).toBe(1)
  })

  it('fetches offers when the user picks again right away', async () => {
    const { store, advance } = await pacedStore((user, ai) => [user, user, ai])

    await store.getState().actions.makePick('p1')

    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance.mock.calls[0]![2]).toBeUndefined()
  })

  it('sims exactly one AI pick with Sim next pick', async () => {
    const { store, advance } = await pacedStore((user, ai) => [ai, ai, user])

    await store.getState().actions.simNextPick()

    expect(advance).toHaveBeenCalledTimes(1)
    expect(advance.mock.calls[0]![2]).toEqual({ single: true })
  })

  it('does nothing on Sim next pick while the user is on the clock', async () => {
    const { store, advance } = await pacedStore((user, ai) => [user, ai])

    await store.getState().actions.simNextPick()

    expect(advance).not.toHaveBeenCalled()
  })
})

/** A won mandate is just as resumable as an expired one: item 12 extends Keep playing to CHAMPION. */
describe('keepPlaying', () => {
  it('resumes a championship outcome back to an in-progress, advanceable league on the dashboard', async () => {
    const base = mockLeague()
    const store = createGameStore({ mode: 'mock' })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({ state: { ...s.state!, outcome: 'CHAMPION' }, screen: 'end-game' }))

    store.getState().actions.keepPlaying()

    expect(store.getState().state?.outcome).toBe('IN_PROGRESS')
    expect(store.getState().screen).toBe('dashboard')

    // The league is genuinely live again, not just cosmetically: a second call is the no-op guard's
    // "already in progress" branch, not a re-run of the championship reset.
    store.getState().actions.keepPlaying()
    expect(store.getState().state?.outcome).toBe('IN_PROGRESS')
  })
})

/** QA sweep item 1: newGame/continueGame must not build or persist two games from concurrent calls. */
describe('newGame re-entrancy', () => {
  it('collapses two concurrent calls into exactly one game and one save', async () => {
    const bundle = mockBundle({ season: 2015 })
    const baseSource = MemoryDataSource(bundle)
    let resolveFirst!: () => void
    const gate = new Promise<void>((r) => (resolveFirst = r))
    let callCount = 0
    const loadSeason = async (s: Parameters<typeof baseSource.loadSeason>[0]) => {
      callCount += 1
      if (callCount === 1) await gate
      return baseSource.loadSeason(s)
    }
    const saveCalls: string[] = []
    const persistence: PersistenceModule = {
      ...persistenceStub,
      listSaves: async () => [],
      save: async (_slot, state) => {
        saveCalls.push(state.seed)
        return {
          slot: 'default',
          userTeam: state.userTeam,
          season: state.season,
          week: state.week,
          phase: state.phase,
          startSeason: state.startSeason,
          horizonEnd: state.season + 3,
          savedAt: new Date().toISOString(),
          schemaVersion: 1,
        }
      },
    }
    const store = createGameStore({
      mode: 'engine',
      dataSource: { ...baseSource, loadSeason },
      persistence,
    })
    await until(() => store.getState().dataStatus === 'ready')

    const opts = {
      startSeason: 2015,
      userTeam: 'IND' as TeamId,
      horizonSeasons: 3,
      settings: undefined as never,
    }
    const p1 = store.getState().actions.newGame(opts)
    await new Promise((r) => setTimeout(r, 5))
    expect(store.getState().busy.newGame).toBe(true) // #1 is mid-flight

    const p2 = store.getState().actions.newGame(opts) // guarded: sees the flag and returns immediately
    await p2
    expect(store.getState().state).toBeNull() // #1 hasn't resolved yet; #2 did nothing

    resolveFirst()
    await p1

    expect(saveCalls.length).toBe(1)
    expect(store.getState().state).not.toBeNull()
  })
})

/**
 * QA sweep item 1: on the New Game screen, Start and Continue share `busy.newGame` and can both
 * fire before either becomes disabled. Whichever wins the state race, the loser must not force a
 * navigation using its own (possibly stale) outcome.
 */
describe('continueGame races newGame', () => {
  it('keeps the new game on dashboard even when continueGame resolves afterward', async () => {
    const bundle = mockBundle({ season: 2015 })
    const source = MemoryDataSource(bundle)
    let releaseLoad!: () => void
    const gate = new Promise<void>((r) => (releaseLoad = r))
    const finishedSave: LeagueState = {
      ...mockLeague({ season: 2015 }),
      outcome: 'HORIZON_EXPIRED',
    }

    const persistence: PersistenceModule = {
      ...persistenceStub,
      listSaves: async () => [],
      load: async () => {
        await gate // resolves AFTER newGame() has already committed fresh state
        return finishedSave
      },
      save: async (_slot, state) => ({
        slot: 'default',
        userTeam: state.userTeam,
        season: state.season,
        week: state.week,
        phase: state.phase,
        startSeason: state.startSeason,
        horizonEnd: state.season + 3,
        savedAt: new Date().toISOString(),
        schemaVersion: 1,
      }),
    }

    const store = createGameStore({ mode: 'engine', dataSource: source, persistence })
    await until(() => store.getState().dataStatus === 'ready')

    const opts = {
      startSeason: 2015,
      userTeam: 'IND' as TeamId,
      horizonSeasons: 3,
      settings: undefined as never,
    }

    const pContinue = store.getState().actions.continueGame() // blocks on `gate`
    const pNewGame = store.getState().actions.newGame(opts)
    await pNewGame

    expect(store.getState().state?.outcome).toBe('IN_PROGRESS')
    expect(store.getState().screen).toBe('dashboard')

    releaseLoad()
    await pContinue

    // continueGame lost the state race and must skip the goTo too, or the finished save's outcome
    // strands a live game on End Game.
    expect(store.getState().state?.outcome).toBe('IN_PROGRESS')
    expect(store.getState().screen).toBe('dashboard')
  })
})

/** QA sweep item 2: Sim to my pick must not resurrect offers the user just declined. */
describe('simToMyPick', () => {
  function fixtureRoom(onClockTeam: TeamId): DraftRoomState {
    return {
      season: 2016,
      status: 'ON_CLOCK',
      currentPickIndex: 0,
      order: [
        {
          season: 2016,
          round: 1,
          pick: 1,
          originalTeam: onClockTeam,
          owner: onClockTeam,
          playerId: null,
        },
      ],
      available: [],
      udfaPool: [],
      log: [],
      pendingOffers: [],
    }
  }

  it('is a no-op while the user is already on the clock', async () => {
    const base = mockLeague()
    const advance = vi.fn((state: LeagueState) => state)
    const store = createGameStore({
      mode: 'mock',
      modules: { draft: { ...defaultEngineModules.draft, advance } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({
      state: { ...s.state!, phase: 'DRAFT', draftRoom: fixtureRoom(s.state!.userTeam) },
    }))

    await store.getState().actions.simToMyPick()

    expect(advance).not.toHaveBeenCalled()
  })

  it('advances normally when an AI team is on the clock', async () => {
    const base = mockLeague()
    const aiTeam = TEAM_IDS.find((t) => t !== base.userTeam)!
    const advance = vi.fn((state: LeagueState) => state)
    const store = createGameStore({
      mode: 'mock',
      modules: { draft: { ...defaultEngineModules.draft, advance } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    store.setState((s) => ({
      state: { ...s.state!, phase: 'DRAFT', draftRoom: fixtureRoom(aiTeam) },
    }))

    await store.getState().actions.simToMyPick()

    expect(advance).toHaveBeenCalledTimes(1)
  })
})

/** QA sweep item 4: read-only selectors stay silent for "not built yet" but log anything else. */
describe('read-only selector error reporting', () => {
  it('logs an unexpected error from a selector', async () => {
    const base = mockLeague()
    const boom = new Error('boom')
    const store = createGameStore({
      mode: 'mock',
      modules: {
        fa: {
          ...defaultEngineModules.fa,
          capFor: () => {
            throw boom
          },
        },
      },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(store.getState().actions.capFor(base.season)).toBeNull()

    expect(spy).toHaveBeenCalledWith(boom)
    spy.mockRestore()
  })

  it('stays silent for a not-implemented module', async () => {
    const base = mockLeague()
    const store = createGameStore({
      mode: 'mock',
      modules: {
        fa: {
          ...defaultEngineModules.fa,
          capFor: () => {
            throw new NotImplementedError('fa.capFor')
          },
        },
      },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(store.getState().actions.capFor(base.season)).toBeNull()

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

/** QA sweep item 5: a schema-valid save from a year this build has no data for must be rejected. */
describe('importSave season validation', () => {
  it("rejects a save the manifest doesn't cover and leaves the running game untouched", async () => {
    const base = mockLeague()
    const tooOld: LeagueState = { ...mockLeague({ season: 1925 }), startSeason: 1925 }
    const importJson = vi.fn(() => tooOld)
    const store = createGameStore({
      mode: 'mock',
      persistence: { ...persistenceStub, importJson },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const before = store.getState().state

    await store.getState().actions.importSave('{"a":1}')

    expect(store.getState().state).toBe(before)
    const toast = store.getState().toasts.at(-1)
    expect(toast?.tone).toBe('error')
    expect(toast?.text).toBe("This save is from a year this version doesn't support.")
  })
})

/** QA sweep item 6: an IndexedDB-unavailable failure gets a friendly toast, not the raw TypeError. */
describe('storage unavailable', () => {
  it('shows a friendly toast instead of the raw error message', async () => {
    const league = mockLeague()
    const save = vi.fn(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'open')")
    })
    const persistence: PersistenceModule = { ...persistenceStub, listSaves: async () => [], save }
    const store = createGameStore({ mode: 'engine', persistence })
    store.setState({ state: league })

    await store.getState().actions.save()

    const toast = store.getState().toasts.at(-1)
    expect(toast?.tone).toBe('error')
    expect(toast?.text).toBe("Your browser is blocking storage, so this game won't be saved.")
  })
})

/** QA sweep item 7: two tabs on one save must not clobber each other's progress. */
describe('multi-tab save guard', () => {
  it('refuses to overwrite a newer save written by another tab', async () => {
    const league = mockLeague()
    let tick = 0
    let stored: SaveSlotMeta | null = null
    function fakePersistence(): PersistenceModule {
      return {
        ...persistenceStub,
        listSaves: async () => (stored ? [stored] : []),
        save: async (_slot, state) => {
          tick += 1
          stored = {
            slot: 'default',
            userTeam: state.userTeam,
            season: state.season,
            week: state.week,
            phase: state.phase,
            startSeason: state.startSeason,
            horizonEnd: state.season + 3,
            savedAt: `2026-01-01T00:00:${String(tick).padStart(2, '0')}.000Z`,
            schemaVersion: 1,
          }
          return stored
        },
      }
    }
    // Two store instances stand in for two tabs; they share the fake persistence's "disk" (`stored`)
    // but each keeps its own private savedAt baseline, exactly like two real tabs would.
    const tabA = createGameStore({ mode: 'engine', persistence: fakePersistence() })
    const tabB = createGameStore({ mode: 'engine', persistence: fakePersistence() })
    tabA.setState({ state: league })
    tabB.setState({ state: league })

    await tabA.getState().actions.save() // v1 — tabA's baseline is now v1
    await tabB.getState().actions.save() // v2 — tabB learns about v1 and writes past it

    await tabA.getState().actions.save() // tabA's baseline (v1) is stale; the disk now holds v2

    const toast = tabA.getState().toasts.at(-1)
    expect(toast?.tone).toBe('warn')
    expect(toast?.text).toBe('This game changed in another tab. Reload to pick up the latest.')
    // The conflicting write never happened: the disk still holds tabB's v2, not a third version.
    expect(tick).toBe(2)

    // A stale tab stays blocked until it reloads: its next save must not slip through either.
    await tabA.getState().actions.save()
    expect(tick).toBe(2)
  })
})

describe('tradeFairness', () => {
  it("returns the engine's fairness number for a proposal", async () => {
    const base = mockLeague()
    const store = createGameStore({
      mode: 'mock',
      modules: { trade: { ...defaultEngineModules.trade, fairness: () => 0.74 } },
    })
    await store.getState().actions.newGame({
      startSeason: base.season,
      userTeam: base.userTeam,
      horizonSeasons: 3,
      settings: base.settings,
    })
    const proposal = fixtureProposal(store.getState().state!)

    expect(store.getState().actions.tradeFairness(proposal)).toBe(0.74)
  })

  it('falls back to 0.5 (even) without a league loaded', () => {
    const store = createGameStore({ mode: 'mock' })
    const proposal = fixtureProposal(mockLeague())

    expect(store.getState().actions.tradeFairness(proposal)).toBe(0.5)
  })
})
