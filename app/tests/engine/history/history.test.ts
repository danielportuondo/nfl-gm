/**
 * engine/history acceptance tests (HANDOFF §6.8, fa-cap brief). The anchoring test loads real 2015-2017
 * data, builds a 2015 league with no user actions, jumps straight to season 2016 (skipping the
 * offseason phases league.advancePhase would normally run — this module's contract is that
 * snapToHistory alone re-anchors every non-diverged player), and checks ≥90% of non-diverged players who
 * are on a real 2016 roster land on that real team.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { type EngineContext, type LeagueState } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { fa } from '@engine/fa'
import { history } from '@engine/history'
import { makeFakeContext, makeFakeModules } from '../fakes'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const SEASON = 2015
const SETTINGS = { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true } as const

function newGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame({ seed, startSeason: SEASON, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS }, ctx)
}

describe('history.snapToHistory (real 2015 -> 2016)', () => {
  let ctx: EngineContext

  beforeAll(async () => {
    const manifest = readManifest()
    const seasons = seasonsForNewGame(SEASON, manifest.latestRealSeason)
    ctx = await loadRealContext(seasons, makeFakeModules({ fa, history }))
  }, 30000)

  it('anchors >=90% of non-diverged players onto their real 2016 team, deterministically', () => {
    const state2015 = newGame(ctx, 'anchor-2015')
    const intoNewSeason: LeagueState = { ...state2015, season: SEASON + 1 }
    const snapped = history.snapToHistory(intoNewSeason, ctx)

    expect(snapped.snapLog.length).toBeGreaterThan(0)
    expect(snapped.snapLog.every((e) => e.season === SEASON + 1)).toBe(true)

    const sd = ctx.seasonData(SEASON + 1)!
    const currentTeamOf = new Map<string, string>()
    for (const [teamId, team] of Object.entries(snapped.teams)) {
      for (const slot of team.roster) currentTeamOf.set(slot.playerId, teamId)
    }

    let eligible = 0
    let matched = 0
    for (const sp of sd.players.players) {
      if (!sp.team) continue
      if (snapped.divergence.has(sp.id)) continue
      eligible++
      if (currentTeamOf.get(sp.id) === sp.team) matched++
    }
    const pct = matched / eligible
    expect(eligible).toBeGreaterThan(1000)
    expect(pct).toBeGreaterThanOrEqual(0.9)

    // Determinism: same seed -> identical snap log and rosters.
    const again = history.snapToHistory({ ...newGame(ctx, 'anchor-2015'), season: SEASON + 1 }, ctx)
    expect(again.snapLog).toEqual(snapped.snapLog)
    expect(again.teams).toEqual(snapped.teams)
  }, 20000)

  it('leaves diverged players and the user team untouched', () => {
    const state2015 = newGame(ctx, 'anchor-diverge')
    const userPlayerId = state2015.teams.IND!.roster[0]!.playerId
    const otherTeamId = Object.keys(state2015.teams).find((id) => id !== 'IND')!
    const divergedId = state2015.teams[otherTeamId]!.roster[0]!.playerId

    const diverged = history.markDiverged(state2015, [divergedId])
    const intoNewSeason: LeagueState = { ...diverged, season: SEASON + 1 }
    const snapped = history.snapToHistory(intoNewSeason, ctx)

    expect(snapped.teams.IND!.roster.some((r) => r.playerId === userPlayerId)).toBe(true)
    expect(snapped.teams[otherTeamId]!.roster.some((r) => r.playerId === divergedId)).toBe(true)
    const event = snapped.snapLog.find((e) => e.playerId === divergedId)
    expect(event?.reason).toBe('DIVERGED_KEPT')
  })
})

describe('history.markDiverged / isDiverged / snapLog', () => {
  it('is idempotent and filters snapLog by season', () => {
    const ctx = makeFakeContext(mockBundle({ season: 2015 }))
    const state = ctx.modules.league.newGame(
      { seed: 'div-1', startSeason: 2015, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS },
      ctx,
    )
    const playerId = state.teams.DAL!.roster[0]!.playerId

    expect(history.isDiverged(state, playerId)).toBe(false)
    const once = history.markDiverged(state, [playerId])
    const twice = history.markDiverged(once, [playerId])
    expect(history.isDiverged(once, playerId)).toBe(true)
    expect(twice.divergence).toEqual(once.divergence)

    const withLog: LeagueState = {
      ...once,
      snapLog: [
        { season: 2015, playerId, fromTeam: 'DAL', toTeam: 'DAL', reason: 'DIVERGED_KEPT' },
        { season: 2016, playerId: 'other', fromTeam: null, toTeam: 'NE', reason: 'HISTORY' },
      ],
    }
    expect(history.snapLog(withLog, 2015)).toHaveLength(1)
    expect(history.snapLog(withLog, 2016)).toHaveLength(1)
    expect(history.snapLog(withLog)).toHaveLength(2)
  })
})
