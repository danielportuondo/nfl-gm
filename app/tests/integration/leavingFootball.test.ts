/**
 * QA 2018 M3: the camp roll retires every player whose last real game is behind him, silently, and the
 * user had re-signed some of them a week earlier. Now the re-sign list says "leaving football", the AI
 * does not re-sign them, and the roll files the user's departures in the move history.
 * Real 2017 data, NYJ: Forte, Avril, Carroll, Hawley, Ijalana and Petty all have retiresAfter 2017.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Contract, EngineContext, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { leagueYear } from '../../src/screens/shared/phaseLabel'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../scripts/lib/publicData'

const START = 2017
const USER: TeamId = 'NYJ'
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

const expiring = (state: LeagueState, ids: readonly PlayerId[], teamId: TeamId): LeagueState => {
  const team = state.teams[teamId]!
  const roster = team.roster.map((slot) =>
    ids.includes(slot.playerId)
      ? { ...slot, contract: { ...slot.contract, years: 1, signedSeason: START - 1 } }
      : slot,
  )
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster } } }
}

const deal = (apy: number): Contract => ({
  years: 2,
  apy,
  guaranteedPct: 0.5,
  signedSeason: START,
  rookie: false,
})

describe('players with no real future season (2017 NYJ)', () => {
  let ctx: EngineContext
  let base: LeagueState
  let leavers: PlayerId[]
  let stayer: PlayerId

  beforeAll(async () => {
    ctx = await loadRealContext(seasonsForNewGame(START, readManifest().latestRealSeason))
    base = ctx.modules.league.newGame(
      {
        seed: 'leaving',
        startSeason: START,
        userTeam: USER,
        horizonSeasons: 3,
        settings: SETTINGS,
        startAt: 'PRESEASON',
      },
      ctx,
    )
    const roster = base.teams[USER]!.roster.map((r) => r.playerId)
    leavers = roster.filter(
      (id) => base.players[id]!.real && base.truth[id]?.retiresAfter === START,
    )
    stayer = roster.find(
      (id) => base.truth[id]?.retiresAfter == null && base.scouting[id]!.ovr > 65,
    )!
    expect(leavers.length).toBeGreaterThanOrEqual(2)
  }, 120000)

  it('blocks re-signing a player whose last game was this season', () => {
    const s = expiring({ ...base, phase: 'OFFSEASON_RESIGN', week: 0 }, [...leavers, stayer], USER)
    const { fa, lifecycle } = ctx.modules
    const target = leavers[0]!
    expect(lifecycle.leavesAfterSeason(s, target)).toBe(true)
    expect(lifecycle.leavesAfterSeason(s, stayer)).toBe(false)
    expect(() => fa.resign(s, target, deal(fa.resignAsk(s, target, ctx)), ctx)).toThrow(
      /leaving football/,
    )
    expect(() => fa.resign(s, stayer, deal(fa.resignAsk(s, stayer, ctx)), ctx)).not.toThrow()
  })

  it('has the AI let a flagged player walk even when the data keeps him on his team', () => {
    const aiTeam = Object.keys(base.teams)
      .sort()
      .find((id) => id !== USER)!
    const target = base.teams[aiTeam]!.roster.find((r) => base.players[r.playerId]!.real)!.playerId
    const s = expiring({ ...base, phase: 'OFFSEASON_RESIGN', week: 0 }, [target], aiTeam)
    const flagged: EngineContext = {
      ...ctx,
      modules: {
        ...ctx.modules,
        lifecycle: { ...ctx.modules.lifecycle, leavesAfterSeason: (_s, id) => id === target },
      },
    }
    const next = flagged.modules.fa.runAiResign(s, flagged, flagged.modules.rng.fromSeed('x', 1))
    const slot = next.teams[aiTeam]!.roster.find((r) => r.playerId === target)
    expect(slot).toBeUndefined()
    expect(next.freeAgents).toContain(target)
  })

  it('files the user departures at the roll', () => {
    const team = base.teams[USER]!
    const roster = team.roster.map((slot) =>
      leavers.includes(slot.playerId)
        ? { ...slot, contract: { ...slot.contract, years: 3, signedSeason: START - 1 } }
        : slot,
    )
    const atCamp: LeagueState = {
      ...base,
      teams: { ...base.teams, [USER]: { ...team, roster } },
      phase: 'TRAINING_CAMP',
      week: 0,
    }
    const rolled = ctx.modules.league.advancePhase(atCamp, ctx)
    expect(rolled.season).toBe(START + 1)
    const filed = rolled.transactions.filter((t) => t.kind === 'LEFT_LEAGUE')
    expect(filed.map((t) => t.playerId).sort()).toEqual([...leavers].sort())
    for (const t of filed) {
      expect(leagueYear(t.season, t.phase)).toBe(START + 1)
      expect(rolled.teams[USER]!.roster.some((r) => r.playerId === t.playerId)).toBe(false)
    }
  })
})
