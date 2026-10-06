/**
 * Shared setup for the draft tests: the shipped 2013 data through the real draft module, with fakes
 * for fa/trade/history/lifecycle so only engine/draft is under test.
 *
 * The 2014 redraft is the opening draft of a game started at 2014 (default `startAt: 'DRAFT'`): only
 * the opening draft keeps the real order, so that is the one that can be measured against reality.
 */
import type {
  EngineContext,
  EngineModules,
  GameSettings,
  LeagueState,
  TeamId,
} from '@contracts/index'
import { draft } from '@engine/draft'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { makeFakeModules } from '../fakes'

export const START_SEASON = 2014
export const CLASS_SEASON = START_SEASON

/** Real 2014 outcomes used by the tests. */
export const CLOWNEY = '00-0031364' // DL, Houston, pick 1
export const AARON_DONALD = '00-0031388' // DL, St. Louis, pick 13

const SETTINGS: GameSettings = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
}

export async function draftContext(overrides: Partial<EngineModules> = {}): Promise<EngineContext> {
  const manifest = readManifest()
  return loadRealContext(
    seasonsForNewGame(START_SEASON, manifest.latestRealSeason),
    makeFakeModules({ draft, ...overrides }),
  )
}

/** A new game at its opening DRAFT phase (season 2013, drafting the 2014 class); the caller starts the draft. */
export function stateAtDraft(
  ctx: EngineContext,
  userTeam: TeamId,
  seed = 'draft-test',
): LeagueState {
  return ctx.modules.league.newGame(
    {
      seed,
      startSeason: START_SEASON,
      userTeam,
      horizonSeasons: 1,
      settings: SETTINGS,
    },
    ctx,
  )
}

export const historicalShare = (state: LeagueState): number => {
  const log = state.draftRoom?.log ?? []
  return log.length === 0 ? 0 : log.filter((e) => e.historical).length / log.length
}
