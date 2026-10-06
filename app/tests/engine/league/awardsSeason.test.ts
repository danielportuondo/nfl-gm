/**
 * Season awards against realistic box scores: a frozen 2017 season from a real playthrough (the
 * sim's rushing was inflated: 21 RBs over 1,000 yards, an RB won MVP and OPOY) and real-engine
 * seasons. Assertions are properties and distributions, not names.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Award, EngineContext, LeagueState, PlayerGameLine } from '@contracts/index'
import { seasonAwards } from '@engine/league/awards'
import { mockBundle } from '@fixtures/mockLeague'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { makeFakeContext } from '../fakes'
import fixture from './fixtures/awards2017.json'

interface FixturePlayer extends Omit<PlayerGameLine, 'playerId'> {
  id: string
  name: string
  pos: LeagueState['players'][string]['pos']
  rookie: boolean
}

function fixtureState(userTeam: string): LeagueState {
  const { season } = fixture
  const players: LeagueState['players'] = {}
  const lines: PlayerGameLine[] = []
  for (const p of fixture.players as FixturePlayer[]) {
    const { id, name, pos, rookie, ...stats } = p
    players[id] = {
      id,
      name,
      pos,
      birthYear: 1995,
      draft: null,
      real: true,
      rookieSeason: rookie ? season : season - 3,
    }
    lines.push({ playerId: id, ...stats })
  }
  const teams: LeagueState['teams'] = {}
  for (const [id, record] of Object.entries(fixture.teams)) {
    teams[id] = {
      id,
      roster: [],
      depthChart: {},
      record,
      deadMoney: 0,
      tradeAnnoyance: 0,
      userControlled: id === userTeam,
    }
  }
  return {
    schemaVersion: 1,
    seed: 'awards-2017',
    season,
    week: 21,
    phase: 'OFFSEASON_RESIGN',
    userTeam,
    horizonEnd: season + 5,
    startSeason: 2017,
    settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
    teams,
    players,
    scouting: {},
    truth: {},
    picks: [],
    schedule: [{ id: 'fx-1', season, week: 1, type: 'REG', home: 'JAX', away: 'MIA' }],
    results: [
      {
        gameId: 'fx-1',
        homeScore: 0,
        awayScore: 0,
        overtime: false,
        box: { home: lines, away: [] },
        injuries: [],
      },
    ],
    history: [],
    divergence: new Set(),
    freeAgents: [],
    draftRoom: null,
    snapLog: [],
    transactions: [],
    outcome: 'IN_PROGRESS',
    savedAt: new Date(0).toISOString(),
  }
}

const byId = (awards: Award[], id: string) => awards.find((a) => a.id === id)

describe('seasonAwards on a 2017 season with inflated RB production', () => {
  const state = fixtureState('MIA')
  const awards = seasonAwards(state, makeFakeContext(mockBundle({ season: 2017 })))

  it('MVP is a quarterback even though RBs out-score QBs on raw fantasy points', () => {
    expect(byId(awards, 'MVP')?.pos).toBe('QB')
  })

  it('OPOY is a different player than the MVP', () => {
    expect(byId(awards, 'OPOY')?.playerId).not.toBe(byId(awards, 'MVP')?.playerId)
  })

  it('yardage in an award note says what the yards are (no bare "yds" that mixes rush and receiving)', () => {
    const offense = awards.filter((a) => ['MVP', 'OPOY', 'OROY'].includes(a.id ?? ''))
    expect(offense.length).toBe(3)
    for (const a of offense) expect(a.note, `${a.id} ${a.playerName}`).not.toMatch(/\d yds/)
  })

  it('a note that shows a rushing figure matches the rushing leader line for the same player', () => {
    const leader = awards.find((a) => a.name === 'Rushing leader')!
    const leaderYards = leader.note!.split(' ')[0]!
    const winner = awards
      .filter((a) => a.id && a.playerId === leader.playerId && a.note?.includes('rush'))
      .map((a) => a.note!)
    expect(winner.length).toBeGreaterThan(0)
    for (const note of winner) expect(note).toContain(`${leaderYards} rush`)
  })

  it('does not favour or penalise the user: awards are identical whoever the user manages', () => {
    const ctx = makeFakeContext(mockBundle({ season: 2017 }))
    const asMia = seasonAwards(fixtureState('MIA'), ctx)
    expect(seasonAwards(fixtureState('JAX'), ctx)).toEqual(asMia)
    expect(seasonAwards(fixtureState('IND'), ctx)).toEqual(asMia)
  })

  it('DPOY and DROY are not decided by interceptions alone', () => {
    const dpoy = byId(awards, 'DPOY')!
    const droy = byId(awards, 'DROY')!
    const interceptionLeaders = (rookiesOnly: boolean) => {
      const pool = (fixture.players as FixturePlayer[]).filter(
        (p) => ['DL', 'LB', 'CB', 'S'].includes(p.pos) && (!rookiesOnly || p.rookie),
      )
      const most = Math.max(...pool.map((p) => p.ints ?? 0))
      return pool.filter((p) => (p.ints ?? 0) === most).map((p) => p.id)
    }
    expect(interceptionLeaders(false)).not.toContain(dpoy.playerId)
    expect(interceptionLeaders(true)).not.toContain(droy.playerId)
  })
})

describe('seasonAwards over real-engine seasons', () => {
  const STARTS = [2012, 2015, 2017]
  const SEEDS_PER_START = 6
  const seasons: { state: LeagueState; awards: Award[] }[] = []

  function playSeason(start: number, seed: string, ctx: EngineContext): LeagueState {
    const { league } = ctx.modules
    let s = league.newGame(
      {
        seed,
        startSeason: start,
        userTeam: 'IND',
        horizonSeasons: 1,
        settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
        startAt: 'PRESEASON',
      },
      ctx,
    )
    s = league.advancePhase(s, ctx)
    let guard = 0
    while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') {
      s = league.simWeek(s, ctx).state
      if (++guard > 30) throw new Error('season did not finish')
    }
    return s
  }

  beforeAll(async () => {
    const latest = readManifest().latestRealSeason
    for (const start of STARTS) {
      const ctx = await loadRealContext(seasonsForNewGame(start, latest))
      for (let i = 0; i < SEEDS_PER_START; i++) {
        const state = playSeason(start, `awards-dist-${start}-${i}`, ctx)
        seasons.push({ state, awards: seasonAwards(state, ctx) })
      }
    }
  }, 240_000)

  const share = (pick: (s: (typeof seasons)[number]) => boolean) =>
    seasons.filter(pick).length / seasons.length
  const winnerPos = (awards: Award[], id: string) => byId(awards, id)?.pos ?? ''

  it('MVP is a quarterback in at least 70% of seasons', () => {
    expect(share((s) => winnerPos(s.awards, 'MVP') === 'QB')).toBeGreaterThanOrEqual(0.7)
  })

  it('MVP comes from a winning team', () => {
    for (const { state, awards } of seasons) {
      const record = state.teams[byId(awards, 'MVP')!.teamId!]!.record
      expect(record.wins, `${state.season} MVP team`).toBeGreaterThanOrEqual(10)
    }
  })

  it('OPOY is not an RB by default and goes to more than one position', () => {
    expect(share((s) => winnerPos(s.awards, 'OPOY') === 'RB')).toBeLessThanOrEqual(0.7)
    expect(new Set(seasons.map((s) => winnerPos(s.awards, 'OPOY'))).size).toBeGreaterThan(1)
  })

  it('DPOY goes to a pass rusher or linebacker most of the time, not the interception leader', () => {
    expect(share((s) => ['DL', 'LB'].includes(winnerPos(s.awards, 'DPOY')))).toBeGreaterThanOrEqual(
      0.6,
    )
  })

  it('DROY is spread over the defense, not always a defensive back', () => {
    expect(share((s) => ['CB', 'S'].includes(winnerPos(s.awards, 'DROY')))).toBeLessThanOrEqual(0.6)
  })

  it('every season has the six major awards and honest yardage labels', () => {
    for (const { awards } of seasons) {
      for (const id of ['MVP', 'OPOY', 'DPOY', 'COY']) expect(byId(awards, id), id).toBeDefined()
      for (const id of ['MVP', 'OPOY', 'OROY']) {
        const note = byId(awards, id)?.note
        if (note) expect(note).not.toMatch(/\d yds/)
      }
    }
  })
})
