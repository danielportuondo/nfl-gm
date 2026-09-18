// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { TEAM_IDS, type DraftPick, type DraftRoomState, type LeagueState, type StandingRow, type TradeEvaluation, type TradeProposal } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { About } from '@screens/About'
import { Dashboard } from '@screens/Dashboard'
import { DraftRoom } from '@screens/DraftRoom'
import { FreeAgency } from '@screens/FreeAgency'
import { LeagueBrowser } from '@screens/LeagueBrowser'
import { NewGame } from '@screens/NewGame'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'
import { Schedule } from '@screens/Schedule'
import { Standings } from '@screens/Standings'
import { TradeCenter } from '@screens/TradeCenter'
import { AcceptanceBar } from '@ui/primitives'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Draft-room fixture: a one-round order with the user on the clock and one AI pending offer. */
function fixtureDraftRoom(state: LeagueState): DraftRoomState {
  const order: DraftPick[] = TEAM_IDS.map((t, i) => ({ season: state.season + 1, round: 1, pick: i + 1, originalTeam: t, owner: t, playerId: null }))
  const userIndex = (TEAM_IDS as readonly string[]).indexOf(state.userTeam)
  const available = Object.keys(state.scouting).slice(0, 25)
  return {
    season: state.season + 1,
    status: 'ON_CLOCK',
    currentPickIndex: userIndex,
    order,
    available,
    udfaPool: [],
    log: [{ pick: 1, round: 1, team: TEAM_IDS[0]!, playerId: available[0]!, historical: false }],
    pendingOffers: [fixtureTradeProposal(state)],
  }
}

/** Trade-proposal fixture: an AI team offering a player for one of the user's. */
function fixtureTradeProposal(state: LeagueState): TradeProposal {
  const aiTeamId = TEAM_IDS.find((t) => t !== state.userTeam)!
  const aiPlayer = state.teams[aiTeamId]!.roster[0]!.playerId
  const userPlayer = state.teams[state.userTeam]!.roster[0]!.playerId
  return {
    id: 'fixture-offer-1',
    offer: { teamId: aiTeamId, players: [aiPlayer], picks: [] },
    request: { teamId: state.userTeam, players: [userPlayer], picks: [] },
    initiatedBy: 'AI',
    season: state.season,
    week: state.week,
  }
}

const FIXTURE_EVALUATION: TradeEvaluation = { valueIn: 10, valueOut: 8, needAdj: 0, margin: 1, p: 0.62, valid: true, reasons: [] }

function fixtureStandings(): StandingRow[] {
  return TEAM_IDS.map((teamId, i) => ({
    teamId,
    wins: 16 - i,
    losses: i,
    ties: 0,
    pct: (16 - i) / 16,
    pointsFor: 400 - i,
    pointsAgainst: 300 + i,
    divRank: (i % 4) + 1,
    confRank: (i % 16) + 1,
    clinched: i === 0 ? 'DIV' : null,
  }))
}

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

describe('AcceptanceBar', () => {
  it('maps p to a label band and shows Invalid when valid is false', () => {
    render(<AcceptanceBar p={0.1} valid />)
    expect(screen.getByText('Unlikely')).toBeInTheDocument()
    cleanup()
    render(<AcceptanceBar p={0.5} valid />)
    expect(screen.getByText('Coin flip')).toBeInTheDocument()
    cleanup()
    render(<AcceptanceBar p={0.9} valid />)
    expect(screen.getByText('Likely')).toBeInTheDocument()
    cleanup()
    render(<AcceptanceBar p={0.9} valid={false} />)
    expect(screen.getAllByText('Invalid').length).toBeGreaterThan(0)
  })
})

describe('DraftRoom', () => {
  it('renders the on-the-clock hero, the board and an offer with an acceptance bar', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    render(
      <DraftRoom
        state={withRoom}
        data={data}
        onStartDraft={vi.fn()}
        onMakePick={vi.fn()}
        onAutoPick={vi.fn()}
        onSimToMyPick={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onTeamNeeds={() => null}
      />,
    )
    expect(screen.getByText('ON THE CLOCK')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('offers to start the draft when there is no draft room yet', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <DraftRoom
        state={state}
        data={data}
        onStartDraft={vi.fn()}
        onMakePick={vi.fn()}
        onAutoPick={vi.fn()}
        onSimToMyPick={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onTeamNeeds={() => null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start draft' })).toBeInTheDocument()
  })
})

describe('TradeCenter', () => {
  it('renders both asset pickers and an incoming offer', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <TradeCenter
        state={state}
        data={data}
        tradeOffers={[fixtureTradeProposal(state)]}
        onEvaluate={() => FIXTURE_EVALUATION}
        onProposeTrade={vi.fn()}
        onRespondToOffer={vi.fn()}
        onRefreshOffers={vi.fn()}
      />,
    )
    expect(screen.getByText('Your offer')).toBeInTheDocument()
    expect(screen.getByText('Their side')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Offer trade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
  })
})

describe('FreeAgency', () => {
  it('renders the free agent pool and cap tiles', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <FreeAgency
        state={state}
        data={data}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => null}
      />,
    )
    expect(screen.getByText('Free agent pool')).toBeInTheDocument()
    expect(screen.getByText('Cap this season')).toBeInTheDocument()
  })
})

describe('Schedule', () => {
  it('renders sim controls and the user schedule', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(<Schedule state={state} data={data} onSimWeek={vi.fn()} onSimToNextEvent={vi.fn()} onSimSeason={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Sim week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sim to next event' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sim season' })).toBeInTheDocument()
    expect(screen.getByText('Your schedule')).toBeInTheDocument()
  })
})

describe('Standings', () => {
  it('renders a division table for every conference/division', () => {
    const data = mockStatic()
    render(<Standings data={data} rows={fixtureStandings()} />)
    expect(screen.getByText('AFC East')).toBeInTheDocument()
    expect(screen.getByText('NFC West')).toBeInTheDocument()
  })

  it('shows a not-built message with no standings rows', () => {
    const data = mockStatic()
    render(<Standings data={data} rows={[]} />)
    expect(screen.getByText('Not built yet.')).toBeInTheDocument()
  })
})

describe('LeagueBrowser', () => {
  it('renders the team grid and the selected team roster', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(<LeagueBrowser state={state} data={data} onSelectPlayer={vi.fn()} />)
    expect(screen.getByText('Teams')).toBeInTheDocument()
    const rows = document.querySelectorAll('.gg-table tbody tr')
    expect(rows.length).toBe(53)
  })
})
