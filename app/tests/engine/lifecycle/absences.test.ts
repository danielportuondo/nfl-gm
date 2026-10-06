/**
 * QA M6: a player whose real season availability was very low (Luck 2017, Bridgewater 2017) must not
 * play the whole simulated season at his consensus rating. Lifecycle announces the absence as a normal
 * injury at the start of the season, so depth charts and the sim pass over him the usual way.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  STARTER_TEMPLATE,
  TEAM_IDS,
  type EngineContext,
  type GameResult,
  type LeagueState,
  type PlayerGameLine,
  type Season,
} from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { applyHistoricalAbsences } from '@engine/lifecycle/absences'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const LUCK = '00-0029668'
const BRIDGEWATER = '00-0031237'
const KEENUM = '00-0028986'
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

interface PlayedSeason {
  opening: LeagueState
  final: LeagueState
  regular: GameResult[]
}

function playRegularSeason(ctx: EngineContext, season: Season, seed: string): PlayedSeason {
  const { league } = ctx.modules
  const start = league.newGame(
    {
      seed,
      startSeason: season,
      userTeam: 'IND',
      horizonSeasons: 1,
      settings: SETTINGS,
      startAt: 'PRESEASON',
    },
    ctx,
  )
  const opening = league.advancePhase(start, ctx)
  let s = opening
  let guard = 0
  while (s.phase === 'REGULAR') {
    s = league.simWeek(s, ctx).state
    if (++guard > 30) throw new Error('season did not finish')
  }
  return { opening, final: s, regular: s.results.filter((r) => r.box).slice(0, 256) }
}

const linesOf = (r: GameResult): PlayerGameLine[] => [...r.box!.home, ...r.box!.away]

function gamesWithLine(season: PlayedSeason, playerId: string): number {
  return season.regular.filter((r) => linesOf(r).some((l) => l.playerId === playerId)).length
}

/** The QB who threw the most passes for `teamId` in each of its games, in schedule order. */
function qbStarters(played: PlayedSeason, teamId: string): string[] {
  const out: string[] = []
  for (const result of played.regular) {
    const game = played.final.schedule.find((g) => g.id === result.gameId)!
    if (game.home !== teamId && game.away !== teamId) continue
    const lines = (game.home === teamId ? result.box!.home : result.box!.away).filter(
      (l) => (l.passAtt ?? 0) > 0,
    )
    lines.sort((a, b) => (b.passAtt ?? 0) - (a.passAtt ?? 0))
    if (lines[0]) out.push(lines[0].playerId)
  }
  return out
}

describe('applyHistoricalAbsences', () => {
  const withAvail = (state: LeagueState, avail: Record<string, number>): LeagueState => ({
    ...state,
    truth: {
      ...state.truth,
      ...Object.fromEntries(
        Object.entries(avail).map(([id, a]) => [
          id,
          { ...state.truth[id]!, availBySeason: { [String(state.season)]: a } },
        ]),
      ),
    },
  })

  it('marks only absent starters, lets the next man up through, and is idempotent', () => {
    const base = mockLeague({ season: 2017 })
    const qbs = base.teams
      .IND!.roster.map((r) => r.playerId)
      .filter((id) => base.players[id]!.pos === 'QB')
      .sort((a, b) => base.scouting[b]!.ovr - base.scouting[a]!.ovr)
    expect(qbs.length).toBeGreaterThanOrEqual(3)
    const [star, steady, benchGhost] = qbs as [string, string, string]
    const state = withAvail(base, { [star]: 0, [steady]: 1, [benchGhost]: 0 })

    const once = applyHistoricalAbsences(state)
    const injuredOf = (s: LeagueState, id: string) =>
      s.teams.IND!.roster.find((r) => r.playerId === id)?.injured
    expect(injuredOf(once, star)?.weeksOut).toBe(17)
    expect(injuredOf(once, steady)).toBeUndefined()
    expect(injuredOf(once, benchGhost)).toBeUndefined()
    expect(applyHistoricalAbsences(once)).toEqual(once)
    expect(injuredOf(state, star)).toBeUndefined()
  })

  it('spares the most available player when every starter at a position missed time', () => {
    const base = mockLeague({ season: 2017 })
    const qbs = base.teams
      .IND!.roster.map((r) => r.playerId)
      .filter((id) => base.players[id]!.pos === 'QB')
    const [a, b, c] = qbs as [string, string, string]
    const state = withAvail(base, { [a]: 0.1, [b]: 0.4, [c]: 0.2 })
    const out = applyHistoricalAbsences(state)
    const injured = qbs.filter(
      (id) => out.teams.IND!.roster.find((r) => r.playerId === id)?.injured,
    )
    expect(injured).not.toContain(b)
    expect(injured).toContain(a)
  })

  it('leaves a season with no real availability (procedural) alone', () => {
    const state = mockLeague({ season: 2017 })
    expect(applyHistoricalAbsences(state)).toBe(state)
  })
})

describe('real-life absences (QA M6)', () => {
  const played = new Map<Season, PlayedSeason>()

  beforeAll(async () => {
    const latest = readManifest().latestRealSeason
    for (const season of [2015, 2016, 2017, 2018]) {
      const ctx = await loadRealContext(seasonsForNewGame(season, latest))
      played.set(season, playRegularSeason(ctx, season, 'm6'))
    }
  }, 120_000)

  it('announces Luck and Bridgewater as out before game 1 of 2017', () => {
    const { opening } = played.get(2017)!
    const injuredOf = (teamId: string, id: string) =>
      opening.teams[teamId]!.roster.find((r) => r.playerId === id)?.injured
    expect(injuredOf('IND', LUCK)?.weeksOut).toBeGreaterThanOrEqual(16)
    expect(injuredOf('MIN', BRIDGEWATER)?.weeksOut).toBeGreaterThanOrEqual(14)
  })

  it('IND does not open 2017 with Luck, and he plays at most a game or two', () => {
    const season = played.get(2017)!
    const starters = qbStarters(season, 'IND')
    expect(starters[0]).not.toBe(LUCK)
    expect(gamesWithLine(season, LUCK)).toBeLessThanOrEqual(2)
  })

  it('MIN starts Keenum, not the still-recovering Bridgewater, for most of 2017', () => {
    const season = played.get(2017)!
    const starters = qbStarters(season, 'MIN')
    expect(starters.filter((id) => id === KEENUM).length).toBeGreaterThanOrEqual(12)
    expect(starters.filter((id) => id === BRIDGEWATER).length).toBeLessThanOrEqual(2)
  })

  it('starters whose real availability was under 0.1 play at most two games, 2015-2018', () => {
    const offenders: string[] = []
    let candidates = 0
    for (const [seasonYear, season] of played) {
      const { opening } = season
      for (const teamId of TEAM_IDS) {
        const byPos = new Map<string, string[]>()
        for (const slot of opening.teams[teamId]!.roster) {
          const pos = opening.players[slot.playerId]!.pos
          byPos.set(pos, [...(byPos.get(pos) ?? []), slot.playerId])
        }
        for (const [pos, ids] of byPos) {
          const slots = STARTER_TEMPLATE[pos] ?? 0
          const availOf = (id: string) => opening.truth[id]?.availBySeason?.[String(seasonYear)]
          // A group with fewer than `slots` fit players keeps its best of the absent (a team needs a kicker).
          if (ids.filter((id) => (availOf(id) ?? 1) >= 0.5).length < slots) continue
          const starters = ids
            .sort((a, b) => opening.scouting[b]!.ovr - opening.scouting[a]!.ovr || (a < b ? -1 : 1))
            .slice(0, slots)
          for (const id of starters) {
            const avail = availOf(id)
            if (avail === undefined || avail >= 0.1) continue
            candidates++
            const games = gamesWithLine(season, id)
            if (games > 2)
              offenders.push(`${seasonYear} ${teamId} ${id} avail=${avail} games=${games}`)
          }
        }
      }
    }
    expect(candidates).toBeGreaterThan(20)
    expect(offenders).toEqual([])
  })
})
