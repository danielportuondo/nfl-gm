// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  TEAM_IDS,
  type GameSettings,
  type LeagueState,
  type TradeProposal,
  type WeekReport,
} from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Dashboard } from '@screens/Dashboard'
import { TradeCenter } from '@screens/TradeCenter'
import { Rail } from '@ui/frame'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

function aiOffer(state: LeagueState, n: number): TradeProposal {
  const aiTeamId = TEAM_IDS.find((t) => t !== state.userTeam)!
  return {
    id: `offer-${state.week}-${n}`,
    offer: { teamId: aiTeamId, players: [state.teams[aiTeamId]!.roster[0]!.playerId], picks: [] },
    request: {
      teamId: state.userTeam,
      players: [state.teams[state.userTeam]!.roster[n]!.playerId],
      picks: [],
    },
    initiatedBy: 'AI',
    season: state.season,
    week: state.week,
  }
}

/** The engine's `simWeek` reports offers only as strings; the store has to fetch the real ones. */
function fakeSimWeek(state: LeagueState): WeekReport {
  return {
    state: { ...state, week: state.week + 1 },
    gamesPlayed: 16,
    events: ['AI trade offer from NE'],
  }
}

const OFFERS_BY_FREQUENCY = { rare: 1, normal: 2, aggressive: 3 } as const

/** Mirrors trade.generateAiOffers: the frequency setting decides how many calls come in. */
function fakeGenerate(state: LeagueState): TradeProposal[] {
  const count = OFFERS_BY_FREQUENCY[state.settings.aiOfferFrequency]
  return Array.from({ length: count }, (_, n) => aiOffer(state, n))
}

function fakeRelease(state: LeagueState, teamId: string, playerId: string): LeagueState {
  const team = state.teams[teamId]!
  const roster = team.roster.filter((slot) => slot.playerId !== playerId)
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster } } }
}

async function startSeason(settings?: Partial<GameSettings>) {
  const base = mockLeague()
  const store = createGameStore({
    mode: 'mock',
    modules: {
      league: { ...defaultEngineModules.league, simWeek: fakeSimWeek },
      fa: { ...defaultEngineModules.fa, release: fakeRelease },
      trade: { ...defaultEngineModules.trade, generateAiOffers: vi.fn(fakeGenerate) },
    },
  })
  await store.getState().actions.newGame({
    startSeason: base.season,
    userTeam: base.userTeam,
    horizonSeasons: 3,
    settings: { ...base.settings, ...settings },
  })
  store.setState((s) => ({ state: { ...s.state!, phase: 'REGULAR', week: 1 } }))
  return store
}

describe('in-season AI trade offers', () => {
  it('lands real offers in the store after a sim week, without pressing Check for offers', async () => {
    const store = await startSeason({ aiOfferFrequency: 'normal' })
    expect(store.getState().tradeOffers).toHaveLength(0)

    await store.getState().actions.simWeek()

    const offers = store.getState().tradeOffers
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.every((o) => o.initiatedBy === 'AI')).toBe(true)
  })

  it('follows the frequency setting', async () => {
    const rare = await startSeason({ aiOfferFrequency: 'rare' })
    await rare.getState().actions.simWeek()
    expect(rare.getState().tradeOffers).toHaveLength(1)

    const aggressive = await startSeason({ aiOfferFrequency: 'aggressive' })
    await aggressive.getState().actions.simWeek()
    expect(aggressive.getState().tradeOffers).toHaveLength(3)
  })

  it("replaces last week's offers with the new week's", async () => {
    const store = await startSeason({ aiOfferFrequency: 'normal' })
    await store.getState().actions.simWeek()
    const week1 = store.getState().tradeOffers.map((o) => o.id)
    await store.getState().actions.simWeek()
    const week2 = store.getState().tradeOffers.map((o) => o.id)
    expect(week2.length).toBeGreaterThan(0)
    expect(week2.some((id) => week1.includes(id))).toBe(false)
  })

  it('drops an offer when one of its assets leaves the roster', async () => {
    const store = await startSeason({ aiOfferFrequency: 'normal' })
    await store.getState().actions.simWeek()
    const [first, second] = store.getState().tradeOffers
    const requested = first!.request.players[0]!

    await store.getState().actions.release(requested)

    expect(store.getState().tradeOffers.map((o) => o.id)).toEqual([second!.id])
  })

  it('clears offers once the sim leaves the season', async () => {
    const store = await startSeason({ aiOfferFrequency: 'normal' })
    await store.getState().actions.simWeek()
    expect(store.getState().tradeOffers.length).toBeGreaterThan(0)
    store.setState((s) => ({ state: { ...s.state!, phase: 'OFFSEASON_RESIGN' } }))
    await store.getState().actions.simWeek()
    expect(store.getState().tradeOffers).toHaveLength(0)
  })
})

describe('trade offer notices', () => {
  it('badges the Trades nav item with the offer count', () => {
    render(
      <Rail
        items={[
          { id: 'dashboard', label: 'Dashboard' },
          { id: 'trade', label: 'Trades', badge: 2 },
        ]}
        current="dashboard"
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getAllByRole('button', { name: /Trades.*2 offers/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Dashboard.*offers/ })).toBeNull()
  })

  it('shows no badge at zero', () => {
    render(
      <Rail
        items={[{ id: 'trade', label: 'Trades', badge: 0 }]}
        current="trade"
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByText(/offer/)).toBeNull()
  })

  it('puts a notice on the Dashboard that leads to the Trades screen', () => {
    const state: LeagueState = { ...mockLeague(), phase: 'REGULAR', week: 3 }
    const onNavigate = vi.fn()
    render(
      <Dashboard
        state={state}
        data={mockStatic()}
        cap={250}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
        onNavigate={onNavigate}
        tradeOfferCount={2}
      />,
    )
    screen.getByRole('button', { name: /2 trade offers waiting/ }).click()
    expect(onNavigate).toHaveBeenCalledWith('trade')
  })
})

describe('Trade Center empty state', () => {
  function renderTrades(phase: LeagueState['phase']) {
    const state: LeagueState = { ...mockLeague(), phase }
    render(
      <TradeCenter
        state={state}
        data={mockStatic()}
        tradeOffers={[]}
        suggestedTrades={[]}
        onEvaluate={() => ({
          valueIn: 0,
          valueOut: 0,
          needAdj: 0,
          margin: 0,
          p: 0.5,
          valid: true,
          reasons: [],
        })}
        onFairness={() => 0.5}
        onProposeTrade={vi.fn()}
        onRespondToOffer={vi.fn()}
        onRefreshOffers={vi.fn()}
        onRefreshSuggestions={vi.fn()}
      />,
    )
  }

  it('does not talk about picks in season', () => {
    renderTrades('REGULAR')
    expect(screen.queryByText(/your pick lines up/i)).toBeNull()
    expect(screen.getByText(/No offers this week/)).toBeInTheDocument()
  })

  it('keeps the pick-need copy during the draft', () => {
    renderTrades('DRAFT')
    expect(screen.getByText(/your pick lines up/i)).toBeInTheDocument()
  })
})
