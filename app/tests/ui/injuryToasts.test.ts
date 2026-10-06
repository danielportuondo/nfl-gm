import type { GameResult, InjuryEvent, LeagueState, WeekReport } from '@contracts/index'
import { createGameStore } from '@store/index'
import { defaultEngineModules } from '@store/engineDefaults'
import { mockLeague } from '@fixtures/mockLeague'
import { describe, expect, it } from 'vitest'

function lastName(state: LeagueState, id: string): string {
  return state.players[id]!.name.split(' ').at(-1)!
}

function result(n: number, injuries: InjuryEvent[]): GameResult {
  return { gameId: `g${n}`, homeScore: 20, awayScore: 17, overtime: false, injuries }
}

/**
 * Plays a week of 16 games. Every game reports an injury event string the way the engine does, but
 * only the user's team (two players) and one other team's player actually get hurt.
 */
function weekWithInjuries(userTeam: string, userHurt: InjuryEvent[], otherHurt: InjuryEvent[]) {
  return (state: LeagueState): WeekReport => {
    const games = Array.from({ length: 16 }, (_, i) =>
      result(i, i === 0 ? userHurt : i === 1 ? otherHurt : []),
    )
    return {
      state: { ...state, week: state.week + 1, results: [...state.results, ...games] },
      gamesPlayed: 16,
      events: games.map((_, i) => `${userTeam} @ T${i}: 1 injury event(s)`),
    }
  }
}

async function startSeason(simWeek: (s: LeagueState) => WeekReport) {
  const base = mockLeague()
  const store = createGameStore({
    mode: 'mock',
    modules: { league: { ...defaultEngineModules.league, simWeek } },
  })
  await store.getState().actions.newGame({
    startSeason: base.season,
    userTeam: base.userTeam,
    horizonSeasons: 3,
    settings: base.settings,
  })
  store.setState((s) => ({ state: { ...s.state!, phase: 'REGULAR', week: 1 } }))
  return store
}

function hurt(state: LeagueState, teamId: string, index: number, weeksOut: number): InjuryEvent {
  return {
    playerId: state.teams[teamId]!.roster[index]!.playerId,
    teamId,
    weeksOut,
    kind: 'knee',
  }
}

describe('injury toasts', () => {
  it("sums up the user's injuries in one toast and ignores the rest of the league", async () => {
    const base = mockLeague()
    const user = base.userTeam
    const other = Object.keys(base.teams).find((t) => t !== user)!
    const userHurt = [hurt(base, user, 0, 3), hurt(base, user, 1, 1)]
    const store = await startSeason(weekWithInjuries(user, userHurt, [hurt(base, other, 0, 6)]))
    const state = store.getState().state!

    await store.getState().actions.simWeek()

    const toasts = store.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]!.text).toBe(
      `2 injuries: ${lastName(state, userHurt[0]!.playerId)} (3 wk), ${lastName(state, userHurt[1]!.playerId)} (1 wk)`,
    )
  })

  it('shows nothing when only other teams got hurt', async () => {
    const base = mockLeague()
    const other = Object.keys(base.teams).find((t) => t !== base.userTeam)!
    const store = await startSeason(weekWithInjuries(base.userTeam, [], [hurt(base, other, 0, 6)]))

    await store.getState().actions.simWeek()

    expect(store.getState().toasts).toHaveLength(0)
  })

  it('clears old toasts when a new sim starts', async () => {
    const base = mockLeague()
    const store = await startSeason(weekWithInjuries(base.userTeam, [], []))
    store.setState({ toasts: [{ id: 'old', text: 'Released 2 players', tone: 'info' }] })

    await store.getState().actions.simWeek()

    expect(store.getState().toasts.find((t) => t.id === 'old')).toBeUndefined()
  })

  it('gives a whole simmed run one toast, not one per week', async () => {
    const base = mockLeague()
    const user = base.userTeam
    const simWeek = (state: LeagueState): WeekReport => {
      const report = weekWithInjuries(user, [hurt(base, user, state.week, 2)], [])(state)
      return {
        ...report,
        state: { ...report.state, phase: state.week >= 4 ? 'OFFSEASON_RESIGN' : 'REGULAR' },
      }
    }
    const store = await startSeason(simWeek)

    await store.getState().actions.simSeason()

    const injuryToasts = store.getState().toasts.filter((t) => /injur/.test(t.text))
    expect(injuryToasts).toHaveLength(1)
    expect(injuryToasts[0]!.text).toMatch(/^4 injuries: /)
  })

  it('never queues more than three toasts', async () => {
    const base = mockLeague()
    const store = await startSeason(weekWithInjuries(base.userTeam, [], []))
    for (let i = 0; i < 6; i++) await store.getState().actions.save()
    expect(store.getState().toasts.length).toBeLessThanOrEqual(3)
  })
})
