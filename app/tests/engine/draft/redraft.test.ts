/**
 * §6.4 acceptance: a 2014 redraft with an uninvolved user tracks reality; a user pick at #1 leaves the
 * rest of the draft sensible; the whole thing is deterministic.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { POSITIONS, type EngineContext, type LeagueState } from '@contracts/index'
import { draft } from '@engine/draft'
import {
  AARON_DONALD,
  CLASS_SEASON,
  CLOWNEY,
  draftContext,
  historicalShare,
  stateAtDraft,
} from './fixture'

const HISTORICAL_TARGET = 0.85

describe('2014 redraft', () => {
  let ctx: EngineContext
  let done: LeagueState

  beforeAll(async () => {
    ctx = await draftContext()
    done = draft.autoDraftToEnd(draft.startDraft(stateAtDraft(ctx, 'IND'), ctx), ctx)
  })

  it('matches reality on at least 85% of picks with the user taking no action', () => {
    const room = done.draftRoom!
    expect(room.status).toBe('COMPLETE')
    expect(room.log.length).toBe(room.order.length)
    console.log(
      `2014 redraft: ${(historicalShare(done) * 100).toFixed(1)}% historical (${room.log.length} picks)`,
    )
    expect(historicalShare(done)).toBeGreaterThanOrEqual(HISTORICAL_TARGET)
  })

  it('gives every pick a rostered rookie with a rookie contract and a draft origin', () => {
    const room = done.draftRoom!
    const drafted = new Set(room.log.map((e) => e.playerId))
    expect(drafted.size).toBe(room.log.length)
    for (const entry of room.log) {
      const player = done.players[entry.playerId]!
      expect(player.draft).toEqual({
        season: CLASS_SEASON,
        round: entry.round,
        pick: entry.pick,
        team: entry.team,
      })
      const slot = done.teams[entry.team]!.roster.find((s) => s.playerId === entry.playerId)
      expect(slot?.contract.rookie).toBe(true)
      expect(room.available).not.toContain(entry.playerId)
      expect(done.freeAgents).not.toContain(entry.playerId)
    }
    for (const teamId of Object.keys(done.teams)) {
      expect(done.teams[teamId]!.roster.length, teamId).toBeLessThanOrEqual(90)
    }
  })

  it('is deterministic: same seed, same log and same room', () => {
    const again = draft.autoDraftToEnd(draft.startDraft(stateAtDraft(ctx, 'IND'), ctx), ctx)
    expect(again.draftRoom).toEqual(done.draftRoom)
    expect([...again.divergence].sort()).toEqual([...done.divergence].sort())
  })

  it('never puts the same player on two rosters', () => {
    const seen = new Map<string, string>()
    for (const teamId of Object.keys(done.teams).sort()) {
      for (const slot of done.teams[teamId]!.roster) {
        expect(
          seen.has(slot.playerId),
          `${slot.playerId} on ${seen.get(slot.playerId)} and ${teamId}`,
        ).toBe(false)
        seen.set(slot.playerId, teamId)
      }
    }
  })
})

describe('user takes Aaron Donald at #1', () => {
  let ctx: EngineContext
  let done: LeagueState

  beforeAll(async () => {
    ctx = await draftContext()
    const started = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    expect(started.draftRoom!.currentPickIndex).toBe(0)
    expect(started.draftRoom!.order[0]!.owner).toBe('HOU')
    expect(started.draftRoom!.available).toContain(AARON_DONALD)
    done = draft.autoDraftToEnd(draft.userPick(started, AARON_DONALD, ctx), ctx)
  })

  it('marks Donald and the displaced historical pick diverged', () => {
    expect(done.divergence.has(AARON_DONALD)).toBe(true)
    expect(done.divergence.has(CLOWNEY)).toBe(true)
    expect(done.players[AARON_DONALD]!.draft).toMatchObject({ pick: 1, round: 1, team: 'HOU' })
  })

  it('hands Donald’s real slot a plausible alternative', () => {
    const room = done.draftRoom!
    const slot13 = room.log.find((e) => e.pick === 13)!
    const replacement = slot13.playerId
    expect(replacement).not.toBe(AARON_DONALD)

    // Top-15 of the pre-draft consensus board, at a position the picking team was not saturated at.
    const board = Object.keys(done.players)
      .filter((id) => done.players[id]!.rookieSeason === CLASS_SEASON)
      .sort((a, b) => done.scouting[b]!.pot - done.scouting[a]!.pot || a.localeCompare(b))
      .slice(0, 15)
    expect(board).toContain(replacement)

    const beforePick = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    const needs = draft.teamNeeds(beforePick, slot13.team)
    expect(needs.saturated).not.toContain(done.players[replacement]!.pos)
  })

  it('leaves round 1 sensible: nobody stockpiles quarterbacks', () => {
    const room = done.draftRoom!
    const roundOne = room.log.filter((e) => e.round === 1)
    const qbsByTeam = new Map<string, number>()
    for (const entry of roundOne) {
      if (done.players[entry.playerId]!.pos !== 'QB') continue
      qbsByTeam.set(entry.team, (qbsByTeam.get(entry.team) ?? 0) + 1)
    }
    for (const [team, n] of qbsByTeam) expect(n, `${team} drafted ${n} QBs in round 1`).toBe(1)

    // A round-1 QB only goes to a team that was not already set there (§6.4 "no 3rd QB in round 1").
    const beforePick = draft.startDraft(stateAtDraft(ctx, 'HOU'), ctx)
    for (const team of qbsByTeam.keys()) {
      expect(draft.teamNeeds(beforePick, team).saturated, team).not.toContain('QB')
    }
    expect(
      roundOne.filter((e) => done.players[e.playerId]!.pos === 'QB').length,
    ).toBeLessThanOrEqual(5)
  })

  it('still tracks history for the rest of the draft', () => {
    expect(historicalShare(done)).toBeGreaterThanOrEqual(0.8)
    // Clowney is not lost — he is the best prospect left and somebody takes him early.
    const clowney = done.draftRoom!.log.find((e) => e.playerId === CLOWNEY)
    expect(clowney, 'Clowney went undrafted').toBeDefined()
    expect(clowney!.round).toBe(1)
  })

  it('touches every position group in the class board', () => {
    const drafted = new Set(done.draftRoom!.log.map((e) => done.players[e.playerId]!.pos))
    expect(POSITIONS.filter((p) => !drafted.has(p))).toEqual([])
  })
})
