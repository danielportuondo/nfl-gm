import { beforeAll, describe, expect, it } from 'vitest'
import type { PlayerId, TeamId } from '@contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../../../scripts/lib/publicData'
import { runSeason } from './harness'

const SEASONS = [2016, 2017, 2018, 2019]
const SIMS_PER_SEASON = 2
const JUSZCZYK = '00-0029892'

interface FullbackSeason {
  maxFbCarries: number
  fullbacks: number
  juszczykLedLeague: boolean
  juszczykLedTeam: boolean
}

/** Real fullbacks run 0–40 times a season; Juszczyk's 2018 consensus made him SF's RB1 on paper. */
describe('fullbacks on 2016–2019 data', () => {
  const seasons: FullbackSeason[] = []

  beforeAll(async () => {
    const latest = readManifest().latestRealSeason
    for (const season of SEASONS) {
      const ctx = await loadRealContext(seasonsForNewGame(season, latest))
      const fullbacks = new Set(
        ctx
          .seasonData(season)!
          .players.players.filter((p) => p.role === 'FB')
          .map((p) => p.id),
      )
      const state = ctx.modules.league.newGame(
        {
          seed: 'fullbacks',
          startSeason: season,
          userTeam: 'IND',
          horizonSeasons: 1,
          settings: { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true },
          startAt: 'PRESEASON',
        },
        ctx,
      )
      for (let i = 0; i < SIMS_PER_SEASON; i++) {
        const carries = new Map<PlayerId, number>()
        const yards = new Map<PlayerId, number>()
        const teamOf = new Map<PlayerId, TeamId>()
        runSeason({ ...state, seed: `${state.seed}#${i}` }, ctx, (r) => {
          for (const line of [...r.box!.home, ...r.box!.away]) {
            if (!line.rushAtt) continue
            carries.set(line.playerId, (carries.get(line.playerId) ?? 0) + line.rushAtt)
            yards.set(line.playerId, (yards.get(line.playerId) ?? 0) + (line.rushYds ?? 0))
            teamOf.set(line.playerId, line.teamId)
          }
        })
        const ranked = [...yards.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        const sfLeader = ranked.find(([id]) => teamOf.get(id) === 'SF')?.[0]
        seasons.push({
          maxFbCarries: Math.max(0, ...[...fullbacks].map((id) => carries.get(id) ?? 0)),
          fullbacks: [...fullbacks].filter((id) => carries.has(id)).length,
          juszczykLedLeague: ranked[0]?.[0] === JUSZCZYK,
          juszczykLedTeam: sfLeader === JUSZCZYK,
        })
      }
    }
  }, 120_000)

  it('fullbacks carry like fullbacks', () => {
    expect(seasons.every((s) => s.fullbacks > 5)).toBe(true)
    expect(Math.max(...seasons.map((s) => s.maxFbCarries))).toBeLessThanOrEqual(80)
  })

  it('Juszczyk never leads the league or the 49ers in rushing', () => {
    expect(seasons.some((s) => s.juszczykLedLeague)).toBe(false)
    expect(seasons.some((s) => s.juszczykLedTeam)).toBe(false)
  })
})
