// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { Contract, LeagueState, PlayerId } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Dashboard } from '@screens/Dashboard'
import { Finances } from '@screens/Finances'
import { FreeAgency } from '@screens/FreeAgency'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

/**
 * A deal signed in an offseason phase is stamped signedSeason = season + 1, so an N-year deal plays N
 * seasons; a deal signed earlier still counts the season just played until the camp rollover.
 */
function resignWindow(): {
  state: LeagueState
  fresh: PlayerId
  lastYear: PlayerId
  multiYear: PlayerId
} {
  const base = mockLeague()
  const team = base.teams[base.userTeam]!
  const deal = (c: Partial<Contract>): Contract => ({
    years: 3,
    apy: 0,
    guaranteedPct: 0.5,
    signedSeason: base.season - 1,
    rookie: false,
    ...c,
  })
  const [freshSlot, lastYearSlot, multiYearSlot] = team.roster
  const contracts = new Map<PlayerId, Contract>([
    [freshSlot!.playerId, deal({ years: 1, apy: 5, signedSeason: base.season + 1 })],
    [lastYearSlot!.playerId, deal({ years: 1, apy: 2 })],
    [multiYearSlot!.playerId, deal({ years: 3, apy: 3 })],
  ])
  const state: LeagueState = {
    ...base,
    phase: 'OFFSEASON_RESIGN',
    teams: {
      ...base.teams,
      [base.userTeam]: {
        ...team,
        roster: team.roster.map((slot) => ({
          ...slot,
          contract: contracts.get(slot.playerId) ?? deal({}),
        })),
      },
    },
  }
  return {
    state,
    fresh: freshSlot!.playerId,
    lastYear: lastYearSlot!.playerId,
    multiYear: multiYearSlot!.playerId,
  }
}

function rosterRow(name: string): HTMLElement {
  const row = screen
    .getAllByText(name)
    .map((el) => el.closest('tr'))
    .find((tr) => tr !== null)
  return row!
}

describe('contract years in the offseason', () => {
  it('Roster flags the old deal in its last season, not the fresh 1-year deal', () => {
    const { state, fresh, lastYear } = resignWindow()
    render(
      <Roster
        state={state}
        data={mockStatic()}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
      />,
    )
    const rowOf = (id: PlayerId) => rosterRow(state.players[id]!.name)
    expect(within(rowOf(lastYear)).getByText('Expiring')).toBeInTheDocument()
    expect(within(rowOf(fresh)).queryByText('Expiring')).toBeNull()
    expect(screen.getAllByText('Expiring')).toHaveLength(1)
  })

  it('Dashboard counts only the old deal as ending', () => {
    const { state } = resignWindow()
    render(
      <Dashboard
        state={state}
        data={mockStatic()}
        cap={250}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
      />,
    )
    expect(
      screen.getByText(`1 contract ending before the ${state.season + 1} season.`),
    ).toBeInTheDocument()
  })

  it('FreeAgency offers re-signing for the old deal only', () => {
    const { state, fresh, lastYear } = resignWindow()
    render(
      <FreeAgency
        state={state}
        cap={150}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => 1}
      />,
    )
    const panel = screen.getByText('Re-sign your own').closest('section')!
    expect(within(panel).getByText(state.players[lastYear]!.name)).toBeInTheDocument()
    expect(within(panel).queryByText(state.players[fresh]!.name)).toBeNull()
  })

  it('Finances keeps the fresh 1-year deal on next season’s books', () => {
    const { state, fresh, lastYear } = resignWindow()
    render(
      <Finances
        state={state}
        data={mockStatic()}
        cap={200}
        capNextSeason={100}
        onRelease={vi.fn()}
      />,
    )
    // next season: fresh $5M + multi-year $3M; the old last-year $2M deal falls off
    expect(screen.getByText('$92.0M')).toBeInTheDocument()
    const expiring = screen.getByText('Contracts expiring').closest('section')!
    expect(
      within(expiring).getByText(new RegExp(state.players[lastYear]!.name)),
    ).toBeInTheDocument()
    expect(within(expiring).queryByText(new RegExp(state.players[fresh]!.name))).toBeNull()
  })

  it('PlayerCard counts the seasons still to play, not the label on the deal', () => {
    const { state, fresh, lastYear, multiYear } = resignWindow()
    const card = (id: PlayerId) =>
      render(<PlayerCard state={state} data={mockStatic()} playerId={id} onBack={vi.fn()} />)
    card(fresh)
    expect(screen.getByText(/^1 year left/)).toBeInTheDocument()
    cleanup()
    card(multiYear)
    expect(screen.getByText(/^2 years left/)).toBeInTheDocument()
    cleanup()
    card(lastYear)
    expect(screen.queryByText(/years? left/)).toBeNull()
    expect(screen.getByText(/^Expiring/)).toBeInTheDocument()
  })

  it('in season, a 1-year deal still counts as expiring after this season', () => {
    const { state, lastYear } = resignWindow()
    const inSeason: LeagueState = { ...state, phase: 'REGULAR', week: 3 }
    render(
      <Roster
        state={inSeason}
        data={mockStatic()}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
      />,
    )
    const row = rosterRow(state.players[lastYear]!.name)
    expect(within(row).getByText('Expiring')).toBeInTheDocument()
  })
})
