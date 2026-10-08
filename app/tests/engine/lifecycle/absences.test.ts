/**
 * Real absences, announced and applied by real week (QA 2017 H1/M6, 2018 M5). The season chunk holds
 * the weeks every player really missed; lifecycle publishes them as `state.absences`, and each week's
 * tick marks whoever is rostered and covered as injured for exactly the weeks left, starter or bench,
 * signed in the offseason, in season, or acquired by trade.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  ROSTER_TEMPLATE_53,
  STARTER_TEMPLATE,
  TEAM_IDS,
  type EngineContext,
  type GameResult,
  type LeagueState,
  type PlayerId,
  type Position,
  type RosterSlot,
  type Season,
  type TeamId,
} from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { absenceAt, announceAbsences, applyWeekAbsences } from '@engine/lifecycle/absences'
import { lifecycle } from '@engine/lifecycle'
import { rng } from '@engine/rng'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'

const MERCILUS = '00-0029643' // 2017: hurt in week 5, out weeks 6-17 (real)
const SEANTREL_HENDERSON = '00-0031029' // 2017: suspended weeks 1-5
const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

describe('applyWeekAbsences (unit)', () => {
  function withBoard(state: LeagueState, playerId: PlayerId, from: number, to: number) {
    return {
      ...state,
      phase: 'REGULAR' as const,
      week: 4,
      absences: {
        season: state.season,
        byPlayer: { [playerId]: [{ from, to, reason: 'injury' as const }] },
      },
    }
  }
  const slotOf = (s: LeagueState, id: PlayerId): RosterSlot =>
    s.teams.IND!.roster.find((r) => r.playerId === id)!

  it('marks a bench player for the weeks left in his range and is idempotent', () => {
    const base = mockLeague({ season: 2017 })
    const bench = base.teams.IND!.roster.map((r) => r.playerId).at(-1)!
    const state = withBoard(base, bench, 2, 9)
    const once = applyWeekAbsences(state)
    expect(slotOf(once, bench).injured).toMatchObject({ weeksOut: 6, kind: 'Injury', week: 4 })
    expect(applyWeekAbsences(once)).toEqual(once)
  })

  it('does not touch a range that has not started, has ended, or the wrong season', () => {
    const base = mockLeague({ season: 2017 })
    const id = base.teams.IND!.roster[0]!.playerId
    expect(applyWeekAbsences(withBoard(base, id, 6, 9))).toEqual(withBoard(base, id, 6, 9))
    expect(applyWeekAbsences(withBoard(base, id, 1, 3))).toEqual(withBoard(base, id, 1, 3))
    const stale = { ...withBoard(base, id, 1, 9), absences: { season: 2016, byPlayer: {} } }
    expect(applyWeekAbsences(stale)).toBe(stale)
  })

  it('never shortens a longer injury he already has', () => {
    const base = mockLeague({ season: 2017 })
    const id = base.teams.IND!.roster[0]!.playerId
    const state = withBoard(base, id, 1, 5)
    const hurt: LeagueState = {
      ...state,
      teams: {
        ...state.teams,
        IND: {
          ...state.teams.IND!,
          roster: state.teams.IND!.roster.map((r) =>
            r.playerId === id
              ? { ...r, injured: { weeksOut: 9, kind: 'Knee', season: 2017, week: 3 } }
              : r,
          ),
        },
      },
    }
    expect(slotOf(applyWeekAbsences(hurt), id).injured?.weeksOut).toBe(9)
  })

  it('a real absence healing rolls no permanent loss, a sim injury of the same length does', () => {
    const base = mockLeague({ season: 2017 })
    const [real, sim] = base.teams.IND!.roster.map((r) => r.playerId) as [string, string]
    const hurt = (kind: string): RosterSlot['injured'] => ({
      weeksOut: 1,
      kind,
      season: 2017,
      week: 1,
    })
    const state: LeagueState = {
      ...base,
      phase: 'REGULAR',
      week: 12,
      teams: {
        ...base.teams,
        IND: {
          ...base.teams.IND!,
          roster: base.teams.IND!.roster.map((r) =>
            r.playerId === real
              ? { ...r, injured: hurt('Injury') }
              : r.playerId === sim
                ? { ...r, injured: hurt('Knee') }
                : r,
          ),
        },
      },
    }
    const ctx = {
      data: { injuryModel: { permanentLoss: { minWeeks: 8, p: 1, lossRange: [3, 3] } } },
    } as unknown as EngineContext
    const ticked = lifecycle.tickInjuries(state, ctx, rng.fromSeed('tick', 1))
    expect(ticked.truth[real]!.bySeason['2017']).toBe(base.truth[real]!.bySeason['2017'])
    expect(ticked.truth[sim]!.bySeason['2017']).toBeLessThan(base.truth[sim]!.bySeason['2017']!)
  })

  it('announces nothing for a procedural season and keeps the board it already has', () => {
    const state = mockLeague({ season: 2030 })
    const ctx = { data: { manifest: { latestRealSeason: 2025 } } } as unknown as EngineContext
    const announced = announceAbsences(state, ctx)
    expect(announced.absences).toEqual({ season: 2030, byPlayer: {} })
    expect(announceAbsences(announced, ctx)).toBe(announced)
  })
})

interface Played {
  state: LeagueState
  /** Before each week's games: the user's slot for the tracked player. */
  slotByWeek: Map<number, RosterSlot | undefined>
  results: GameResult[]
}

/** The same absentee, put on a roster as a trade or a signing would: replaces the worst player at his position. */
function addToRoster(state: LeagueState, teamId: TeamId, id: PlayerId): LeagueState {
  const team = state.teams[teamId]!
  const pos = state.players[id]!.pos
  const victim = team.roster
    .filter((r) => state.players[r.playerId]!.pos === pos)
    .sort((a, b) => state.scouting[a.playerId]!.ovr - state.scouting[b.playerId]!.ovr)[0]!
  const roster = [
    ...team.roster.filter((r) => r !== victim),
    { playerId: id, teamId, contract: { ...victim.contract } },
  ]
  return {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, roster } },
    freeAgents: [...state.freeAgents.filter((f) => f !== id), victim.playerId].sort(),
  }
}

const linesOf = (r: GameResult) => [...(r.box?.home ?? []), ...(r.box?.away ?? [])]

function weeksPlayed(state: LeagueState, playerId: PlayerId): number[] {
  const weekOf = new Map(state.schedule.map((g) => [g.id, g.week]))
  return state.results
    .filter((r) => linesOf(r).some((l) => l.playerId === playerId))
    .map((r) => weekOf.get(r.gameId)!)
    .sort((a, b) => a - b)
}

function openSeason(
  ctx: EngineContext,
  season: Season,
  userTeam: TeamId,
  seed: string,
): LeagueState {
  return ctx.modules.league.newGame(
    {
      seed,
      startSeason: season,
      userTeam,
      horizonSeasons: 1,
      settings: SETTINGS,
      startAt: 'PRESEASON',
    },
    ctx,
  )
}

function startRegular(ctx: EngineContext, state: LeagueState): LeagueState {
  return ctx.modules.league.advancePhase(state, ctx)
}

describe('real absences by real week', () => {
  const ctxBySeason = new Map<Season, EngineContext>()

  beforeAll(async () => {
    const latest = readManifest().latestRealSeason
    for (const season of [2017, 2018])
      ctxBySeason.set(season, await loadRealContext(seasonsForNewGame(season, latest)))
  }, 120_000)

  /** Plays the regular season, recording the tracked player's slot at the top of each week. */
  function playSeason(ctx: EngineContext, from: LeagueState, trackId: PlayerId): Played {
    const slotByWeek = new Map<number, RosterSlot | undefined>()
    let s = from
    let guard = 0
    while (s.phase === 'REGULAR') {
      slotByWeek.set(
        s.week,
        Object.values(s.teams)
          .flatMap((t) => t.roster)
          .find((r) => r.playerId === trackId),
      )
      s = ctx.modules.league.simWeek(s, ctx).state
      if (++guard > 30) throw new Error('season did not finish')
    }
    return { state: s, slotByWeek, results: s.results }
  }

  it('Mercilus is out exactly his real weeks (6 to the end of 2017) on the user team', () => {
    const ctx = ctxBySeason.get(2017)!
    const opened = openSeason(ctx, 2017, 'HOU', 'abs-mercilus')
    expect(opened.absences?.byPlayer[MERCILUS]).toEqual([{ from: 6, to: 22, reason: 'injury' }])
    const regular = startRegular(ctx, addToRoster(opened, 'HOU', MERCILUS))
    const played = playSeason(ctx, regular, MERCILUS)

    for (let week = 1; week <= 5; week++)
      expect(played.slotByWeek.get(week)?.injured?.kind).not.toBe('Injury')
    for (let week = 6; week <= 17; week++)
      expect(played.slotByWeek.get(week)?.injured).toMatchObject({
        kind: 'Injury',
        weeksOut: 22 - week + 1,
      })
    expect(weeksPlayed(played.state, MERCILUS).filter((w) => w >= 6)).toEqual([])
  }, 120_000)

  it('signing a real absentee in season: he misses the rest of his real weeks, from the signing on', () => {
    const ctx = ctxBySeason.get(2017)!
    let s = startRegular(ctx, openSeason(ctx, 2017, 'HOU', 'abs-signing'))
    for (let i = 0; i < 7; i++) s = ctx.modules.league.simWeek(s, ctx).state
    expect(s.week).toBe(8)
    const user = s.teams.HOU!
    const contract = { ...user.roster[0]!.contract, years: 1, rookie: false }
    // Free up a roster spot first, like a user would.
    const cut = user.roster.find(
      (r) => s.players[r.playerId]!.pos === 'DL' && r.playerId !== MERCILUS,
    )!
    s = ctx.modules.fa.release(s, 'HOU', cut.playerId, ctx)
    let signed: LeagueState | undefined
    for (let i = 0; i < 40 && !signed; i++) {
      const rng = ctx.modules.rng.fromSeed('abs-offer', i)
      const result = ctx.modules.fa.offer(s, 'HOU', MERCILUS, contract, ctx, rng)
      if (result.accepted) signed = result.state
    }
    expect(signed).toBeDefined()
    const slot = signed!.teams.HOU!.roster.find((r) => r.playerId === MERCILUS)!
    expect(slot.injured).toMatchObject({ kind: 'Injury', weeksOut: 22 - 8 + 1 })
    let after = signed!
    while (after.phase === 'REGULAR') after = ctx.modules.league.simWeek(after, ctx).state
    expect(weeksPlayed(after, MERCILUS)).toEqual([])
  }, 120_000)

  it('a bench player on an AI team is covered, and misses exactly his announced weeks', () => {
    const ctx = ctxBySeason.get(2018)!
    const opened = openSeason(ctx, 2018, 'IND', 'abs-bench')
    const isBench = (teamId: TeamId, id: PlayerId): boolean => {
      const pos = opened.players[id]!.pos
      const better = opened.teams[teamId]!.roster.filter(
        (r) =>
          opened.players[r.playerId]!.pos === pos &&
          opened.scouting[r.playerId]!.ovr > opened.scouting[id]!.ovr,
      ).length
      return better >= (STARTER_TEMPLATE[pos] ?? 1)
    }
    const candidates = TEAM_IDS.filter((t) => t !== 'IND').flatMap((teamId) =>
      opened.teams[teamId]!.roster.filter((r) => {
        const range = opened.absences?.byPlayer[r.playerId]?.[0]
        return range && range.from >= 2 && range.to <= 17 && isBench(teamId, r.playerId)
      }).map((r) => ({ teamId, id: r.playerId })),
    )
    const pick = candidates.sort(
      (a, b) => opened.scouting[b.id]!.ovr - opened.scouting[a.id]!.ovr || (a.id < b.id ? -1 : 1),
    )[0]!
    const range = opened.absences!.byPlayer[pick.id]![0]!
    const played = playSeason(ctx, startRegular(ctx, opened), pick.id)
    const inRange = weeksPlayed(played.state, pick.id).filter(
      (w) => w >= range.from && w <= range.to,
    )
    expect(inRange).toEqual([])
    const atStart = played.slotByWeek.get(range.from)
    if (atStart) expect(atStart.injured?.weeksOut).toBeGreaterThanOrEqual(range.to - range.from + 1)
  }, 120_000)

  it('out of football shows as such and cannot play', () => {
    const ctx = ctxBySeason.get(2017)!
    const opened = openSeason(ctx, 2017, 'IND', 'abs-out')
    const wholeYear = opened.freeAgents
      .filter((id) => {
        const ranges = opened.absences?.byPlayer[id]
        return (
          ranges?.length === 1 &&
          ranges[0]!.from === 1 &&
          ranges[0]!.reason === 'out' &&
          ranges[0]!.to >= 17
        )
      })
      .sort((a, b) => opened.scouting[b]!.ovr - opened.scouting[a]!.ovr || (a < b ? -1 : 1))[0]!
    const regular = startRegular(ctx, addToRoster(opened, 'IND', wholeYear))
    const week1 = applyWeekAbsences(regular)
    expect(week1.teams.IND!.roster.find((r) => r.playerId === wholeYear)!.injured).toMatchObject({
      kind: 'Out of football',
    })
    const played = playSeason(ctx, regular, wholeYear)
    expect(weeksPlayed(played.state, wholeYear)).toEqual([])
  }, 120_000)

  it('a suspension shows as a suspension for exactly its weeks', () => {
    const ctx = ctxBySeason.get(2017)!
    const opened = openSeason(ctx, 2017, 'IND', 'abs-sus')
    expect(opened.absences?.byPlayer[SEANTREL_HENDERSON]).toEqual([
      { from: 1, to: 5, reason: 'suspension' },
    ])
    const regular = startRegular(ctx, addToRoster(opened, 'IND', SEANTREL_HENDERSON))
    const played = playSeason(ctx, regular, SEANTREL_HENDERSON)
    expect(played.slotByWeek.get(1)?.injured).toMatchObject({ kind: 'Suspension', weeksOut: 5 })
    expect(weeksPlayed(played.state, SEANTREL_HENDERSON).filter((w) => w <= 5)).toEqual([])
  }, 120_000)

  it('no AI team fields an empty position in any week of 2017 while a healthy free agent exists', () => {
    const ctx = ctxBySeason.get(2017)!
    const holes: string[] = []
    let s = startRegular(ctx, openSeason(ctx, 2017, 'IND', 'abs-holes'))
    let guard = 0
    while (s.phase === 'REGULAR') {
      // What the week tick does before the games: apply the week, then let the AI backfill.
      const ready = ctx.modules.fa.runAiCutdowns(applyWeekAbsences(s), ctx)
      const healthyFreeAgent = (pos: Position) =>
        ready.freeAgents.some(
          (id) => ready.players[id]!.pos === pos && !absenceAt(ready, id, ready.season, ready.week),
        )
      for (const teamId of TEAM_IDS) {
        if (teamId === ready.userTeam) continue
        const healthy = new Map<Position, number>()
        for (const slot of ready.teams[teamId]!.roster) {
          if (slot.injured) continue
          const pos = ready.players[slot.playerId]!.pos
          healthy.set(pos, (healthy.get(pos) ?? 0) + 1)
        }
        for (const pos of Object.keys(ROSTER_TEMPLATE_53) as Position[])
          if (!healthy.get(pos) && healthyFreeAgent(pos)) holes.push(`wk${s.week} ${teamId} ${pos}`)
      }
      s = ctx.modules.league.simWeek(s, ctx).state
      if (++guard > 30) throw new Error('season did not finish')
    }
    expect(holes).toEqual([])
  }, 180_000)
})
