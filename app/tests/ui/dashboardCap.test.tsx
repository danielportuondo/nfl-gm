// @vitest-environment jsdom
/**
 * QA 2018 M1: in the offseason the Dashboard cap tile and "Over the cap" alert must read the same
 * next-season books as the FA screen (deals that outlive the roll plus carried dead money), and the
 * alert must not claim to block anything the engine does not block.
 */
import '@testing-library/jest-dom/vitest'
import type { LeagueState } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Dashboard } from '@screens/Dashboard'
import { FreeAgency } from '@screens/FreeAgency'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

const NEXT_CAP = 177.2

function offseasonLeague(carried: number, expiringApy: number): LeagueState {
  const base = mockLeague()
  const team = base.teams[base.userTeam]!
  // Half the roster is on its last year: those deals leave at the roll and must not count.
  const roster = team.roster.map((slot, i) =>
    i % 2 === 0
      ? { ...slot, contract: { ...slot.contract, years: 1, apy: expiringApy, signedSeason: 2010 } }
      : { ...slot, contract: { ...slot.contract, years: 3, signedSeason: 2010 } },
  )
  return {
    ...base,
    phase: 'OFFSEASON_RESIGN',
    teams: {
      ...base.teams,
      [base.userTeam]: { ...team, roster, deadMoney: 9, carriedDeadMoney: carried },
    },
  }
}

const tileValue = (label: string): string | null | undefined =>
  screen.getByText(label).previousElementSibling?.textContent

function renderDashboard(state: LeagueState) {
  render(
    <Dashboard
      state={state}
      data={mockStatic()}
      cap={NEXT_CAP}
      onSimWeek={vi.fn()}
      onAdvancePhase={vi.fn()}
    />,
  )
}

describe('Dashboard cap in the offseason', () => {
  it('shows the same next-season space as the free agency screen', () => {
    const state = offseasonLeague(4, 3)
    render(
      <FreeAgency
        state={state}
        cap={NEXT_CAP}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => null}
      />,
    )
    const freeAgencySpace = tileValue('Space next season')
    const freeAgencyCap = tileValue('Cap next season')
    cleanup()

    renderDashboard(state)
    expect(tileValue('Space next season')).toBe(freeAgencySpace)
    expect(tileValue('Cap next season')).toBe(freeAgencyCap)
  })

  it('warns when next season is over the cap without promising a block', () => {
    renderDashboard(offseasonLeague(500, 3))
    expect(screen.getByText(/Over the 2016 cap by/)).toBeInTheDocument()
    expect(screen.getByText(/You must be under it to start the season/)).toBeInTheDocument()
    expect(screen.queryByText(/to continue/i)).not.toBeInTheDocument()
  })

  it('counts carried dead money against next season', () => {
    const lean = offseasonLeague(0, 3)
    const burdened = offseasonLeague(25, 3)
    renderDashboard(lean)
    const leanSpace = tileValue('Space next season')
    cleanup()
    renderDashboard(burdened)
    expect(tileValue('Space next season')).not.toBe(leanSpace)
  })
})
