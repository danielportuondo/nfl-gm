// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { Contract, DraftPick, LeagueState, Transaction, TradeSide } from '@contracts/index'
import { TEAM_IDS } from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { MovesHistory } from '@screens/SeasonRecap/MovesHistory'
import { SeasonRecap } from '@screens/SeasonRecap'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

const data = mockStatic()

function baseState(): LeagueState {
  return mockLeague({ season: 2015 })
}

/** `noUncheckedIndexedAccess` makes plain array destructuring nullable; assert non-null here once. */
function playerIds(state: LeagueState, n: number): string[] {
  const ids = Object.keys(state.players).slice(0, n)
  if (ids.length < n) throw new Error('mock fixture does not have enough players for this test')
  return ids as string[]
}

function nth(ids: string[], i: number): string {
  return ids[i]!
}

const otherTeam = TEAM_IDS.find((t) => t !== 'IND')!

interface TxOverrides {
  kind: Transaction['kind']
  season?: number
  phase?: Transaction['phase']
  week?: number
  ovrAtMove?: Record<string, number>
  playerId?: string
  round?: number
  pick?: number
  contract?: Contract
  deadMoney?: number
  gave?: TradeSide
  got?: TradeSide
}

/** Fills in the shared transaction fields so each test only states what it cares about. */
function tx(overrides: TxOverrides): Transaction {
  return {
    season: 2015,
    phase: 'REGULAR',
    week: 1,
    ovrAtMove: {},
    ...overrides,
  } as unknown as Transaction
}

describe('MovesHistory grouping and summary', () => {
  it('groups by season newest first and marks the current in-progress season', () => {
    const state = baseState()
    const ids = playerIds(state, 2)
    const a = nth(ids, 0)
    const b = nth(ids, 1)
    const withMoves: LeagueState = {
      ...state,
      season: 2015,
      outcome: 'IN_PROGRESS',
      transactions: [
        tx({ kind: 'UDFA', season: 2013, playerId: a }),
        tx({ kind: 'UDFA', season: 2015, playerId: b }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['2015 (in progress)', '2013'])
  })

  it('files offseason moves under the league year they lead into, as the header does', () => {
    const state = baseState()
    const ids = playerIds(state, 3)
    const inOffseason: LeagueState = {
      ...state,
      season: 2011,
      phase: 'DRAFT',
      outcome: 'IN_PROGRESS',
      transactions: [
        tx({ kind: 'UDFA', season: 2011, phase: 'PRESEASON', playerId: nth(ids, 0) }),
        tx({
          kind: 'RELEASE',
          season: 2011,
          phase: 'OFFSEASON_RESIGN',
          playerId: nth(ids, 1),
          deadMoney: 0,
        }),
        tx({
          kind: 'DRAFT',
          season: 2011,
          phase: 'DRAFT',
          playerId: nth(ids, 2),
          round: 1,
          pick: 1,
        }),
      ],
    }
    render(<MovesHistory state={inOffseason} data={data} />)
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['2012 (in progress)', '2011'])
  })

  it('shows a one-line count summary per year, omitting zero kinds', () => {
    const state = baseState()
    const ids = playerIds(state, 5)
    const a = nth(ids, 0)
    const b = nth(ids, 1)
    const c = nth(ids, 2)
    const d = nth(ids, 3)
    const e = nth(ids, 4)
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [
        tx({
          kind: 'TRADE',
          gave: { teamId: 'IND', players: [a], picks: [] },
          got: { teamId: otherTeam, players: [b], picks: [] },
        }),
        tx({
          kind: 'TRADE',
          gave: { teamId: 'IND', players: [c], picks: [] },
          got: { teamId: otherTeam, players: [d], picks: [] },
        }),
        tx({ kind: 'DRAFT', playerId: e, round: 1, pick: 12 }),
        tx({
          kind: 'SIGN',
          playerId: a,
          contract: { years: 2, apy: 7, guaranteedPct: 0.5, signedSeason: 2015, rookie: false },
        }),
        tx({ kind: 'RELEASE', playerId: b, deadMoney: 1.1 }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('2 trades · 1 pick · 1 signing · 1 release')).toBeInTheDocument()
  })

  it('shows a friendly line when the log is empty', () => {
    const state = baseState()
    render(<MovesHistory state={{ ...state, transactions: [] }} data={data} />)
    expect(
      screen.getByText('No moves yet. Trades, picks, signings and releases you make show up here.'),
    ).toBeInTheDocument()
  })
})

describe('MovesHistory entry detail lines', () => {
  it('renders a DRAFT line', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const id = nth(ids, 0)
    const player = state.players[id]!
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [tx({ kind: 'DRAFT', playerId: id, round: 1, pick: 24 })],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('R1 #24')).toBeInTheDocument()
    expect(screen.getByText(`· ${player.name} ${player.pos}`)).toBeInTheDocument()
    expect(screen.getByText('Draft', { selector: '.gg-badge' })).toBeInTheDocument()
  })

  it('renders a UDFA line with no round/pick', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const id = nth(ids, 0)
    const player = state.players[id]!
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [tx({ kind: 'UDFA', playerId: id })],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('UDFA')).toBeInTheDocument()
    expect(screen.getByText(`${player.name} ${player.pos}`)).toBeInTheDocument()
  })

  it('renders SIGN and RESIGN lines with years and money per year', () => {
    const state = baseState()
    const ids = playerIds(state, 2)
    const signId = nth(ids, 0)
    const resignId = nth(ids, 1)
    const signPlayer = state.players[signId]!
    const resignPlayer = state.players[resignId]!
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [
        tx({
          kind: 'SIGN',
          playerId: signId,
          contract: { years: 2, apy: 7, guaranteedPct: 0.5, signedSeason: 2015, rookie: false },
        }),
        tx({
          kind: 'RESIGN',
          playerId: resignId,
          contract: { years: 3, apy: 4, guaranteedPct: 0.5, signedSeason: 2015, rookie: false },
        }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('Signed')).toBeInTheDocument()
    expect(
      screen.getByText(`${signPlayer.name} ${signPlayer.pos} · 2y $7.0M/yr`),
    ).toBeInTheDocument()
    expect(screen.getByText('Re-signed')).toBeInTheDocument()
    expect(
      screen.getByText(`${resignPlayer.name} ${resignPlayer.pos} · 3y $4.0M/yr`),
    ).toBeInTheDocument()
  })

  it('renders a RELEASE line with dead money', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const id = nth(ids, 0)
    const player = state.players[id]!
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [tx({ kind: 'RELEASE', playerId: id, deadMoney: 1.1 })],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('Released')).toBeInTheDocument()
    expect(screen.getByText(`${player.name} ${player.pos} · dead $1.1M`)).toBeInTheDocument()
  })

  it('renders a TRADE line with the counterparty, gave and got', () => {
    const state = baseState()
    const ids = playerIds(state, 2)
    const mine = nth(ids, 0)
    const theirs = nth(ids, 1)
    const minePlayer = state.players[mine]!
    const theirsPlayer = state.players[theirs]!
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [
        tx({
          kind: 'TRADE',
          gave: { teamId: 'IND', players: [mine], picks: [] },
          got: { teamId: otherTeam, players: [theirs], picks: [] },
        }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('Trade')).toBeInTheDocument()
    expect(screen.getByText(`with ${data.teams[otherTeam]!.abbr}`)).toBeInTheDocument()
    expect(screen.getByText('Gave:')).toBeInTheDocument()
    expect(screen.getByText('Got:')).toBeInTheDocument()
    expect(screen.getByText(`${minePlayer.name} ${minePlayer.pos}`)).toBeInTheDocument()
    expect(screen.getByText(`${theirsPlayer.name} ${theirsPlayer.pos}`)).toBeInTheDocument()
  })

  it('shows the player a traded-for pick has since become', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const becamePlayer = nth(ids, 0)
    const becamePlayerInfo = state.players[becamePlayer]!
    const usedPick: DraftPick = {
      season: 2016,
      round: 1,
      pick: 24,
      originalTeam: otherTeam,
      owner: 'IND',
      playerId: becamePlayer,
    }
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      picks: [...state.picks, usedPick],
      transactions: [
        tx({
          kind: 'TRADE',
          gave: { teamId: 'IND', players: [], picks: [] },
          got: {
            teamId: otherTeam,
            players: [],
            picks: [{ season: 2016, round: 1, originalTeam: otherTeam, pick: 24 }],
          },
        }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(
      screen.getByText(
        `2016 R1 #24 (${data.teams[otherTeam]!.abbr}) → ${becamePlayerInfo.name} ${becamePlayerInfo.pos}`,
      ),
    ).toBeInTheDocument()
  })
})

describe('MovesHistory then -> now ratings', () => {
  it('shows the now-only case when ovrAtMove is empty', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const id = nth(ids, 0)
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      scouting: { ...state.scouting, [id]: { ovr: 74, pot: 80, confidence: 0.6 } },
      transactions: [tx({ kind: 'DRAFT', playerId: id, round: 1, pick: 1, ovrAtMove: {} })],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('74')).toBeInTheDocument()
    expect(screen.queryByText('→')).not.toBeInTheDocument()
  })

  it('colors an improved rating positive and a declined rating danger', () => {
    const state = baseState()
    const ids = playerIds(state, 2)
    const upId = nth(ids, 0)
    const downId = nth(ids, 1)
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      scouting: {
        ...state.scouting,
        [upId]: { ovr: 70, pot: 80, confidence: 0.6 },
        [downId]: { ovr: 50, pot: 60, confidence: 0.6 },
      },
      transactions: [
        tx({ kind: 'UDFA', playerId: upId, ovrAtMove: { [upId]: 64 } }),
        tx({ kind: 'UDFA', playerId: downId, ovrAtMove: { [downId]: 56 } }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    expect(screen.getByText('70')).toHaveStyle({ color: 'var(--positive)' })
    expect(screen.getByText('50')).toHaveStyle({ color: 'var(--danger)' })
  })
})

describe('MovesHistory filters', () => {
  it('hides other kinds and empty years when a filter is applied', () => {
    const state = baseState()
    const ids = playerIds(state, 3)
    const a = nth(ids, 0)
    const b = nth(ids, 1)
    const c = nth(ids, 2)
    const withMoves: LeagueState = {
      ...state,
      outcome: 'CHAMPION',
      transactions: [
        tx({ kind: 'DRAFT', season: 2014, playerId: a, round: 1, pick: 3 }),
        tx({
          kind: 'TRADE',
          season: 2015,
          gave: { teamId: 'IND', players: [b], picks: [] },
          got: { teamId: otherTeam, players: [c], picks: [] },
        }),
      ],
    }
    render(<MovesHistory state={withMoves} data={data} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trades' }))
    expect(screen.queryByText(/2014/)).not.toBeInTheDocument()
    expect(screen.getByText('2015')).toBeInTheDocument()
    expect(screen.getByText('Trade')).toBeInTheDocument()
    expect(screen.queryByText('Draft', { selector: '.gg-badge' })).not.toBeInTheDocument()
  })
})

describe('SeasonRecap "Your moves" tab', () => {
  it('offers both tabs even when no season has finished, and switches to moves', () => {
    const state = baseState()
    const ids = playerIds(state, 1)
    const id = nth(ids, 0)
    const withMoves: LeagueState = {
      ...state,
      history: [],
      transactions: [tx({ kind: 'UDFA', playerId: id })],
    }
    render(<SeasonRecap state={withMoves} data={data} />)
    expect(screen.getByRole('tab', { name: 'Season' })).toBeInTheDocument()
    const movesTab = screen.getByRole('tab', { name: 'Your moves' })
    expect(screen.getByText(/No season has finished yet/)).toBeInTheDocument()

    fireEvent.click(movesTab)
    expect(screen.queryByText(/No season has finished yet/)).not.toBeInTheDocument()
    expect(screen.getByText('UDFA')).toBeInTheDocument()
  })
})
