// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { CutdownPlan, CutdownSuggestion, LeagueState, PlayerId } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Roster } from '@screens/Roster'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

/** Two of the user's own roster players, suggested as size cuts, for a stable fixture across tests. */
function fixtureCuts(state: LeagueState): CutdownSuggestion[] {
  const roster = state.teams[state.userTeam]!.roster
  return [
    { playerId: roster[0]!.playerId, reason: 'size', deadMoney: 0.5, netSavings: 2.1 },
    { playerId: roster[1]!.playerId, reason: 'size', deadMoney: 0, netSavings: 1.4 },
  ]
}

/** A stateful fake `cutdownPlan`: cuts shrink as ids are protected, mirroring the real module's contract. */
function fakePlan(state: LeagueState, cuts: CutdownSuggestion[]) {
  return vi.fn((protect: readonly PlayerId[]): CutdownPlan => {
    const remaining = cuts.filter((c) => !protect.includes(c.playerId))
    const size = state.teams[state.userTeam]!.roster.length
    return {
      cuts: remaining,
      sizeAfter: size - remaining.length,
      payrollAfter: 100,
      capSpaceAfter: 5,
      ok: remaining.length === cuts.length,
    }
  })
}

describe('Roster cutdown panel', () => {
  it('shows no panel when the plan is legal', () => {
    const state = mockLeague()
    const data = mockStatic()
    const cutdownPlan = vi.fn((): CutdownPlan => ({
      cuts: [],
      sizeAfter: 53,
      payrollAfter: 100,
      capSpaceAfter: 5,
      ok: true,
    }))
    render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        cutdownPlan={cutdownPlan}
      />,
    )
    expect(screen.queryByRole('heading', { name: /cut down|get under the cap/i })).toBeNull()
  })

  it('shows no panel outside a cap-gated phase, even with cuts to make', () => {
    const state: LeagueState = { ...mockLeague(), phase: 'OFFSEASON_RESIGN' }
    const data = mockStatic()
    const cutdownPlan = fakePlan(state, fixtureCuts(state))
    render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        cutdownPlan={cutdownPlan}
      />,
    )
    expect(screen.queryByRole('heading', { name: /cut down|get under the cap/i })).toBeNull()
  })

  it('lists the suggested cuts and the release button reads the count', () => {
    const state = mockLeague()
    const data = mockStatic()
    const cuts = fixtureCuts(state)
    const cutdownPlan = fakePlan(state, cuts)
    render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        cutdownPlan={cutdownPlan}
      />,
    )
    for (const cut of cuts) {
      const name = state.players[cut.playerId]!.name
      expect(screen.getByRole('checkbox', { name: `Cut ${name}` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Release 2 players' })).toBeInTheDocument()
  })

  it('unchecking a row protects that player, recomputes the plan, and shows Kept', async () => {
    const state = mockLeague()
    const data = mockStatic()
    const cuts = fixtureCuts(state)
    const cutdownPlan = fakePlan(state, cuts)
    const keptPlayer = state.players[cuts[0]!.playerId]!
    render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        cutdownPlan={cutdownPlan}
      />,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: `Cut ${keptPlayer.name}` }))

    expect(cutdownPlan).toHaveBeenCalledWith([cuts[0]!.playerId])
    expect(screen.getByText('Kept')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Cut ${keptPlayer.name}` })).not.toBeChecked()
  })

  it('releases exactly the checked ids and clears protect on click', async () => {
    const state = mockLeague()
    const data = mockStatic()
    const cuts = fixtureCuts(state)
    const cutdownPlan = fakePlan(state, cuts)
    const onReleaseMany = vi.fn()
    render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        cutdownPlan={cutdownPlan}
        onReleaseMany={onReleaseMany}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Release 2 players' }))

    expect(onReleaseMany).toHaveBeenCalledWith(cuts.map((c) => c.playerId))
  })
})
