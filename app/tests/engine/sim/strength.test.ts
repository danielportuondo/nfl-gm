import { describe, expect, it } from 'vitest'
import type { Game, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { mockLeague } from '@fixtures/mockLeague'
import { sim } from '@engine/sim/index'
import { computeTeamStrength, truthFallbackCount } from '@engine/sim/strength'
import { makeCtx } from './harness'
import { testRng } from './testRng'

const ctx = makeCtx()
const base = mockLeague({ seed: 'strength', season: 2021 })
const [HOME, AWAY] = Object.keys(base.teams).sort() as [TeamId, TeamId]

const setTruth = (state: LeagueState, ids: readonly PlayerId[], value: number): LeagueState => {
  const truth = { ...state.truth }
  for (const id of ids) truth[id] = { bySeason: { [String(state.season)]: value }, retiresAfter: null }
  return { ...state, truth }
}

const rosterOf = (state: LeagueState, teamId: TeamId) => state.teams[teamId]!.roster.map((r) => r.playerId)

const neutralGame: Game = {
  id: `${base.season}-REG-1-${AWAY}@${HOME}`,
  season: base.season,
  week: 1,
  type: 'REG',
  home: HOME,
  away: AWAY,
  neutralSite: true,
}

function homeWinPct(state: LeagueState, trials: number): number {
  let wins = 0
  for (let i = 0; i < trials; i++) {
    const result = sim.simulateGame(state, neutralGame, ctx, testRng.fromSeed('trial', i))
    if (result.homeScore > result.awayScore) wins++
    else if (result.homeScore === result.awayScore) wins += 0.5
  }
  return wins / trials
}

describe('team strength from true current-season value', () => {
  it('a team of 90s beats a team of 60s nearly every time', () => {
    let state = setTruth(base, rosterOf(base, HOME), 90)
    state = setTruth(state, rosterOf(state, AWAY), 60)
    expect(computeTeamStrength(state, HOME).overall).toBeGreaterThan(computeTeamStrength(state, AWAY).overall + 25)
    expect(homeWinPct(state, 1000)).toBeGreaterThanOrEqual(0.9)
  })

  it('the quarterback moves the needle more than a safety', () => {
    let level = setTruth(base, rosterOf(base, HOME), 60)
    level = setTruth(level, rosterOf(level, AWAY), 60)
    const even = homeWinPct(level, 1000)

    const qb = level.teams[HOME]!.depthChart.QB![0]!
    const safety = level.teams[HOME]!.depthChart.S![0]!
    const withQb = homeWinPct(setTruth(level, [qb], 90), 1000)
    const withSafety = homeWinPct(setTruth(level, [safety], 90), 1000)

    expect(even).toBeGreaterThan(0.45)
    expect(even).toBeLessThan(0.55)
    expect(withQb).toBeGreaterThan(withSafety + 0.05)
    expect(withSafety).toBeGreaterThan(even)
  })

  it('excludes injured players and reads truth rather than consensus', () => {
    const level = setTruth(base, rosterOf(base, HOME), 60)
    const qb = level.teams[HOME]!.depthChart.QB![0]!
    const healthy = computeTeamStrength(level, HOME)

    const star = setTruth(level, [qb], 99)
    const hurtStar: LeagueState = {
      ...star,
      teams: {
        ...star.teams,
        [HOME]: {
          ...star.teams[HOME]!,
          roster: star.teams[HOME]!.roster.map((slot) =>
            slot.playerId === qb
              ? { ...slot, injured: { weeksOut: 3, kind: 'knee', season: star.season, week: 1 } }
              : slot,
          ),
        },
      },
    }

    // Still on the depth chart, but hurt: the backup plays and the offense drops back to average.
    expect(hurtStar.teams[HOME]!.depthChart.QB).toContain(qb)
    expect(computeTeamStrength(star, HOME).off).toBeGreaterThan(healthy.off + 5)
    expect(computeTeamStrength(hurtStar, HOME).off).toBeLessThan(computeTeamStrength(star, HOME).off - 5)

    // Consensus must not leak into strength.
    const scouted = { ...level, scouting: { ...level.scouting, [qb]: { ovr: 99, pot: 99, confidence: 1 } } }
    expect(computeTeamStrength(scouted, HOME).overall).toBe(healthy.overall)
  })

  it('every mock player has a true current-season value', () => {
    const before = truthFallbackCount()
    for (const teamId of Object.keys(base.teams).sort()) computeTeamStrength(base, teamId)
    expect(truthFallbackCount()).toBe(before)
  })

  it('ratings stay on the 40-99 scale', () => {
    for (const teamId of Object.keys(base.teams).sort()) {
      const s = computeTeamStrength(base, teamId)
      for (const value of [s.off, s.def, s.st, s.overall]) {
        expect(value).toBeGreaterThanOrEqual(40)
        expect(value).toBeLessThanOrEqual(99)
      }
    }
  })
})
