// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  TEAM_IDS,
  type LeagueState,
  type TradeEvaluation,
  type TradeProposal,
} from '@contracts/index'
import { mockLeague, mockStatic } from '@fixtures/mockLeague'
import { TradeCenter } from '@screens/TradeCenter'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

const VALID: TradeEvaluation = {
  valueIn: 10,
  valueOut: 8,
  needAdj: 0,
  margin: 1,
  p: 0.62,
  valid: true,
  reasons: [],
}

/** Mirrors the engine's asset-ownership gate: a player must be on the side's team. */
function ownershipEvaluator(state: LeagueState) {
  return (proposal: TradeProposal): TradeEvaluation => {
    const reasons: string[] = []
    for (const side of [proposal.offer, proposal.request]) {
      const roster = new Set(state.teams[side.teamId]?.roster.map((s) => s.playerId))
      for (const id of side.players) {
        if (!roster.has(id))
          reasons.push(`${state.players[id]?.name ?? id} is not on ${side.teamId}`)
      }
    }
    return reasons.length > 0 ? { ...VALID, p: 0, valid: false, reasons } : VALID
  }
}

function renderTradeCenter(state: LeagueState, onEvaluate: (p: TradeProposal) => TradeEvaluation) {
  const onProposeTrade = vi.fn()
  render(
    <TradeCenter
      state={state}
      data={mockStatic()}
      tradeOffers={[]}
      suggestedTrades={[]}
      onEvaluate={onEvaluate}
      onFairness={() => 0.5}
      onProposeTrade={onProposeTrade}
      onRespondToOffer={vi.fn()}
      onRefreshOffers={vi.fn()}
      onRefreshSuggestions={vi.fn()}
    />,
  )
  const mine = within(screen.getByText('Your offer').closest('section')!)
  const theirs = within(screen.getByText('Their side').closest('section')!)
  return { mine, theirs, onProposeTrade }
}

describe('TradeCenter opponent switch', () => {
  it('clears their-side selections and disables Offer trade for the now-empty deal', () => {
    const state = mockLeague()
    const { theirs, onProposeTrade } = renderTradeCenter(state, ownershipEvaluator(state))
    const offer = screen.getByRole('button', { name: 'Offer trade' })

    fireEvent.click(theirs.getAllByRole('checkbox')[0]!)
    expect(offer).toBeEnabled()

    const other = TEAM_IDS.filter((id) => id !== state.userTeam)[1]!
    fireEvent.change(theirs.getByRole('combobox', { name: 'Team' }), { target: { value: other } })

    for (const box of theirs.getAllByRole('checkbox')) expect(box).not.toBeChecked()
    expect(offer).toBeDisabled()
    fireEvent.click(offer)
    expect(onProposeTrade).not.toHaveBeenCalled()
  })

  it('keeps your own selections when the opponent changes', () => {
    const state = mockLeague()
    const { mine, theirs } = renderTradeCenter(state, ownershipEvaluator(state))
    const myBox = mine.getAllByRole('checkbox')[0]!
    fireEvent.click(myBox)
    fireEvent.click(theirs.getAllByRole('checkbox')[0]!)

    const other = TEAM_IDS.filter((id) => id !== state.userTeam)[1]!
    fireEvent.change(theirs.getByRole('combobox', { name: 'Team' }), { target: { value: other } })

    expect(myBox).toBeChecked()
    for (const box of theirs.getAllByRole('checkbox')) expect(box).not.toBeChecked()
  })
})

describe('TradeCenter invalid deals', () => {
  it('keeps Offer trade disabled and explains why when the evaluation is invalid', () => {
    const state = mockLeague()
    const invalid: TradeEvaluation = {
      ...VALID,
      p: 0,
      valid: false,
      reasons: ['Over the salary cap by $4.2M'],
    }
    const { mine, theirs, onProposeTrade } = renderTradeCenter(state, () => invalid)
    fireEvent.click(mine.getAllByRole('checkbox')[0]!)
    fireEvent.click(theirs.getAllByRole('checkbox')[0]!)

    const offer = screen.getByRole('button', { name: 'Offer trade' })
    expect(offer).toBeDisabled()
    expect(screen.getByText('Over the salary cap by $4.2M')).toBeInTheDocument()
    fireEvent.click(offer)
    expect(onProposeTrade).not.toHaveBeenCalled()
  })

  it('says the deal cannot go through even when the engine gives no reason', () => {
    const state = mockLeague()
    const { mine } = renderTradeCenter(state, () => ({ ...VALID, valid: false, reasons: [] }))
    fireEvent.click(mine.getAllByRole('checkbox')[0]!)

    expect(screen.getByRole('button', { name: 'Offer trade' })).toBeDisabled()
    expect(screen.getByText('This deal cannot go through as it stands.')).toBeInTheDocument()
  })
})

describe('TradeCenter pick labels', () => {
  it('tells apart same-round picks from different original teams', () => {
    const base = mockLeague()
    const data = mockStatic()
    const [first, second, third] = TEAM_IDS.filter((id) => id !== base.userTeam)
    const season = base.season + 3
    const owned = [second!, third!].map((originalTeam) => ({
      season,
      round: 3,
      pick: null,
      originalTeam,
      owner: first!,
      playerId: null,
    }))
    const state: LeagueState = { ...base, picks: [...base.picks, ...owned] }
    const { theirs } = renderTradeCenter(state, () => VALID)

    const labels = owned.map((p) => `${season} R3 (${data.teams[p.originalTeam]!.abbr})`)
    expect(labels[0]).not.toBe(labels[1])
    for (const label of labels) {
      expect(theirs.getByRole('checkbox', { name: label })).toBeInTheDocument()
    }
  })
})

describe('TradeCenter price hint (QA 2017 M1)', () => {
  it('says roughly what they want instead of only "Unlikely"', () => {
    const state = mockLeague()
    const unlikely: TradeEvaluation = { ...VALID, p: 0.08, priceHint: { shortBy: 18, round: 2 } }
    const { mine, theirs } = renderTradeCenter(state, () => unlikely)
    fireEvent.click(theirs.getAllByRole('checkbox')[0]!)
    expect(screen.getByText("They'd want about a 2nd.")).toBeInTheDocument()

    fireEvent.click(mine.getAllByRole('checkbox')[0]!)
    expect(screen.getByText("They'd want about a 2nd more.")).toBeInTheDocument()
  })
})
