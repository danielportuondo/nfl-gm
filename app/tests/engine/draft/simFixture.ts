/**
 * A sim-order (non-opening) in-history draft without simming a season: a game opened at the class's
 * own draft, with `startSeason` moved back a year so the draft is no longer the opening one, and a
 * one-season history whose standings are the real round-1 order, jittered per seed — a sim season
 * that went roughly, not exactly, like the real one.
 */
import {
  TEAM_IDS,
  type EngineContext,
  type LeagueState,
  type SeasonSummary,
  type TeamId,
} from '@contracts/index'
import { draft } from '@engine/draft'
import { rng } from '@engine/rng'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { makeFakeModules } from '../fakes'

export async function classContext(classSeason: number): Promise<EngineContext> {
  return loadRealContext(
    seasonsForNewGame(classSeason, readManifest().latestRealSeason),
    makeFakeModules({ draft }),
  )
}

function jitteredStandings(ctx: EngineContext, classSeason: number, seed: string): TeamId[] {
  const realRoundOne = ctx
    .seasonData(classSeason)!
    .draft.order.filter((e) => e.round === 1)
    .map((e) => e.originalTeam)
  const realIndex = (t: TeamId): number => {
    const i = realRoundOne.indexOf(t)
    return i < 0 ? TEAM_IDS.length : i
  }
  const noise = rng.fromSeed(seed, classSeason, 'standings')
  const keyed = [...TEAM_IDS].map((t) => ({ t, key: realIndex(t) + noise.normal(0, 5) }))
  return keyed.sort((a, b) => a.key - b.key || a.t.localeCompare(b.t)).map((k) => k.t)
}

export function simOrderDraft(
  ctx: EngineContext,
  classSeason: number,
  seed: string,
  userTeam: TeamId = 'IND',
): LeagueState {
  const opened = ctx.modules.league.newGame(
    {
      seed,
      startSeason: classSeason,
      userTeam,
      horizonSeasons: 1,
      settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
    },
    ctx,
  )
  const worstFirst = jitteredStandings(ctx, classSeason, seed)
  const standings = worstFirst.map((teamId, i) => ({
    teamId,
    wins: i,
    losses: 31 - i,
    ties: 0,
    pct: i / 31,
    pointsFor: 300,
    pointsAgainst: 300,
    divRank: 1 as const,
    confRank: 1 as const,
    clinched: null,
  }))
  const summary: SeasonSummary = {
    season: classSeason - 1,
    champion: worstFirst[31]!,
    runnerUp: worstFirst[30]!,
    standings,
    awards: [],
    userTeam,
    userRecord: { wins: 8, losses: 8, ties: 0, pointsFor: 300, pointsAgainst: 300 },
    userPlayoffExit: 'MISSED',
  }
  return { ...opened, startSeason: classSeason - 1, history: [summary] }
}

/** Real overall pick number by player, for every real pick of the class. */
export function realPickOf(ctx: EngineContext, classSeason: number): Map<string, number> {
  return new Map(
    ctx
      .seasonData(classSeason)!
      .draft.order.filter((e) => e.playerId)
      .map((e) => [e.playerId!, e.pick]),
  )
}
