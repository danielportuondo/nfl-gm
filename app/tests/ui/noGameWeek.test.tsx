// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LeagueState, WeekReport } from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { Dashboard } from '@screens/Dashboard'
import { Schedule } from '@screens/Schedule'

/** The mock league in REGULAR, with the user's first game removed so that week has no game. */
function userOffWeek(): { state: LeagueState; week: number } {
  const base = mockLeague()
  const userGames = base.schedule
    .filter(
      (g) =>
        g.season === base.season &&
        g.type === 'REG' &&
        (g.home === base.userTeam || g.away === base.userTeam),
    )
    .sort((a, b) => a.week - b.week)
  const dropped = userGames[0]!
  return {
    state: {
      ...base,
      phase: 'REGULAR',
      week: dropped.week,
      schedule: base.schedule.filter((g) => g.id !== dropped.id),
    },
    week: dropped.week,
  }
}

describe('a week without a game for the user', () => {
  it('says so on the Dashboard', () => {
    const { state } = userOffWeek()
    render(
      <Dashboard
        state={state}
        data={mockStatic()}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
      />,
    )
    expect(screen.getByText(/No game for your team this week/)).toBeInTheDocument()
  })

  it('lists the week on the Schedule with the reason', () => {
    const { state, week } = userOffWeek()
    render(
      <Schedule
        state={state}
        data={mockStatic()}
        onSimWeek={vi.fn()}
        onSimToNextEvent={vi.fn()}
        onSimSeason={vi.fn()}
      />,
    )
    const row = screen.getByRole('row', { name: new RegExp(`^${week}\\b`) })
    expect(row.textContent).toMatch(/No game/)
  })

  it('explains the empty week when it is simmed', async () => {
    const { state } = userOffWeek()
    const simWeek = (s: LeagueState): WeekReport => ({
      state: { ...s, week: s.week + 1 },
      gamesPlayed: 15,
      events: [],
    })
    const store = createGameStore({
      mode: 'mock',
      modules: { league: { ...defaultEngineModules.league, simWeek } },
    })
    await store.getState().actions.newGame({
      startSeason: state.season,
      userTeam: state.userTeam,
      horizonSeasons: 3,
      settings: state.settings,
    })
    store.setState({ state })
    await store.getState().actions.simWeek()
    const messages = store.getState().toasts.map((t) => t.text)
    expect(messages.some((m) => /No game for your team this week/.test(m))).toBe(true)
  })
})
