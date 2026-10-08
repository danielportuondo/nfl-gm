// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { LeagueState } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { FreeAgency } from '@screens/FreeAgency'
import { Roster } from '@screens/Roster'
import { absenceLabel } from '@screens/shared/absences'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

function announced(): { state: LeagueState; poolId: string; benchId: string } {
  const base = mockLeague({ season: 2017 })
  const poolId = base.freeAgents[0]!
  const benchId = base.teams[base.userTeam]!.roster.at(-1)!.playerId
  const state: LeagueState = {
    ...base,
    phase: 'REGULAR',
    week: 3,
    absences: {
      season: 2017,
      byPlayer: {
        [poolId]: [{ from: 6, to: 22, reason: 'injury' }],
        [benchId]: [{ from: 1, to: 5, reason: 'suspension' }],
      },
    },
  }
  return { state, poolId, benchId }
}

describe('real absences are shown ahead of time', () => {
  it('formats injury, suspension, and out-of-football labels from the public board', () => {
    const { state, poolId } = announced()
    expect(absenceLabel(state, poolId)).toBe('Out wk 6–17 · injury')
    const out: LeagueState = {
      ...state,
      absences: { season: 2017, byPlayer: { [poolId]: [{ from: 1, to: 22, reason: 'out' }] } },
    }
    expect(absenceLabel(out, poolId)).toBe('Out of football in 2017')
    expect(absenceLabel({ ...state, week: 7 }, 'nobody')).toBeNull()
  })

  it('the free-agent pool row and the offer panel carry the label', async () => {
    const { state, poolId } = announced()
    const name = state.players[poolId]!.name
    render(
      <FreeAgency
        state={state}
        cap={200}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => null}
      />,
    )
    const row = screen.getByText(name).closest('tr')!
    expect(within(row).getByText('Out wk 6–17 · injury')).toBeInTheDocument()
    await userEvent.click(row)
    expect(screen.getByRole('alert')).toHaveTextContent('Out wk 6–17 · injury')
  })

  it('the roster shows an upcoming or running absence on the player', () => {
    const { state, benchId } = announced()
    const staticData = mockStatic()
    render(
      <Roster
        state={state}
        data={staticData}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
      />,
    )
    const name = state.players[benchId]!.name
    const row = screen
      .getAllByText(name)
      .map((el) => el.closest('tr'))
      .find((tr) => tr !== null)!
    expect(within(row).getByText('Out wk 1–5 · suspension')).toBeInTheDocument()
  })

  it('the roster warns when the user team has no healthy player at a position', () => {
    const { state } = announced()
    const user = state.teams[state.userTeam]!
    const roster = user.roster.map((slot) =>
      state.players[slot.playerId]!.pos === 'QB'
        ? { ...slot, injured: { weeksOut: 3, kind: 'Injury', season: 2017, week: 3 } }
        : slot,
    )
    const hurt = { ...state, teams: { ...state.teams, [state.userTeam]: { ...user, roster } } }
    render(
      <Roster
        state={hurt}
        data={mockStatic()}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
      />,
    )
    expect(screen.getByText(/No healthy QB this week\./)).toBeInTheDocument()
  })
})
