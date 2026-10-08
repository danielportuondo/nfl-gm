import { beforeAll, describe, expect, it } from 'vitest'
import { mockLeague } from '@fixtures/mockLeague'
import { league as leagueModule } from '@engine/league'
import { reconcileDepthChart } from '@engine/league/depthChart'
import { availableByPosition } from '@engine/sim/strength'
import { depthChartNotices } from '@store/depthChartNotice'
import type {
  EngineContext,
  Injury,
  LeagueState,
  PlayerId,
  Position,
  RosterSlot,
} from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { emptyLog, userCutdowns, userDraft, userFreeAgency } from '../../../scripts/lib/scriptedGm'

const SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const
const MAHOMES = '00-0033873'

/**
 * KC at the 2017 draft; the user takes the best prospect on the board with the real #10 pick (Mahomes).
 * The store never rebuilds the user's depth chart, so the chart is held at what the user last saw
 * (the one built at newGame) while the offseason runs: drafts, free agency and cutdowns change the roster
 * under it.
 */
function playUserOffseasonToOpeningDay(ctx: EngineContext): {
  opened: LeagueState
  chartBefore: LeagueState['teams'][string]['depthChart']
} {
  const { league, draft } = ctx.modules
  const log = emptyLog()
  let s = league.newGame(
    {
      seed: 'depth-chart',
      startSeason: 2017,
      userTeam: 'KC',
      horizonSeasons: 3,
      settings: SETTINGS,
    },
    ctx,
  )
  const chartBefore = s.teams.KC!.depthChart
  s = draft.startDraft(s, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx)
  s = league.advancePhase(s, ctx)
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx)
  s = league.advancePhase(s, ctx)
  s = userCutdowns(s, ctx, log)
  const kc = s.teams.KC!
  s = { ...s, teams: { ...s.teams, KC: { ...kc, depthChart: chartBefore } } }
  return { opened: league.advancePhase(s, ctx), chartBefore }
}

describe('user depth chart at opening day', () => {
  let opened: LeagueState
  let chartBefore: Record<string, PlayerId[]>
  beforeAll(async () => {
    const manifest = readManifest()
    const ctx = await loadRealContext(seasonsForNewGame(2017, manifest.latestRealSeason))
    ;({ opened, chartBefore } = playUserOffseasonToOpeningDay(ctx))
  }, 120_000)

  it("lists every rostered player at his position, including this year's draft picks", () => {
    const kc = opened.teams.KC!
    expect(opened.phase).toBe('REGULAR')
    expect(kc.roster.some((r) => r.playerId === MAHOMES)).toBe(true)
    expect(kc.depthChart.QB).toContain(MAHOMES)
    for (const slot of kc.roster) {
      const pos = opened.players[slot.playerId]!.pos as Position
      expect(kc.depthChart[pos], `${slot.playerId} (${pos})`).toContain(slot.playerId)
    }
  })

  it('lists nobody who is no longer on the roster', () => {
    const kc = opened.teams.KC!
    const rostered = new Set(kc.roster.map((r) => r.playerId))
    const stale = Object.values(kc.depthChart)
      .flat()
      .filter((id) => !rostered.has(id))
    expect(stale).toEqual([])
  })

  it('keeps the order the user had for the players who are still there', () => {
    const kc = opened.teams.KC!
    const rostered = new Set(kc.roster.map((r) => r.playerId))
    for (const [pos, before] of Object.entries(chartBefore)) {
      const kept = before.filter((id) => rostered.has(id))
      const after = (kc.depthChart[pos as Position] ?? []).filter((id) => kept.includes(id))
      expect(after, pos).toEqual(kept)
    }
  })
})

/** The user's three WRs at 80 / 59 / 58 in that order: the shape of the QA 2017 safety room. */
function threeDeep(): { state: LeagueState; chart: [PlayerId, PlayerId, PlayerId] } {
  const base = mockLeague()
  const team = base.teams[base.userTeam]!
  const wrs = team.roster.map((r) => r.playerId).filter((id) => base.players[id]!.pos === 'WR')
  expect(wrs.length).toBeGreaterThanOrEqual(3)
  const chart = wrs.slice(0, 3) as [PlayerId, PlayerId, PlayerId]
  const scouting = { ...base.scouting }
  chart.forEach((id, i) => {
    scouting[id] = { ...scouting[id]!, ovr: [80, 59, 58][i]! }
  })
  const kept = new Set(chart)
  const roster = team.roster.filter(
    (r) => base.players[r.playerId]!.pos !== 'WR' || kept.has(r.playerId),
  )
  const depthChart = { ...team.depthChart, WR: chart }
  const state = {
    ...base,
    scouting,
    teams: { ...base.teams, [base.userTeam]: { ...team, roster, depthChart } },
  }
  return { state, chart }
}

function withChart(state: LeagueState, pos: Position, order: PlayerId[]): LeagueState {
  const team = state.teams[state.userTeam]!
  const depthChart = { ...team.depthChart, [pos]: order }
  return { ...state, teams: { ...state.teams, [state.userTeam]: { ...team, depthChart } } }
}

function withInjury(state: LeagueState, id: PlayerId, injured: Injury | undefined): LeagueState {
  const team = state.teams[state.userTeam]!
  const roster = team.roster.map((slot): RosterSlot => {
    if (slot.playerId !== id) return slot
    const next: RosterSlot = { ...slot }
    if (injured) next.injured = injured
    else delete next.injured
    return next
  })
  return { ...state, teams: { ...state.teams, [state.userTeam]: { ...team, roster } } }
}

/** Adds a WR the user just signed (roster slot copied from an existing WR) with the given consensus. */
function withSigned(state: LeagueState, id: PlayerId, ovr: number): LeagueState {
  const team = state.teams[state.userTeam]!
  const model = team.roster.find((r) => state.players[r.playerId]!.pos === 'WR')!
  return {
    ...state,
    players: { ...state.players, [id]: { ...state.players[model.playerId]!, id, name: id } },
    scouting: { ...state.scouting, [id]: { ovr, pot: ovr, confidence: 0.8 } },
    teams: {
      ...state.teams,
      [state.userTeam]: { ...team, roster: [...team.roster, { ...model, playerId: id }] },
    },
  }
}

const OUT_FOUR: Injury = { weeksOut: 4, kind: 'knee', season: 2015, week: 3 }

describe('an injured starter on the user chart', () => {
  it('keeps his slot, the sim plays the next healthy man, and he is back when he heals', () => {
    const { state, chart } = threeDeep()
    const [starter, second] = chart
    const hurt = withInjury(state, starter, OUT_FOUR)

    expect(reconcileDepthChart(hurt, hurt.userTeam)).toBe(hurt)
    expect(hurt.teams[hurt.userTeam]!.depthChart.WR).toEqual(chart)
    expect(availableByPosition(hurt, hurt.userTeam).WR.slice(0, 2)).toEqual([second, chart[2]])

    const healed = withInjury(hurt, starter, undefined)
    expect(availableByPosition(healed, healed.userTeam).WR[0]).toBe(starter)
  })

  it('Reset orders by consensus and leaves him at his slot', () => {
    const { state, chart } = threeDeep()
    const hurt = withInjury(state, chart[0], OUT_FOUR)
    const scrambled = withChart(hurt, 'WR', [chart[2], chart[1], chart[0]])

    const reset = leagueModule.autoDepthChart(scrambled, scrambled.userTeam, {
      ignoreInjuries: true,
    })
    expect(reset.WR).toEqual(chart)
    expect(leagueModule.autoDepthChart(scrambled, scrambled.userTeam).WR![2]).toBe(chart[0])
  })
})

describe('reconcileDepthChart', () => {
  it('slots a signed 77 between the 80 and the 59/58, not behind them', () => {
    const { state, chart } = threeDeep()
    const next = reconcileDepthChart(withSigned(state, 'adams', 77), state.userTeam)
    expect(next.teams[state.userTeam]!.depthChart.WR).toEqual([
      chart[0],
      'adams',
      chart[1],
      chart[2],
    ])
  })

  it('never re-sorts the players already there, and drops the departed', () => {
    const { state, chart } = threeDeep()
    const edited = withChart(state, 'WR', [chart[1], 'gone-player', chart[0], chart[2]])
    const next = reconcileDepthChart(withSigned(edited, 'low', 40), state.userTeam)
    expect(next.teams[state.userTeam]!.depthChart.WR).toEqual([chart[1], chart[0], chart[2], 'low'])
  })

  it('the notice names the slot the newcomer earned', () => {
    const { state, chart } = threeDeep()
    const signed = withSigned(state, 'adams', 77)
    const next = reconcileDepthChart(signed, state.userTeam)
    expect(chart).toHaveLength(3)
    expect(depthChartNotices(state, next)).toEqual(['adams placed at WR2'])
  })
})
