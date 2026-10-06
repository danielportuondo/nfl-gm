import { beforeAll, describe, expect, it } from 'vitest'
import { mockLeague } from '@fixtures/mockLeague'
import { reconcileDepthChart } from '@engine/league/depthChart'
import type { EngineContext, LeagueState, PlayerId, Position } from '@contracts/index'
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

describe('reconcileDepthChart', () => {
  it('drops departed players, appends new ones by ovr, and never reorders the rest', () => {
    const base = mockLeague()
    const team = base.teams[base.userTeam]!
    const qbs = team.roster.map((r) => r.playerId).filter((id) => base.players[id]!.pos === 'QB')
    expect(qbs.length).toBeGreaterThanOrEqual(2)
    const [first, second] = qbs as [string, string]
    const chosen = { ...team.depthChart, QB: [second, 'gone-player', first] }
    const missingOnPurpose = qbs.slice(2)
    const state = {
      ...base,
      teams: {
        ...base.teams,
        [base.userTeam]: {
          ...team,
          depthChart: { ...chosen, QB: chosen.QB.filter((id) => !missingOnPurpose.includes(id)) },
        },
      },
    }
    const next = reconcileDepthChart(state, base.userTeam).teams[base.userTeam]!.depthChart.QB!
    expect(next.slice(0, 2)).toEqual([second, first])
    expect(next).not.toContain('gone-player')
    expect(new Set(next)).toEqual(new Set(qbs))
    const appended = next.slice(2)
    const ovr = (id: string) => base.scouting[id]!.ovr
    expect([...appended].sort((a, b) => ovr(b) - ovr(a) || a.localeCompare(b))).toEqual(appended)
  })
})
