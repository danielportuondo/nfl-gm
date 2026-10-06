// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  TEAM_IDS,
  type DraftPick,
  type DraftRoomState,
  type LeagueState,
  type SaveSlotMeta,
  type SeasonSummary,
  type StandingRow,
  type TradeEvaluation,
  type TradeProposal,
} from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { About } from '@screens/About'
import { Dashboard } from '@screens/Dashboard'
import { DraftRoom } from '@screens/DraftRoom'
import { EndGame } from '@screens/EndGame'
import { Finances } from '@screens/Finances'
import { FreeAgency } from '@screens/FreeAgency'
import { LeagueBrowser } from '@screens/LeagueBrowser'
import { NewGame } from '@screens/NewGame'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'
import { Schedule } from '@screens/Schedule'
import { SeasonRecap } from '@screens/SeasonRecap'
import { Settings } from '@screens/Settings'
import { Standings } from '@screens/Standings'
import { TradeCenter } from '@screens/TradeCenter'
import { AcceptanceBar } from '@ui/primitives'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Draft-room fixture: rounds 1-2 with the user on the clock in round 1, a pick traded away from
 * the round's first team, a couple of picks already made, and one AI pending offer.
 */
function fixtureDraftRoom(state: LeagueState): DraftRoomState {
  const round1: DraftPick[] = TEAM_IDS.map((t, i) => ({
    season: state.season + 1,
    round: 1,
    pick: i + 1,
    originalTeam: t,
    owner: t,
    playerId: null,
  }))
  const round2: DraftPick[] = TEAM_IDS.map((t, i) => ({
    season: state.season + 1,
    round: 2,
    pick: TEAM_IDS.length + i + 1,
    originalTeam: t,
    owner: t,
    playerId: null,
  }))
  const userIndex = (TEAM_IDS as readonly string[]).indexOf(state.userTeam)
  const available = Object.keys(state.scouting).slice(0, 25)

  // Pick 1 is traded to the second team in draft order; its originalTeam stays put.
  const tradedOwner = TEAM_IDS[1]!
  round1[0] = { ...round1[0]!, owner: tradedOwner }

  // A couple of picks ahead of the user are already made.
  for (let i = 0; i < Math.min(2, userIndex); i++) {
    round1[i] = { ...round1[i]!, playerId: available[i]! }
  }

  return {
    season: state.season + 1,
    status: 'ON_CLOCK',
    currentPickIndex: userIndex,
    order: [...round1, ...round2],
    available,
    udfaPool: [],
    log: [{ pick: 1, round: 1, team: tradedOwner, playerId: available[0]!, historical: false }],
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

const FIXTURE_EVALUATION: TradeEvaluation = {
  valueIn: 10,
  valueOut: 8,
  needAdj: 0,
  margin: 1,
  p: 0.62,
  valid: true,
  reasons: [],
}

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

/** A completed-season fixture for Season Recap / End Game (docs/HANDOFF.md Phase 5A brief item 6). */
function fixtureSeasonSummary(state: LeagueState): SeasonSummary {
  return {
    season: state.season,
    champion: state.userTeam,
    runnerUp: TEAM_IDS.find((t) => t !== state.userTeam)!,
    standings: fixtureStandings(),
    awards: [],
    userTeam: state.userTeam,
    userRecord: state.teams[state.userTeam]!.record,
    userPlayoffExit: 'CHAMPION',
  }
}

/** A save-file `File` whose `.text()` resolves without depending on jsdom's Blob/File support. */
function fixtureSaveFile(json: string): File {
  const file = new File([json], 'save.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => json })
  return file
}

const SAVED_GAME: SaveSlotMeta = {
  slot: 'default',
  userTeam: 'IND',
  season: 2015,
  week: 0,
  phase: 'PRESEASON',
  startSeason: 2015,
  horizonEnd: 2017,
  savedAt: '2026-09-20T00:00:00.000Z',
  schemaVersion: 1,
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
    expect(
      screen.getByText(/Your mandate: win the Super Bowl by \d{4}\. That's \d+ seasons?\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('imports a save file immediately when there is no saved game to protect', async () => {
    const onImportSave = vi.fn()
    render(<NewGame data={mockStatic()} onStart={vi.fn()} onImportSave={onImportSave} />)

    fireEvent.change(screen.getByLabelText('Choose a save file'), {
      target: { files: [fixtureSaveFile('{"a":1}')] },
    })

    await waitFor(() => expect(onImportSave).toHaveBeenCalledWith('{"a":1}'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('confirms before replacing a saved game', async () => {
    const onImportSave = vi.fn()
    render(
      <NewGame
        data={mockStatic()}
        onStart={vi.fn()}
        savedGame={SAVED_GAME}
        onContinue={vi.fn()}
        onImportSave={onImportSave}
      />,
    )

    fireEvent.change(screen.getByLabelText('Choose a save file'), {
      target: { files: [fixtureSaveFile('{"a":1}')] },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Replace saved game?' })
    expect(onImportSave).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep saved game' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onImportSave).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Choose a save file'), {
      target: { files: [fixtureSaveFile('{"a":1}')] },
    })
    const dialog2 = await screen.findByRole('dialog', { name: 'Replace saved game?' })
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Replace' }))
    expect(onImportSave).toHaveBeenCalledWith('{"a":1}')
  })
})

describe('Settings', () => {
  function renderSettings(overrides: Partial<Parameters<typeof Settings>[0]> = {}) {
    const state = mockLeague()
    const props = {
      state,
      data: mockStatic(),
      theme: 'dark' as const,
      onSetTheme: vi.fn(),
      onUpdateSettings: vi.fn(),
      onStartOver: vi.fn(),
      onExportSave: vi.fn(),
      onImportSave: vi.fn(),
      ...overrides,
    }
    render(<Settings {...props} />)
    return props
  }

  it('shows the stored theme and the running game settings', () => {
    const { state } = renderSettings()
    expect(screen.getByRole('button', { name: 'Dark', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'System', pressed: false })).toBeInTheDocument()
    expect(screen.getByLabelText('Trade strictness')).toHaveValue(state.settings.tradeStrictness)
    expect(screen.getByLabelText('AI offer frequency')).toHaveValue(state.settings.aiOfferFrequency)
    expect(screen.getByLabelText('Injuries')).toBeChecked()
  })

  it('reports a theme pick and a settings change straight away', async () => {
    const user = userEvent.setup()
    const { onSetTheme, onUpdateSettings } = renderSettings()
    await user.click(screen.getByRole('button', { name: 'Light' }))
    expect(onSetTheme).toHaveBeenCalledWith('light')
    await user.selectOptions(screen.getByLabelText('Trade strictness'), 'ruthless')
    expect(onUpdateSettings).toHaveBeenCalledWith({ tradeStrictness: 'ruthless' })
    await user.click(screen.getByLabelText('Injuries'))
    expect(onUpdateSettings).toHaveBeenCalledWith({ injuries: false })
  })

  it('asks before starting over, and only leaves once confirmed', async () => {
    const user = userEvent.setup()
    const { onStartOver } = renderSettings()
    await user.click(screen.getByRole('button', { name: 'Start over' }))
    const dialog = screen.getByRole('dialog', { name: 'Start over?' })
    expect(onStartOver).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Keep playing' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onStartOver).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Start over' }))
    await user.click(
      within(screen.getByRole('dialog', { name: 'Start over?' })).getByRole('button', {
        name: 'Start over',
      }),
    )
    expect(onStartOver).toHaveBeenCalledTimes(1)
  })

  it('exports the save when asked', async () => {
    const user = userEvent.setup()
    const { onExportSave } = renderSettings()
    await user.click(screen.getByRole('button', { name: 'Export save' }))
    expect(onExportSave).toHaveBeenCalledTimes(1)
  })

  it('confirms before replacing the game with an imported save', async () => {
    const { onImportSave } = renderSettings()

    fireEvent.change(screen.getByLabelText('Choose a save file'), {
      target: { files: [fixtureSaveFile('{"a":1}')] },
    })
    const dialog = await screen.findByRole('dialog', { name: 'Replace current game?' })
    expect(onImportSave).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep current' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onImportSave).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Choose a save file'), {
      target: { files: [fixtureSaveFile('{"a":1}')] },
    })
    const dialog2 = await screen.findByRole('dialog', { name: 'Replace current game?' })
    fireEvent.click(within(dialog2).getByRole('button', { name: 'Replace' }))
    expect(onImportSave).toHaveBeenCalledWith('{"a":1}')
  })
})

describe('Dashboard', () => {
  it('renders the team record', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <Dashboard
        state={state}
        data={data}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
      />,
    )
    const record = state.teams[state.userTeam]!.record
    expect(screen.getByText(new RegExp(`${record.wins}-${record.losses}`))).toBeInTheDocument()
  })

  it('routes an alert to the screen that can fix it', async () => {
    const state = mockLeague()
    const team = state.teams[state.userTeam]!
    const overCap: LeagueState = {
      ...state,
      teams: { ...state.teams, [state.userTeam]: { ...team, deadMoney: team.deadMoney + 500 } },
    }
    const onNavigate = vi.fn()
    const data = mockStatic()
    render(
      <Dashboard
        state={overCap}
        data={data}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
        onNavigate={onNavigate}
      />,
    )
    await userEvent.click(screen.getByText(/Over the cap/))
    expect(onNavigate).toHaveBeenCalledWith('finances')
  })

  it('points at the Draft room while a draft is waiting or under way', () => {
    const onNavigate = vi.fn()
    const base = mockLeague()
    render(
      <Dashboard
        state={{ ...base, phase: 'DRAFT', draftRoom: null }}
        data={mockStatic()}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(screen.getByText('The 2016 draft is waiting.'))
    expect(onNavigate).toHaveBeenCalledWith('draft')
  })

  it('does not show a finished game as the next one during the offseason', () => {
    const base = mockLeague()
    const userGames = base.schedule.filter(
      (g) => g.season === base.season && (g.home === base.userTeam || g.away === base.userTeam),
    )
    // The whole season is in the books, but the phase rollover can leave `week` low again — the
    // Super Bowl (which has a result) must not read as "next" (docs/HANDOFF.md QA sweep item 10).
    const offseason: LeagueState = {
      ...base,
      phase: 'OFFSEASON_RESIGN',
      week: 0,
      results: userGames.map((g) => ({
        gameId: g.id,
        homeScore: 20,
        awayScore: 17,
        overtime: false,
        injuries: [],
      })),
    }
    render(
      <Dashboard
        state={offseason}
        data={mockStatic()}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
      />,
    )
    expect(screen.queryByText(/at week/)).not.toBeInTheDocument()
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

  it('shows the injured badge and weeks out for an injured roster slot', () => {
    const state = mockLeague()
    const team = state.teams[state.userTeam]!
    const injuredSlot = {
      ...team.roster[0]!,
      injured: { weeksOut: 3, kind: 'knee', season: state.season, week: 1 },
    }
    const withInjury: LeagueState = {
      ...state,
      teams: {
        ...state.teams,
        [state.userTeam]: { ...team, roster: [injuredSlot, ...team.roster.slice(1)] },
      },
    }
    const data = mockStatic()
    render(
      <Roster
        state={withInjury}
        data={data}
        onSelectPlayer={vi.fn()}
        onReorderDepthChart={vi.fn()}
      />,
    )
    expect(screen.getByText('Injured')).toBeInTheDocument()
    expect(screen.getByText('Out 3 wk')).toBeInTheDocument()
  })

  it('opens a player with Enter on a focused row (keyboard-only, docs/DESIGN.md §10)', async () => {
    const state = mockLeague()
    const data = mockStatic()
    const onSelectPlayer = vi.fn()
    const { container } = render(
      <Roster
        state={state}
        data={data}
        onSelectPlayer={onSelectPlayer}
        onReorderDepthChart={vi.fn()}
      />,
    )
    const firstRow = container.querySelector<HTMLElement>('.gg-table tbody tr')!
    expect(firstRow).toHaveAttribute('tabindex', '0')
    firstRow.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelectPlayer).toHaveBeenCalledTimes(1)
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

  it('mentions the nflverse CC BY 4.0 attribution exactly once', () => {
    render(<About />)
    expect(screen.getAllByText(/CC BY 4\.0/)).toHaveLength(1)
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

  it('never calls a deal below even Fair in fairness mode', () => {
    const cases: [number, string][] = [
      [0.3, 'Against you'],
      [0.47, 'Slightly against you'],
      [0.55, 'Fair'],
      [0.7, 'Favors you'],
    ]
    for (const [p, text] of cases) {
      render(<AcceptanceBar p={p} valid mode="fairness" />)
      expect(screen.getByText(text)).toBeInTheDocument()
      cleanup()
    }
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
        onSimNextPick={vi.fn()}
        onProposeTrade={vi.fn()}
        onOpenTradeCenter={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onFairness={() => 0.74}
        onTeamNeeds={() => null}
      />,
    )
    expect(screen.getByText('ON THE CLOCK')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
    // The offer is AI-initiated, so the meter reads trade.fairness (74%), not onEvaluate's p (62%) —
    // the AI's own acceptance math, which is the wrong thing to show on a deal it already proposed.
    expect(screen.getByText('74%')).toBeInTheDocument()
    expect(screen.queryByText('62%')).not.toBeInTheDocument()
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
        onSimNextPick={vi.fn()}
        onProposeTrade={vi.fn()}
        onOpenTradeCenter={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onFairness={() => 0.74}
        onTeamNeeds={() => null}
      />,
    )
    expect(screen.getByRole('button', { name: 'Start draft' })).toBeInTheDocument()
  })

  function renderDraftRoom(state: LeagueState, data: ReturnType<typeof mockStatic>) {
    return render(
      <DraftRoom
        state={state}
        data={data}
        onStartDraft={vi.fn()}
        onMakePick={vi.fn()}
        onAutoPick={vi.fn()}
        onSimToMyPick={vi.fn()}
        onSimNextPick={vi.fn()}
        onProposeTrade={vi.fn()}
        onOpenTradeCenter={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onFairness={() => 0.74}
        onTeamNeeds={() => null}
      />,
    )
  }

  /** QA M3: the room waits on an AI pick so the user can sim one pick at a time or trade for it. */
  describe('with an AI team on the clock', () => {
    function renderAiOnClock() {
      const state = mockLeague()
      const data = mockStatic()
      const base = fixtureDraftRoom(state)
      const room = { ...base, currentPickIndex: base.currentPickIndex + 1, pendingOffers: [] }
      const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
      const handlers = {
        onSimNextPick: vi.fn(),
        onSimToMyPick: vi.fn(),
        onProposeTrade: vi.fn(),
        onOpenTradeCenter: vi.fn(),
      }
      render(
        <DraftRoom
          state={withRoom}
          data={data}
          onStartDraft={vi.fn()}
          onMakePick={vi.fn()}
          onAutoPick={vi.fn()}
          onFinishDraft={vi.fn()}
          onRespondToOffer={vi.fn()}
          onEvaluate={() => FIXTURE_EVALUATION}
          onFairness={() => 0.74}
          onTeamNeeds={() => null}
          {...handlers}
        />,
      )
      return { state: withRoom, slot: room.order[room.currentPickIndex]!, handlers }
    }

    it('sims one pick or runs to the user’s pick', () => {
      const { handlers } = renderAiOnClock()
      expect(screen.queryByText('ON THE CLOCK')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Sim next pick' }))
      expect(handlers.onSimNextPick).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Sim to my pick' }))
      expect(handlers.onSimToMyPick).toHaveBeenCalledTimes(1)
    })

    it('proposes the user’s picks for the on-clock pick', () => {
      const { state, slot, handlers } = renderAiOnClock()
      const offerButton = screen.getByRole('button', { name: 'Offer trade' })
      expect(offerButton).toBeDisabled()

      const group = screen.getByRole('group', { name: 'Your picks to offer' })
      fireEvent.click(within(group).getAllByRole('button')[0]!)
      fireEvent.click(offerButton)

      expect(handlers.onProposeTrade).toHaveBeenCalledTimes(1)
      const proposal = handlers.onProposeTrade.mock.calls[0]![0] as TradeProposal
      expect(proposal.initiatedBy).toBe('USER')
      expect(proposal.offer.teamId).toBe(state.userTeam)
      expect(proposal.offer.picks).toHaveLength(1)
      expect(proposal.request).toEqual({
        teamId: slot.owner,
        players: [],
        picks: [
          {
            season: slot.season,
            round: slot.round,
            originalTeam: slot.originalTeam,
            pick: slot.pick,
          },
        ],
      })

      fireEvent.click(screen.getByRole('button', { name: 'Open trades' }))
      expect(handlers.onOpenTradeCenter).toHaveBeenCalledTimes(1)
    })
  })

  it('hides the trade-up panel and Sim next pick while the user is on the clock', () => {
    const state = mockLeague()
    const room = fixtureDraftRoom(state)
    renderDraftRoom({ ...state, draftRoom: room, phase: 'DRAFT' as const }, mockStatic())
    expect(screen.getByRole('button', { name: 'Sim next pick' })).toBeDisabled()
    expect(screen.queryByText('Trade for this pick')).not.toBeInTheDocument()
  })

  it('shows the current round of the pick board with owner abbrs and a traded pick', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))

    expect(screen.getByText('Pick board, round 1')).toBeInTheDocument()
    const tradedOwner = data.teams[room.order[0]!.owner]!.abbr
    const originalTeam = data.teams[room.order[0]!.originalTeam]!.abbr
    expect(screen.getAllByText(tradedOwner).length).toBeGreaterThan(0)
    expect(screen.getByText(`from ${originalTeam}`)).toBeInTheDocument()
  })

  it('shows a made pick with its player and grade, and — for an unmade pick', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))

    const table = screen.getByText('Pick board, round 1').closest('table')!
    const rowFor = (pick: number) =>
      within(table)
        .getAllByRole('row')
        .find((r) => within(r).queryByText(String(pick)) !== null)!

    const madePick = room.order[0]!
    const madePlayer = state.players[madePick.playerId!]!
    const madeScouting = state.scouting[madePick.playerId!]!
    const madeRow = rowFor(madePick.pick!)
    expect(within(madeRow).getByText(madePlayer.name)).toBeInTheDocument()
    // Consensus ovr/pot are floats; the grade must render rounded to whole numbers.
    const expectedGrade = `${Math.round(madeScouting.ovr)}/${Math.round(madeScouting.pot)}`
    expect(within(madeRow).getByText(expectedGrade)).toBeInTheDocument()
    expect(within(madeRow).getByText(/^\d+\/\d+$/)).toBeInTheDocument()

    const unmadeIndex = room.order.findIndex(
      (p, i) => p.round === 1 && p.playerId === null && i !== room.currentPickIndex,
    )
    const unmadePick = room.order[unmadeIndex]!
    const unmadeRow = rowFor(unmadePick.pick!)
    expect(within(unmadeRow).getByText('—')).toBeInTheDocument()
  })

  it('marks the on-the-clock slot and the user’s own pick', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))

    const onClockText = screen.getByText('On the clock')
    expect(onClockText).toBeInTheDocument()
    expect(onClockText.closest('tr')).toHaveAttribute('data-tone', 'attention')

    const yoursText = screen.getByText('Your pick')
    expect(yoursText).toBeInTheDocument()
    // The user is on the clock in this fixture, so this row tones as attention, not yours.
    expect(yoursText.closest('tr')).toHaveAttribute('data-tone', 'attention')
  })

  it('tones a future user pick "yours" when it is not the one on the clock', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Round 2' }))

    const userIndex = (TEAM_IDS as readonly string[]).indexOf(state.userTeam)
    const round2UserPick = room.order[TEAM_IDS.length + userIndex]!
    const row = screen.getByText(String(round2UserPick.pick)).closest('tr')!
    expect(row).toHaveAttribute('data-tone', 'yours')
  })

  it('switches rounds when another round button is clicked', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const withRoom = { ...state, draftRoom: room, phase: 'DRAFT' as const }
    renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))
    expect(screen.getByText('Pick board, round 1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Round 2' }))
    expect(screen.getByText('Pick board, round 2')).toBeInTheDocument()
  })

  it('returns to Prospects when the user comes on the clock while viewing the pick board', () => {
    const state = mockLeague()
    const data = mockStatic()
    const room = fixtureDraftRoom(state)
    const notOnClock = { ...room, currentPickIndex: 0 }
    const withRoom = { ...state, draftRoom: notOnClock, phase: 'DRAFT' as const }
    const { rerender } = renderDraftRoom(withRoom, data)

    fireEvent.click(screen.getByRole('tab', { name: 'Pick board' }))
    expect(screen.getByText('Pick board, round 1')).toBeInTheDocument()

    const userIndex = (TEAM_IDS as readonly string[]).indexOf(state.userTeam)
    const onClockRoom = { ...room, currentPickIndex: userIndex }
    const onClockState = { ...state, draftRoom: onClockRoom, phase: 'DRAFT' as const }
    rerender(
      <DraftRoom
        state={onClockState}
        data={data}
        onStartDraft={vi.fn()}
        onMakePick={vi.fn()}
        onAutoPick={vi.fn()}
        onSimToMyPick={vi.fn()}
        onSimNextPick={vi.fn()}
        onProposeTrade={vi.fn()}
        onOpenTradeCenter={vi.fn()}
        onFinishDraft={vi.fn()}
        onRespondToOffer={vi.fn()}
        onEvaluate={() => FIXTURE_EVALUATION}
        onFairness={() => 0.74}
        onTeamNeeds={() => null}
      />,
    )

    expect(screen.getByText('Available prospects')).toBeInTheDocument()
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
        onFairness={() => 0.74}
        onProposeTrade={vi.fn()}
        onRespondToOffer={vi.fn()}
        onRefreshOffers={vi.fn()}
        suggestedTrades={[]}
        onRefreshSuggestions={() => {}}
      />,
    )
    expect(screen.getByText('Your offer')).toBeInTheDocument()
    expect(screen.getByText('Their side')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Offer trade' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    // The incoming offer is AI-initiated: its meter reads fairness (74%), not onEvaluate's p (62%).
    expect(screen.getByText('74%')).toBeInTheDocument()
  })

  it("keeps the user's own proposal on onEvaluate's p, not fairness", () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <TradeCenter
        state={state}
        data={data}
        tradeOffers={[]}
        onEvaluate={() => FIXTURE_EVALUATION}
        onFairness={() => 0.74}
        onProposeTrade={vi.fn()}
        onRespondToOffer={vi.fn()}
        onRefreshOffers={vi.fn()}
        suggestedTrades={[]}
        onRefreshSuggestions={() => {}}
      />,
    )
    const yourOfferPanel = screen.getByText('Your offer').closest('section')!
    fireEvent.click(within(yourOfferPanel).getAllByRole('checkbox')[0]!)
    const theirSidePanel = screen.getByText('Their side').closest('section')!
    fireEvent.click(within(theirSidePanel).getAllByRole('checkbox')[0]!)

    // The live preview is the user's own proposal, so it shows onEvaluate's p (62%), never fairness.
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.queryByText('74%')).not.toBeInTheDocument()
  })
})

describe('FreeAgency', () => {
  it('renders the free agent pool and cap tiles', () => {
    const state = mockLeague()
    render(
      <FreeAgency
        state={state}
        cap={150}
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

  it('hints that signing closes the UDFA period before the pool is signed', () => {
    const base = mockLeague()
    const udfaIds = Object.keys(base.scouting).slice(0, 3)
    const withPool: LeagueState = {
      ...base,
      phase: 'UDFA',
      draftRoom: {
        season: base.season + 1,
        status: 'COMPLETE',
        currentPickIndex: 0,
        order: [],
        available: [],
        udfaPool: udfaIds,
        log: [],
        pendingOffers: [],
      },
    }
    render(
      <FreeAgency
        state={withPool}
        cap={150}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => null}
      />,
    )
    expect(screen.getByText(/Signing closes the UDFA period for every team/)).toBeInTheDocument()
    expect(screen.queryByText('No UDFA pool loaded.')).not.toBeInTheDocument()
  })

  it('shows a done message, not the empty-pool message, once signing clears draftRoom', () => {
    const base = mockLeague()
    const done: LeagueState = { ...base, phase: 'UDFA', draftRoom: null }
    render(
      <FreeAgency
        state={done}
        cap={150}
        onOfferContract={vi.fn()}
        onResign={vi.fn()}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={() => null}
      />,
    )
    expect(screen.getByText('UDFA signings are done for this year.')).toBeInTheDocument()
    expect(screen.queryByText('No UDFA pool loaded.')).not.toBeInTheDocument()
  })
})

describe('Schedule', () => {
  it('renders sim controls and the user schedule', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(
      <Schedule
        state={state}
        data={data}
        onSimWeek={vi.fn()}
        onSimToNextEvent={vi.fn()}
        onSimSeason={vi.fn()}
      />,
    )
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

describe('Finances', () => {
  it('renders the payroll table and cap tiles, and allows a release', () => {
    const state = mockLeague()
    const data = mockStatic()
    const onRelease = vi.fn()
    render(
      <Finances state={state} data={data} cap={200} capNextSeason={210} onRelease={onRelease} />,
    )
    expect(screen.getByText('Payroll')).toBeInTheDocument()
    expect(screen.getByText('Cap space next season')).toBeInTheDocument()
    const releaseButtons = screen.getAllByRole('button', { name: /Release/ })
    releaseButtons[0]!.click()
    expect(onRelease).toHaveBeenCalled()
  })
})

describe('SeasonRecap', () => {
  it('shows a placeholder before any season has finished', () => {
    const state = mockLeague()
    const data = mockStatic()
    render(<SeasonRecap state={state} data={data} />)
    expect(screen.getByText(/No season has finished yet/)).toBeInTheDocument()
  })

  it('renders the standings and the user season line for a completed season', () => {
    const state = mockLeague()
    const data = mockStatic()
    const withHistory: LeagueState = { ...state, history: [fixtureSeasonSummary(state)] }
    render(<SeasonRecap state={withHistory} data={data} />)
    expect(screen.getByText(/season recap/)).toBeInTheDocument()
    expect(screen.getByText('Final standings')).toBeInTheDocument()
  })
})

describe('EndGame', () => {
  it('celebrates a championship and still offers Keep playing', async () => {
    const state = mockLeague()
    const champion: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      history: [fixtureSeasonSummary(state)],
    }
    const data = mockStatic()
    const onKeepPlaying = vi.fn()
    render(<EndGame state={champion} data={data} cap={200} onKeepPlaying={onKeepPlaying} />)
    expect(screen.getByText(/champions/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep playing' }))
    expect(onKeepPlaying).toHaveBeenCalled()
  })

  it("has no Keep playing option when the caller doesn't offer one", () => {
    const state = mockLeague()
    const champion: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      history: [fixtureSeasonSummary(state)],
    }
    const data = mockStatic()
    render(<EndGame state={champion} data={data} cap={200} />)
    expect(screen.queryByRole('button', { name: 'Keep playing' })).not.toBeInTheDocument()
  })

  it('offers Keep playing when the horizon expires', async () => {
    const state = mockLeague()
    const expired: LeagueState = { ...state, outcome: 'HORIZON_EXPIRED' }
    const data = mockStatic()
    const onKeepPlaying = vi.fn()
    render(<EndGame state={expired} data={data} cap={200} onKeepPlaying={onKeepPlaying} />)
    expect(screen.getByText('Horizon reached')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep playing' }))
    expect(onKeepPlaying).toHaveBeenCalled()
  })
})
