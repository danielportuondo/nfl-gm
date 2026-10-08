// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { LeagueState, PlayerId } from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Finances } from '@screens/Finances'
import { Roster } from '@screens/Roster'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

const IMPACT = { deadMoney: 8.1, frees: 3.4 }

function renderRoster(onRelease = vi.fn()) {
  const state = mockLeague()
  const slot = state.teams[state.userTeam]!.roster[0]!
  const name = state.players[slot.playerId]!.name
  const releaseImpact = vi.fn(() => IMPACT)
  render(
    <Roster
      state={state}
      data={mockStatic()}
      onSelectPlayer={vi.fn()}
      onReorderDepthChart={vi.fn()}
      onRelease={onRelease}
      releaseImpact={releaseImpact}
    />,
  )
  return { name, id: slot.playerId, onRelease, releaseImpact }
}

describe('Release confirm', () => {
  it('asks first and shows the cap effect, then releases on confirm', async () => {
    const { name, id, onRelease, releaseImpact } = renderRoster()

    await userEvent.click(screen.getByRole('button', { name: `Release ${name}` }))

    expect(onRelease).not.toHaveBeenCalled()
    expect(releaseImpact).toHaveBeenCalledWith([id])
    const dialog = screen.getByRole('dialog', { name: `Release ${name}?` })
    expect(dialog).toHaveTextContent('Dead money $8.1M this season, frees $3.4M.')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Release' }))

    expect(onRelease).toHaveBeenCalledExactlyOnceWith(id)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says which league year an offseason release hits', async () => {
    const state = { ...mockLeague(), phase: 'TRAINING_CAMP' as const }
    const name = state.players[state.teams[state.userTeam]!.roster[0]!.playerId]!.name
    render(
      <Roster
        state={state}
        data={mockStatic()}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
        onRelease={vi.fn()}
        releaseImpact={() => ({ ...IMPACT, season: 2016 })}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: `Release ${name}` }))

    expect(screen.getByRole('dialog')).toHaveTextContent('Dead money $8.1M on the 2016 cap')
  })

  it('does nothing when the user cancels', async () => {
    const { name, onRelease } = renderRoster()

    await userEvent.click(screen.getByRole('button', { name: `Release ${name}` }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onRelease).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('confirms on the Finances screen too', async () => {
    const state = mockLeague()
    const onRelease = vi.fn()
    render(
      <Finances
        state={state}
        data={mockStatic()}
        cap={200}
        capNextSeason={210}
        onRelease={onRelease}
        releaseImpact={() => IMPACT}
      />,
    )

    await userEvent.click(screen.getAllByRole('button', { name: /^Release/ })[0]!)
    expect(onRelease).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Release' }))
    expect(onRelease).toHaveBeenCalledOnce()
  })
})

describe('releaseImpact selector', () => {
  it("reports the engine's dead money and what the release frees, without touching state", async () => {
    const base = mockLeague()
    const slot = base.teams[base.userTeam]!.roster[0]!
    const release = vi.fn((s: LeagueState, teamId: string, id: PlayerId): LeagueState => {
      const team = s.teams[teamId]!
      return {
        ...s,
        teams: {
          ...s.teams,
          [teamId]: {
            ...team,
            roster: team.roster.filter((r) => r.playerId !== id),
            deadMoney: team.deadMoney + 2,
          },
        },
      }
    })
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
    const before = store.getState().state
    const heldSlot = before!.teams[base.userTeam]!.roster.find((r) => r.playerId === slot.playerId)!

    const impact = store.getState().actions.releaseImpact([slot.playerId])

    expect(impact?.deadMoney).toBeCloseTo(2)
    expect(impact?.frees).toBeCloseTo(heldSlot.contract.apy - 2)
    expect(store.getState().state).toBe(before)
  })
})
