/**
 * lifecycle.retirements — acceptance #4 (HANDOFF §6.7 / lifecycle brief):
 *  - real players retire after their last real roster season (hard fact), regardless of age/value.
 *  - procedural/logistic retirement: young (well below 30) non-RB players almost never retire;
 *    old (36+) non-K/P players retire more often than not.
 */
import { describe, expect, it } from 'vitest'
import { type LeagueState, type Player, type PlayerId, type RosterSlot, type TeamState, type TrueTrajectory } from '@contracts/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { lifecycle } from '@engine/lifecycle'
import { makeFakeContext } from '../fakes'

const SEASON = 2016

function playerAt(id: PlayerId, pos: Player['pos'], age: number, real: boolean, retiresAfter: number | null): { player: Player; truth: TrueTrajectory } {
  return {
    player: { id, name: id, pos, birthYear: SEASON - age, draft: null, real, rookieSeason: SEASON - age + 21 },
    truth: { bySeason: { [String(SEASON - 1)]: 65, [String(SEASON)]: 65 }, retiresAfter },
  }
}

/** A LeagueState at `SEASON` with `ids` on a single team roster and everyone else stripped out. */
function stateWith(ids: PlayerId[], players: Record<PlayerId, Player>, truth: Record<PlayerId, TrueTrajectory>): LeagueState {
  const base = mockLeague({ season: SEASON })
  const roster: RosterSlot[] = ids.map((id) => ({
    playerId: id,
    teamId: 'IND',
    contract: { years: 1, apy: 1, guaranteedPct: 0, signedSeason: SEASON, rookie: false },
  }))
  const team: TeamState = {
    id: 'IND', roster, depthChart: {}, record: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    deadMoney: 0, tradeAnnoyance: 0, userControlled: true,
  }
  return { ...base, teams: { IND: team }, players, truth, scouting: {}, freeAgents: [] }
}

const NON_KP_POSITIONS: Player['pos'][] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']
const NON_RB_POSITIONS: Player['pos'][] = ['QB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P']

describe('lifecycle.retirements', () => {
  it('retires a real player after their hard-coded last real season, regardless of age/value', () => {
    const players: Record<PlayerId, Player> = {}
    const truth: Record<PlayerId, TrueTrajectory> = {}
    const { player, truth: t } = playerAt('real-1', 'QB', 25, true, SEASON - 1) // retiresAfter = 2015
    players[player.id] = player
    truth[player.id] = t
    const bundle = mockBundle({ season: SEASON })
    const ctx = makeFakeContext(bundle, { lifecycle })
    const rng = ctx.modules.rng.fromSeed('retire-real', SEASON, 'retirements')

    const { state: next, retired } = lifecycle.retirements(stateWith(['real-1'], players, truth), ctx, rng)
    expect(retired).toEqual(['real-1'])
    expect(next.teams.IND!.roster).toHaveLength(0)
  })

  it('does not force-retire a real player before their last real season', () => {
    const players: Record<PlayerId, Player> = {}
    const truth: Record<PlayerId, TrueTrajectory> = {}
    const { player, truth: t } = playerAt('real-2', 'QB', 25, true, SEASON + 3)
    players[player.id] = player
    truth[player.id] = t
    const bundle = mockBundle({ season: SEASON })
    const ctx = makeFakeContext(bundle, { lifecycle })
    const rng = ctx.modules.rng.fromSeed('retire-real-2', SEASON, 'retirements')

    const { retired } = lifecycle.retirements(stateWith(['real-2'], players, truth), ctx, rng)
    expect(retired).toEqual([])
  })

  it('old (38) non-K/P players retire at P >= 0.5 in aggregate; young (23) non-RB players at P <= 0.05', () => {
    const players: Record<PlayerId, Player> = {}
    const truth: Record<PlayerId, TrueTrajectory> = {}
    const oldIds: PlayerId[] = []
    const youngIds: PlayerId[] = []
    let n = 0
    for (const pos of NON_KP_POSITIONS) {
      for (let i = 0; i < 20; i++) {
        const id = `old-${pos}-${i}-${n++}`
        const { player, truth: t } = playerAt(id, pos, 38, false, null)
        players[id] = player
        truth[id] = t
        oldIds.push(id)
      }
    }
    for (const pos of NON_RB_POSITIONS) {
      for (let i = 0; i < 20; i++) {
        const id = `young-${pos}-${i}-${n++}`
        const { player, truth: t } = playerAt(id, pos, 23, false, null)
        players[id] = player
        truth[id] = t
        youngIds.push(id)
      }
    }
    const bundle = mockBundle({ season: SEASON })
    const ctx = makeFakeContext(bundle, { lifecycle })
    const rng = ctx.modules.rng.fromSeed('retire-logistic', SEASON, 'retirements')

    const state = stateWith([...oldIds, ...youngIds], players, truth)
    const { retired } = lifecycle.retirements(state, ctx, rng)
    const retiredSet = new Set(retired)

    const oldRate = oldIds.filter((id) => retiredSet.has(id)).length / oldIds.length
    const youngRate = youngIds.filter((id) => retiredSet.has(id)).length / youngIds.length

    expect(oldRate).toBeGreaterThanOrEqual(0.5)
    expect(youngRate).toBeLessThanOrEqual(0.05)
  })
})
