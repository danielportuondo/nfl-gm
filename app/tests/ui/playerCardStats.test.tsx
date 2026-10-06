// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { Game, GameResult, LeagueState, PlayerGameLine, PlayerId } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { PlayerCard } from '@screens/PlayerCard'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

function playerAt(state: LeagueState, pos: string): PlayerId {
  const slot = state.teams[state.userTeam]!.roster.find(
    (r) => state.players[r.playerId]!.pos === pos,
  )
  return slot!.playerId
}

/** Two simmed games for the user team, one regular season and one divisional playoff. */
function withGames(state: LeagueState, lines: PlayerGameLine[]): LeagueState {
  const team = state.userTeam
  const games: Game[] = [
    { id: 'x1', season: state.season, week: 1, type: 'REG', home: team, away: 'KC' },
    { id: 'x2', season: state.season, week: 19, type: 'DIV', home: team, away: 'KC' },
  ]
  const results: GameResult[] = [
    {
      gameId: 'x1',
      homeScore: 24,
      awayScore: 10,
      overtime: false,
      box: { home: lines.filter((l) => l.passAtt === 400 || l.tackles === 90), away: [] },
      injuries: [],
    },
    {
      gameId: 'x2',
      homeScore: 20,
      awayScore: 21,
      overtime: false,
      box: { home: lines.filter((l) => l.passAtt === 30 || l.tackles === 7), away: [] },
      injuries: [],
    },
  ]
  return { ...state, schedule: [...state.schedule, ...games], results }
}

describe('PlayerCard stat line', () => {
  it('shows a quarterback passing and rushing line, with playoffs on their own row', () => {
    const base = mockLeague()
    const qb = playerAt(base, 'QB')
    const state = withGames(base, [
      {
        playerId: qb,
        teamId: base.userTeam,
        passAtt: 400,
        passCmp: 280,
        passYds: 3500,
        passTd: 25,
        passInt: 8,
        rushYds: 120,
        rushTd: 2,
      },
      { playerId: qb, teamId: base.userTeam, passAtt: 30, passCmp: 20, passYds: 210, passTd: 1 },
    ])
    render(<PlayerCard state={state} data={mockStatic()} playerId={qb} onBack={vi.fn()} />)

    expect(screen.getByText(`${state.season} regular season`)).toBeInTheDocument()
    const tiles = within(screen.getByRole('group', { name: /regular season line/i }))
    expect(tiles.getByText('3,500')).toBeInTheDocument()
    expect(tiles.getByText('280/400')).toBeInTheDocument()
    expect(tiles.getByText('Rushing yards')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: /season by season/i })
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[2]!).getByText(`${state.season} playoffs`)).toBeInTheDocument()
    expect(within(rows[2]!).getByText('210')).toBeInTheDocument()
  })

  it('shows a defender tackles, sacks, interceptions and passes defended', () => {
    const base = mockLeague()
    const lb = playerAt(base, 'LB')
    const state = withGames(base, [
      {
        playerId: lb,
        teamId: base.userTeam,
        tackles: 90,
        sacks: 6,
        ints: 2,
        passesDefended: 5,
        forcedFumbles: 1,
      },
      { playerId: lb, teamId: base.userTeam, tackles: 7 },
    ])
    render(<PlayerCard state={state} data={mockStatic()} playerId={lb} onBack={vi.fn()} />)

    const tiles = screen.getByRole('group', { name: /regular season line/i })
    expect(within(tiles).getByText('Tackles')).toBeInTheDocument()
    expect(within(tiles).getByText('90')).toBeInTheDocument()
    expect(within(tiles).getByText('Sacks')).toBeInTheDocument()
    expect(within(tiles).getByText('Passes defended')).toBeInTheDocument()
  })

  it('keeps the empty message when no stats exist', () => {
    const state = mockLeague()
    const qb = playerAt(state, 'QB')
    render(<PlayerCard state={state} data={mockStatic()} playerId={qb} onBack={vi.fn()} />)
    expect(screen.getByText(/No stats yet/)).toBeInTheDocument()
  })

  it('says linemen are not tracked instead of promising stats after a sim', () => {
    const state = mockLeague()
    const ol = playerAt(state, 'OL')
    render(<PlayerCard state={state} data={mockStatic()} playerId={ol} onBack={vi.fn()} />)
    expect(screen.getByText(/don't track offensive linemen/)).toBeInTheDocument()
  })
})
