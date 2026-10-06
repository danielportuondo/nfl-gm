// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { Contract, LeagueState, PlayerId } from '@contracts/index'
import { createGameStore } from '@store/index'
import { mockLeague } from '@fixtures/mockLeague'
import { FreeAgency } from '@screens/FreeAgency'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const holder = vi.hoisted(() => ({ store: null as unknown as { getState: () => unknown } }))
vi.mock('@store/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@store/index')>()
  return { ...original, useGameStore: () => holder.store.getState() }
})

afterEach(cleanup)

type Store = ReturnType<typeof createGameStore>

async function startStore(): Promise<Store> {
  const base = mockLeague()
  const store = createGameStore({ mode: 'mock' })
  await store.getState().actions.newGame({
    startSeason: base.season,
    userTeam: base.userTeam,
    horizonSeasons: 3,
    settings: base.settings,
  })
  return store
}

const userRoster = (s: LeagueState) => s.teams[s.userTeam]!.roster

/** Rewrites the user's contracts: `shape` sees each slot's index and returns its new contract fields. */
function withUserContracts(
  store: Store,
  patch: Partial<LeagueState>,
  shape: (index: number, c: Contract) => Partial<Contract>,
  deadMoney = 0,
) {
  store.setState((s) => {
    const league = s.state!
    const team = league.teams[league.userTeam]!
    const roster = team.roster.map((slot, i) => ({
      ...slot,
      contract: { ...slot.contract, ...shape(i, slot.contract) },
    }))
    return {
      state: {
        ...league,
        ...patch,
        teams: { ...league.teams, [league.userTeam]: { ...team, roster, deadMoney } },
      },
    }
  })
}

const sumApy = (s: LeagueState) => userRoster(s).reduce((t, slot) => t + slot.contract.apy, 0)

describe('signing feedback', () => {
  it('typing the displayed ask re-signs, even when the real ask rounds the other way', async () => {
    const store = await startStore()
    const { actions } = store.getState()
    const league = store.getState().state!
    const capNext = actions.capFor(league.season + 1)!

    // Make the first player whose real ask prints lower than it is the only expiring contract.
    withUserContracts(store, { phase: 'OFFSEASON_RESIGN' }, () => ({ apy: 0.6 }))
    const phased = store.getState().state!
    const target = userRoster(phased).find((slot) => {
      const ask = actions.resignAsk(slot.playerId)!
      return Number(ask.toFixed(1)) < ask - 1e-9
    })!.playerId
    const realAsk = actions.resignAsk(target)!
    withUserContracts(store, {}, (i, c) => ({
      apy: c.apy,
      years: userRoster(phased)[i]!.playerId === target ? 1 : 3,
      signedSeason: userRoster(phased)[i]!.playerId === target ? league.season - 1 : league.season,
    }))
    expect(sumApy(store.getState().state!)).toBeLessThan(capNext)

    render(
      <FreeAgency
        state={store.getState().state!}
        cap={capNext}
        onOfferContract={vi.fn()}
        onResign={actions.resign}
        onRelease={vi.fn()}
        onSignUdfa={vi.fn()}
        onResignAsk={actions.resignAsk}
      />,
    )
    const printed = screen.getByText(/^Asking \$/).textContent!.match(/\$(\d+\.\d)M/)![1]!
    expect(Number(printed)).toBeGreaterThanOrEqual(realAsk)

    const input = screen.getByLabelText(/APY/)
    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, printed)
    await user.click(screen.getByRole('button', { name: 'Re-sign' }))

    await waitFor(() => expect(store.getState().toasts.at(-1)?.text).toBe('Re-signed'))
    const slot = userRoster(store.getState().state!).find((r) => r.playerId === target)!
    expect(slot.contract.apy).toBe(Number(printed))
  })

  it('a cap-blocked offer says why, not that the player passed', async () => {
    const store = await startStore()
    const { actions } = store.getState()
    const league = store.getState().state!
    const capNext = actions.capFor(league.season + 1)!
    // $2M of room next season, all of it committed to deals that run past the rollover.
    const scale = (capNext - 2) / sumApy(league)
    withUserContracts(store, { phase: 'FREE_AGENCY' }, (_i, c) => ({
      apy: c.apy * scale,
      years: 3,
      signedSeason: league.season,
    }))
    const target: PlayerId = store.getState().state!.freeAgents[0]!

    await actions.offerContract(target, {
      years: 2,
      apy: 10,
      guaranteedPct: 0.3,
      signedSeason: league.season,
      rookie: false,
    })

    const last = store.getState().toasts.at(-1)!
    expect(last.text).toBe('Not enough cap room next season: need $10.0M, have $2.0M')
    expect(last.text).not.toMatch(/passed/)
  })

  it('a re-sign error toasts without the engine prefix', async () => {
    const store = await startStore()
    const { actions } = store.getState()
    const league = store.getState().state!
    withUserContracts(store, { phase: 'OFFSEASON_RESIGN' }, () => ({
      years: 1,
      signedSeason: league.season - 1,
    }))
    const target = userRoster(store.getState().state!)[0]!.playerId

    await actions.resign(target, {
      years: 2,
      apy: 0.05,
      guaranteedPct: 0.5,
      signedSeason: league.season,
      rookie: false,
    })

    const last = store.getState().toasts.at(-1)!
    expect(last.text).toMatch(/^Could not re-sign\. That offer is below the ask of \$\d+\.\dM$/)
    expect(last.text).not.toMatch(/fa\.resign/)
  })

  it('the header puts the minus sign before the dollar sign', async () => {
    const store = await startStore()
    const league = store.getState().state!
    const cap = store.getState().actions.capThisSeason()!
    // Salaries exactly at the cap, plus $37.1M of dead money.
    const scale = cap / sumApy(league)
    withUserContracts(
      store,
      { phase: 'REGULAR', week: 1 },
      (_i, c) => ({ apy: c.apy * scale }),
      37.1,
    )
    holder.store = store
    const { App } = await import('../../src/App')
    render(<App />)
    expect(screen.getByText('-$37.1M free')).toBeInTheDocument()
  })
})
