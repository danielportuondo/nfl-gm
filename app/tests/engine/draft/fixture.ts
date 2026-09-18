/**
 * Shared setup for the draft tests: the shipped 2013 data through the real draft module, with fakes
 * for fa/trade/history/lifecycle so only engine/draft is under test.
 *
 * Draft-year convention: a game started in 2013 drafts the 2014 class in its DRAFT phase.
 */
import type { EngineContext, EngineModules, GameSettings, LeagueState, TeamId } from '@contracts/index'
import { draft } from '@engine/draft'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { makeFakeModules } from '../fakes'

export const START_SEASON = 2013
export const CLASS_SEASON = 2014

/** Real 2014 outcomes used by the tests. */
export const CLOWNEY = '00-0031364' // DL, Houston, pick 1
export const AARON_DONALD = '00-0031388' // DL, St. Louis, pick 13

const SETTINGS: GameSettings = { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true }

export async function draftContext(overrides: Partial<EngineModules> = {}): Promise<EngineContext> {
  const manifest = readManifest()
  return loadRealContext(
    seasonsForNewGame(START_SEASON, manifest.latestRealSeason),
    makeFakeModules({ draft, ...overrides }),
  )
}

/** A new game parked at the DRAFT phase (league.advancePhase only sets the phase; the caller starts the draft). */
export function stateAtDraft(ctx: EngineContext, userTeam: TeamId, seed = 'draft-test'): LeagueState {
  const state = ctx.modules.league.newGame(
    { seed, startSeason: START_SEASON, userTeam, horizonSeasons: 1, settings: SETTINGS },
    ctx,
  )
  return { ...state, phase: 'DRAFT' }
}

export const historicalShare = (state: LeagueState): number => {
  const log = state.draftRoom?.log ?? []
  return log.length === 0 ? 0 : log.filter((e) => e.historical).length / log.length
}
