/**
 * Lineup-aware valuation on the real 2017 offseason (a MIA playthrough, 2026-10-05): NE sold Tom Brady
 * for Tannehill, Julius Thomas, Nate Allen, Verner and two late picks, then cut Tannehill and started
 * Hoyer. The seller now pays for the starter it loses (the talent drop to its next-best man at the slot)
 * and the buyer counts players who would not crack its lineup at a reduced share. Deals that touch no
 * AI starter and bring back nobody to sit on the bench must price exactly as before.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { EngineContext, LeagueState, PickRef, PlayerId, TeamId } from '@contracts/index'
import { trade } from '@engine/trade'
import { suggestionConstants } from '@engine/trade/constants'
import { mirror } from '@engine/trade/evaluate'
import { isStarter } from '@engine/trade/lineup'
import { ageOf, incomingValue } from '@engine/trade/value'
import { suggestionNeeds, weakestStarterOvr } from '@engine/trade/suggest'
import { loadRealContext } from '../../../scripts/lib/publicData'
import { userProposal } from './helpers'

const SETTINGS = {
  tradeStrictness: 'balanced' as const,
  aiOfferFrequency: 'normal' as const,
  injuries: true,
}

describe('trade — starters and filler (real 2017 offseason, user MIA)', () => {
  let ctx: EngineContext
  let state: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext([2017, 2018, 2019])
    // startDraft stops at pick 1, so advance runs the AI up to MIA's first pick, by which point KC has taken Mahomes.
    state = ctx.modules.draft.advance(
      ctx.modules.draft.startDraft(
        ctx.modules.league.newGame(
          {
            seed: '2017-MIA-986okssy',
            startSeason: 2017,
            userTeam: 'MIA',
            horizonSeasons: 3,
            settings: SETTINGS,
          },
          ctx,
        ),
        ctx,
      ),
      ctx,
    )
  }, 30000)

  const id = (name: string, team: TeamId): PlayerId => {
    const found = state.teams[team]!.roster.find((r) => state.players[r.playerId]!.name === name)
    if (!found) throw new Error(`${name} is not on ${team}`)
    return found.playerId
  }
  const pick = (season: number, round: number, originalTeam: TeamId): PickRef => ({
    season,
    round,
    originalTeam,
  })
  /** Asset sums with no lineup rule: what the AI pays to buy each player, or gets for selling him. */
  const listValue = (players: PlayerId[], picks: PickRef[], buying = false) =>
    players.reduce(
      (s, p) => s + (buying ? incomingValue(state, p, ctx) : trade.playerValue(state, p, ctx)),
      0,
    ) + picks.reduce((s, p) => s + trade.pickValue(state, p, ctx), 0)

  /** Valuation the lineup rules must leave alone: within 10% of the plain asset sums on both sides. */
  function expectPlainPrice(
    gives: PlayerId[],
    givePicks: PickRef[],
    wants: PlayerId[],
    wantPicks: PickRef[],
    ai: TeamId,
  ) {
    const evaluation = trade.evaluate(
      state,
      userProposal(
        state,
        { players: gives, picks: givePicks },
        { players: wants, picks: wantPicks },
        ai,
      ),
      ctx,
    )
    expect(evaluation.valid, evaluation.reasons.join('; ')).toBe(true)
    expect(evaluation.valueIn / listValue(gives, givePicks, true)).toBeGreaterThan(0.9)
    expect(evaluation.valueOut / listValue(wants, wantPicks)).toBeLessThan(1.1)
  }

  it('NE declines Brady for Tannehill, Julius Thomas, Nate Allen, Verner and 2018 R5/R6', () => {
    const brady = id('Tom Brady', 'NE')
    const proposal = userProposal(
      state,
      {
        players: [
          id('Ryan Tannehill', 'MIA'),
          id('Julius Thomas', 'MIA'),
          id('Nate Allen', 'MIA'),
          id('Alterraun Verner', 'MIA'),
        ],
        picks: [pick(2018, 5, 'MIA'), pick(2018, 6, 'MIA')],
      },
      { players: [brady] },
      'NE',
    )
    const evaluation = trade.evaluate(state, proposal, ctx)
    // On value alone NE wants well over what it gets (the starter-loss charge plus three discounted
    // fillers); since H3 the extra $24M of salary would not fit under its 2017 cap either.
    expect(evaluation.valueIn).toBeLessThan(0.7 * evaluation.valueOut)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.reasons.join(' ')).toMatch(/NE cannot absorb .* next season/)
  })

  // QA L5: offseason ages used the season just played, so Brady was valued at 39.
  it('values the offseason at the coming season’s age', () => {
    expect(ageOf(state, id('Tom Brady', 'NE'), ctx)).toBe(40)
  })

  it('prices Brady, NE’s only starting QB, at 1.5–2.5× his stand-alone value', () => {
    // Brady is 40 on a one-season deal (synthesized deals end by age 39 for QBs), so a first-rounder
    // now outbids even his lineup-charged price and there is nothing to counter; a second falls short.
    const brady = id('Tom Brady', 'NE')
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { picks: [pick(2017, 2, 'MIA')] }, { players: [brady] }, 'NE'),
      ctx,
    )
    const alone = trade.playerValue(state, brady, ctx)
    expect(evaluation.valueOut / alone).toBeGreaterThan(1.5)
    expect(evaluation.valueOut / alone).toBeLessThan(2.5)

    // The counter asks for one more asset NE counts in full, not another bench body at half price.
    const proposal = userProposal(
      state,
      { picks: [pick(2017, 2, 'MIA')] },
      { players: [brady] },
      'NE',
    )
    const outcome = trade.submit(state, proposal, ctx, ctx.modules.rng.fromSeed('brady', 0))
    expect(outcome.accepted).toBe(false)
    const counter = outcome.counter!
    expect(counter).not.toBeNull()
    const own = trade.evaluate(state, mirror(counter), ctx)
    expect(own.p).toBeGreaterThanOrEqual(0.5)
    expect(own.reasons.join(' ')).not.toMatch(/would not start/)
  })

  it('four MIA backups do not add up to a DAL starter', () => {
    const gives = [
      id('MarQueis Gray', 'MIA'),
      id('Julius Thomas', 'MIA'),
      id('Bobby McCain', 'MIA'),
      id('Neville Hewitt', 'MIA'),
    ]
    const evaluation = trade.evaluate(
      state,
      userProposal(state, { players: gives }, { players: [id('Demarcus Lawrence', 'DAL')] }, 'DAL'),
      ctx,
    )
    expect(evaluation.valid, evaluation.reasons.join('; ')).toBe(true)
    expect(evaluation.valueIn).toBeLessThan(0.75 * listValue(gives, []))
    expect(evaluation.p).toBeLessThan(0.5)
  })

  it('controls: a backup for a pick, a depth breakout and a rookie behind a starter price as before', () => {
    expectPlainPrice([], [pick(2018, 4, 'MIA')], [id('Brian Hoyer', 'NE')], [], 'NE')
    expectPlainPrice([], [pick(2018, 6, 'MIA')], [id('Vincent Valentine', 'NE')], [], 'NE')
    expectPlainPrice(
      [],
      [pick(2018, 2, 'MIA'), pick(2019, 3, 'MIA'), pick(2019, 4, 'MIA')],
      [id('Patrick Mahomes', 'KC')],
      [],
      'KC',
    )
  })

  it('control: a starter for a comparable starter carries no charge', () => {
    expectPlainPrice([id('Ryan Tannehill', 'MIA')], [], [id('Blake Bortles', 'JAX')], [], 'JAX')
  })

  // QA M10: day-1 suggestions asked MIA for Suh and Landry to "fill" a sliver of an OL need.
  it('day-1 suggestions ask only for the user’s surplus and bring a real upgrade at a real need', () => {
    let total = 0
    for (const team of ['MIA', 'CLE', 'SF', 'NYJ'] as TeamId[]) {
      const opening = ctx.modules.league.newGame(
        {
          seed: '2017-MIA-986okssy',
          startSeason: 2017,
          userTeam: team,
          horizonSeasons: 3,
          settings: SETTINGS,
        },
        ctx,
      )
      const suggestions = trade.suggestTrades(
        opening,
        ctx,
        ctx.modules.rng.fromSeed(opening.seed, 2016, 0, 'suggest'),
      )
      const needs = new Set(suggestionNeeds(opening, team))
      for (const s of suggestions) {
        for (const asked of s.request.players)
          expect(isStarter(opening, team, asked), opening.players[asked]!.name).toBe(false)
        const incoming = s.offer.players[0]!
        const pos = opening.players[incoming]!.pos
        expect(needs.has(pos)).toBe(true)
        expect(opening.scouting[incoming]!.ovr).toBeGreaterThanOrEqual(
          weakestStarterOvr(opening, team, pos) + suggestionConstants.minUpgrade,
        )
        expect(trade.evaluate(opening, mirror(s), ctx).p).toBeGreaterThanOrEqual(0.5)
      }
      total += suggestions.length
    }
    expect(total).toBeGreaterThanOrEqual(8)
  })
})
