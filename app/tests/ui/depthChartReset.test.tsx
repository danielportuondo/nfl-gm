// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { LeagueState, PlayerId } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Roster } from '@screens/Roster'
import { createGameStore } from '@store/index'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

/** WRs worst-first by consensus, with the best one hurt: wrong in both ways the auto chart fixes. */
function staleChart(): { league: LeagueState; expected: PlayerId[] } {
  const base = mockLeague()
  const team = base.teams[base.userTeam]!
  const ovr = (id: PlayerId) => base.scouting[id]!.ovr
  const wrs = team.roster
    .map((r) => r.playerId)
    .filter((id) => base.players[id]!.pos === 'WR')
    .sort((a, b) => ovr(b) - ovr(a))
  expect(wrs.length).toBeGreaterThanOrEqual(3)
  const [hurt, ...healthy] = wrs
  const roster = team.roster.map((slot) =>
    slot.playerId === hurt
      ? { ...slot, injured: { weeksOut: 4, kind: 'knee', season: base.season, week: 1 } }
      : slot,
  )
  const league: LeagueState = {
    ...base,
    teams: {
      ...base.teams,
      [base.userTeam]: {
        ...team,
        roster,
        depthChart: { ...team.depthChart, WR: [...wrs].reverse() },
      },
    },
  }
  return { league, expected: [...healthy, hurt!] }
}

describe('Roster: reset depth chart to consensus', () => {
  it('rebuilds the chart by consensus through the store, injured players last', async () => {
    const { league, expected } = staleChart()
    const store = createGameStore({ mode: 'mock' })
    store.setState({ state: league })
    const data = mockStatic()

    function Harness() {
      const state = store((s) => s.state)!
      const actions = store((s) => s.actions)
      return (
        <Roster
          state={state}
          data={data}
          onSelectPlayer={vi.fn()}
          onReorderDepthChart={actions.setDepthChart}
          onResetDepthChart={actions.resetDepthChart}
        />
      )
    }
    render(<Harness />)

    const names = () =>
      within(screen.getByRole('list', { name: 'WR depth chart' }))
        .getAllByRole('listitem')
        .map((el) => el.textContent ?? '')
    const nameOf = (id: PlayerId) => league.players[id]!.name
    expect(names()[0]).toContain(nameOf(expected.at(-2)!))

    await userEvent.click(screen.getByRole('button', { name: 'Reset to consensus' }))

    const after = store.getState().state!
    expect(after.teams[after.userTeam]!.depthChart.WR).toEqual(expected)
    expect(names().map((text, i) => text.includes(nameOf(expected[i]!)))).toEqual(
      expected.map(() => true),
    )
  })
})
