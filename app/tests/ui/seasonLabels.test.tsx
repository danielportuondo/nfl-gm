// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { LeagueState } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Dashboard } from '@screens/Dashboard'
import { Schedule } from '@screens/Schedule'
import { TradeCenter } from '@screens/TradeCenter'
import { horizonProgress } from '@screens/shared/phaseLabel'
import { playerLabel } from '@screens/shared/playerLabel'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

describe('horizonProgress', () => {
  const base = { startSeason: 2013, horizonEnd: 2015 }

  it('counts the offseason as the first year of the league year it builds', () => {
    expect(horizonProgress({ ...base, season: 2012, phase: 'DRAFT' })).toEqual({
      index: 1,
      total: 3,
    })
    expect(horizonProgress({ ...base, season: 2013, phase: 'REGULAR' })).toEqual({
      index: 1,
      total: 3,
    })
  })

  it('moves to the next season as soon as the one just played is over', () => {
    expect(horizonProgress({ ...base, season: 2013, phase: 'OFFSEASON_RESIGN' })).toEqual({
      index: 2,
      total: 3,
    })
    expect(horizonProgress({ ...base, season: 2015, phase: 'OFFSEASON_RESIGN' })).toEqual({
      index: 3,
      total: 3,
    })
  })
})

describe('playerLabel', () => {
  it('adds position and team so two players with one name cannot be confused', () => {
    const state = mockLeague()
    const [a, b] = state.teams[state.userTeam]!.roster
    const first = state.players[a!.playerId]!
    const second = state.players[b!.playerId]!
    const players = {
      ...state.players,
      [first.id]: { ...first, name: 'Michael Thomas', pos: 'WR' as const },
      [second.id]: { ...second, name: 'Michael Thomas', pos: 'S' as const },
    }
    const next = { ...state, players }
    expect(playerLabel(next, first.id)).toBe(`Michael Thomas (WR, ${state.userTeam})`)
    expect(playerLabel(next, second.id)).toBe(`Michael Thomas (S, ${state.userTeam})`)
  })

  it('leaves out the team for a player nobody has signed', () => {
    const state = mockLeague()
    const free = Object.values(state.players).find(
      (p) => !Object.values(state.teams).some((t) => t.roster.some((s) => s.playerId === p.id)),
    )
    if (!free) return
    expect(playerLabel(state, free.id)).toBe(`${free.name} (${free.pos})`)
  })
})

describe('offer text', () => {
  it('names the position and team of each player in an incoming offer', () => {
    const state = mockLeague()
    const ai = Object.keys(state.teams).find((t) => t !== state.userTeam)!
    const aiPlayer = state.teams[ai]!.roster[0]!.playerId
    const userPlayer = state.teams[state.userTeam]!.roster[0]!.playerId
    render(
      <TradeCenter
        state={state}
        data={mockStatic()}
        tradeOffers={[
          {
            id: 'o1',
            offer: { teamId: ai, players: [aiPlayer], picks: [] },
            request: { teamId: state.userTeam, players: [userPlayer], picks: [] },
            initiatedBy: 'AI',
            season: state.season,
            week: state.week,
          },
        ]}
        suggestedTrades={[]}
        onEvaluate={() => ({
          valueIn: 1,
          valueOut: 1,
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
    const p = state.players[aiPlayer]!
    expect(screen.getByText(`${p.name} (${p.pos}, ${ai})`, { exact: false })).toBeInTheDocument()
  })
})

describe('offseason wording', () => {
  const offseason = (): LeagueState => ({ ...mockLeague(), phase: 'FREE_AGENCY' })

  it('does not call the finished season "this season" on the Dashboard', () => {
    const state = offseason()
    const team = state.teams[state.userTeam]!
    const expiring: LeagueState = {
      ...state,
      teams: {
        ...state.teams,
        [state.userTeam]: {
          ...team,
          roster: team.roster.map((s, i) =>
            i === 0 ? { ...s, contract: { ...s.contract, years: 1 } } : s,
          ),
        },
      },
    }
    render(
      <Dashboard
        state={expiring}
        data={mockStatic()}
        cap={250}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
      />,
    )
    expect(screen.queryByText(/expiring after this season/)).toBeNull()
    expect(
      screen.getByText(new RegExp(`before the ${state.season + 1} season`)),
    ).toBeInTheDocument()
  })

  it('titles the Schedule by the season it shows, not by the league year', () => {
    const state = offseason()
    render(
      <Schedule
        state={state}
        data={mockStatic()}
        busy={{ simWeek: false, simToNextEvent: false, simSeason: false }}
        onSimWeek={vi.fn()}
        onSimToNextEvent={vi.fn()}
        onSimSeason={vi.fn()}
      />,
    )
    expect(screen.getAllByText(new RegExp(`${state.season} season`)).length).toBeGreaterThan(0)
  })
})
