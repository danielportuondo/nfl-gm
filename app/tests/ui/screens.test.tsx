// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { About } from '@screens/About'
import { Dashboard } from '@screens/Dashboard'
import { NewGame } from '@screens/NewGame'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  expect(errorSpy).not.toHaveBeenCalled()
  errorSpy.mockRestore()
  cleanup()
})

describe('NewGame', () => {
  it('renders the mandate sentence and a Start button', () => {
    const data = mockStatic()
    render(<NewGame data={data} onStart={vi.fn()} />)
    expect(screen.getByText(/Your mandate: win the Super Bowl by \d{4}\. That's \d+ seasons?\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })
})

describe('Dashboard', () => {
  it('renders the team record', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(<Dashboard state={state} data={data} onSimWeek={vi.fn()} onAdvancePhase={vi.fn()} />)
    const record = state.teams[state.userTeam]!.record
    expect(screen.getByText(new RegExp(`${record.wins}-${record.losses}`))).toBeInTheDocument()
  })
})

describe('Roster', () => {
  it('renders all 53 roster rows', () => {
    const state = mockLeague()
    const data = mockStatic()
    const { container } = render(
      <Roster state={state} data={data} onSelectPlayer={vi.fn()} onReorderDepthChart={vi.fn()} />,
    )
    const rows = container.querySelectorAll('.gg-table tbody tr')
    expect(rows.length).toBe(53)
  })
})

describe('PlayerCard', () => {
  it('renders the player name and consensus ratings', () => {
    const state = mockLeague()
    const data = mockStatic()
    const playerId = state.teams[state.userTeam]!.roster[0]!.playerId
    render(<PlayerCard state={state} data={data} playerId={playerId} onBack={vi.fn()} />)
    expect(screen.getByRole('heading', { name: state.players[playerId]!.name })).toBeInTheDocument()
    expect(screen.getAllByText(String(state.scouting[playerId]!.ovr)).length).toBeGreaterThan(0)
  })
})

describe('About', () => {
  it('renders the disclaimer verbatim from docs/HANDOFF.md §2', () => {
    render(<About />)
    expect(
      screen.getByText(
        'Unofficial fan-made project. Not affiliated with or endorsed by the NFL, its teams, or the NFLPA. Data courtesy of nflverse (CC BY 4.0).',
      ),
    ).toBeInTheDocument()
  })
})
