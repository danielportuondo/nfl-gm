/**
 * Sign-and-flip (2018 playthrough): in the 2017-label offseason the user signed stars at the ask on
 * 1-year deals and flipped them the same day for 25–75 points, though those deals expire at the camp
 * rollover weeks later. A just-signed free agent is now locked until week 1, a deal is worth the
 * seasons of control it really carries, and a buying AI charges salary in full. Played for real: a
 * 2017 MIA game through its first season into the next free agency.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type { Contract, EngineContext, LeagueState, PlayerId, TeamId } from '@contracts/index'
import { trade } from '@engine/trade'
import { controlSeasons, incomingValue } from '@engine/trade/value'
import { loadRealContext } from '../../../scripts/lib/publicData'
import { emptyLog, userCutdowns, userDraft, userResign } from '../../../scripts/lib/scriptedGm'
import { putPlayer, scenario, userProposal } from './helpers'

const SETTINGS = {
  tradeStrictness: 'balanced' as const,
  aiOfferFrequency: 'normal' as const,
  injuries: true,
}

/** MIA, 2017 start, played to FREE_AGENCY of the 2017-label offseason (league year 2018). */
function playToSecondFreeAgency(ctx: EngineContext): LeagueState {
  const { league, draft } = ctx.modules
  const log = emptyLog()
  let s = league.newGame(
    {
      seed: 'sign-flip',
      startSeason: 2017,
      userTeam: 'MIA',
      horizonSeasons: 3,
      settings: SETTINGS,
    },
    ctx,
  )
  s = userDraft(draft.startDraft(s, ctx), ctx, log)
  for (let i = 0; i < 4; i++) s = league.advancePhase(s, ctx) // → UDFA → FA → CAMP → PRESEASON
  s = league.advancePhase(userCutdowns(s, ctx, log), ctx) // → REGULAR
  while (s.phase === 'REGULAR' || s.phase === 'PLAYOFFS') s = league.simWeek(s, ctx).state
  s = league.advancePhase(userResign(s, ctx, log), ctx) // → DRAFT
  s = userDraft(draft.startDraft(s, ctx), ctx, log)
  s = league.advancePhase(s, ctx) // → UDFA
  return league.advancePhase(s, ctx) // → FREE_AGENCY
}

const OLD_DEAL: Contract = { years: 1, apy: 1, guaranteedPct: 0.5, signedSeason: 0, rookie: false }

function withContract(
  state: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  contract: Partial<Contract>,
): LeagueState {
  const team = state.teams[teamId]!
  const base = {
    playerId,
    teamId,
    contract: { years: 1, apy: 1, guaranteedPct: 0.5, signedSeason: state.season, rookie: false },
  }
  const existing = team.roster.find((r) => r.playerId === playerId)
  const slot = { ...(existing ?? base), contract: { ...(existing ?? base).contract, ...contract } }
  const roster = existing
    ? team.roster.map((r) => (r.playerId === playerId ? slot : r))
    : [...team.roster, slot]
  return {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, roster } },
    freeAgents: state.freeAgents.filter((id) => id !== playerId),
  }
}

describe('trade — remaining control and the just-signed lock (real 2017 → 2018 offseason)', () => {
  let ctx: EngineContext
  let state: LeagueState

  beforeAll(async () => {
    ctx = await loadRealContext([2017, 2018, 2019])
    state = playToSecondFreeAgency(ctx)
  }, 120000)

  const nextPick = (teamId: TeamId, round: number) => {
    const p = state.picks.find((x) => x.owner === teamId && x.round === round && !x.playerId)!
    return { season: p.season, round: p.round, originalTeam: p.originalTeam }
  }

  it('is a non-opening offseason, where a 1-year deal expires at the camp rollover', () => {
    expect(state.phase).toBe('FREE_AGENCY')
    expect(state.season).toBe(2017)
    expect(controlSeasons(state, { ...OLD_DEAL, years: 1, signedSeason: state.season }, ctx)).toBe(
      0,
    )
  })

  it('a star signed at his ask on a 1-year deal cannot be flipped the same day', () => {
    const { fa } = ctx.modules
    // The playthrough had cap room to burn; give MIA the same by trimming every salary to $1M.
    const mia = state.teams['MIA']!
    const roomy: LeagueState = {
      ...state,
      teams: {
        ...state.teams,
        MIA: {
          ...mia,
          roster: mia.roster.map((r) => ({
            ...r,
            contract: { ...r.contract, apy: Math.min(1, r.contract.apy) },
          })),
        },
      },
    }
    const star = fa
      .freeAgentPool(roomy)
      .filter((id) => roomy.scouting[id] !== undefined)
      .sort((a, b) => roomy.scouting[b]!.ovr - roomy.scouting[a]!.ovr)[0]!
    expect(roomy.scouting[star]!.ovr).toBeGreaterThan(75)
    const contract: Contract = {
      years: 1,
      apy: fa.resignAsk(roomy, star, ctx),
      guaranteedPct: 0.5,
      signedSeason: roomy.season,
      rookie: false,
    }
    let signed: LeagueState | null = null
    for (let i = 0; i < 20 && !signed; i++) {
      const outcome = fa.offer(
        roomy,
        'MIA',
        star,
        contract,
        ctx,
        ctx.modules.rng.fromSeed('sign', i),
      )
      if (outcome.accepted) signed = outcome.state
    }
    expect(signed).not.toBeNull()
    const flip = userProposal(signed!, { players: [star] }, { picks: [nextPick('KC', 2)] }, 'KC')
    const evaluation = trade.evaluate(signed!, flip, ctx)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.p).toBe(0)
    expect(evaluation.reasons.join(' ')).toMatch(
      /signed this offseason — can't be traded until week 1/,
    )
    // Unlocked, the 1-year deal still plays the coming season (1 season of control, not 0), but a
    // buyer pays well under what the same man would fetch with three more seasons.
    const oneYear = incomingValue(signed!, star, ctx)
    const fourYears = incomingValue(withContract(signed!, 'MIA', star, { years: 4 }), star, ctx)
    expect(oneYear).toBeGreaterThan(1)
    expect(oneYear).toBeLessThan(0.75 * fourYears)
  })

  it('an expiring veteran is worth a fraction of the same man with three more seasons', () => {
    const vet = state.teams['NE']!.roster.map((r) => r.playerId)
      .filter((id) => !state.players[id]!.draft || state.players[id]!.draft!.season < 2015)
      .sort((a, b) => state.scouting[b]!.ovr - state.scouting[a]!.ovr)[0]!
    const expiring = trade.playerValue(withContract(state, 'NE', vet, { years: 1 }), vet, ctx)
    const controlled = trade.playerValue(withContract(state, 'NE', vet, { years: 4 }), vet, ctx)
    expect(controlled).toBeGreaterThan(5)
    expect(expiring).toBeLessThan(0.25 * controlled)
  })

  it('an Osweiler-shaped deal ($18M × 4 for a backup-grade QB) cannot be dumped for a pick', () => {
    const osweiler = Object.values(state.players).find((p) => p.name === 'Brock Osweiler')!.id
    const owner = Object.keys(state.teams).find((t) =>
      state.teams[t]!.roster.some((r) => r.playerId === osweiler),
    )
    let s = owner && owner !== 'MIA' ? state : state
    if (owner && owner !== 'MIA') {
      const team = s.teams[owner]!
      s = {
        ...s,
        teams: {
          ...s.teams,
          [owner]: { ...team, roster: team.roster.filter((r) => r.playerId !== osweiler) },
        },
      }
    }
    s = withContract(s, 'MIA', osweiler, { years: 4, apy: 18, signedSeason: 2016 })
    const forPick = trade.evaluate(
      s,
      userProposal(s, { players: [osweiler] }, { picks: [nextPick('KC', 7)] }, 'KC'),
      ctx,
    )
    const forNothing = trade.evaluate(s, userProposal(s, { players: [osweiler] }, {}, 'KC'), ctx)
    expect(forPick.valid, forPick.reasons.join('; ')).toBe(true)
    expect(forPick.valueIn).toBeLessThan(0)
    expect(forPick.p).toBeLessThan(0.05)
    expect(forNothing.p).toBeLessThan(0.5)
  })

  /** Put `name` on `teamId` (off any other roster) with the given contract. */
  function moveTo(s: LeagueState, teamId: TeamId, name: string, contract: Partial<Contract>) {
    const pid = Object.values(s.players).find((p) => p.name === name)!.id
    const teams = { ...s.teams }
    for (const t of Object.keys(teams))
      teams[t] = { ...teams[t]!, roster: teams[t]!.roster.filter((r) => r.playerId !== pid) }
    return { state: withContract({ ...s, teams }, teamId, pid, contract), id: pid }
  }

  /** The 2018 playthrough's KC dump: Osweiler, Quinn, A. Wilson and Sitton, $39M, all on MIA. */
  function kcDump(): { state: LeagueState; ids: PlayerId[] } {
    let s = state
    const ids: PlayerId[] = []
    for (const [name, apy, years] of [
      ['Brock Osweiler', 18, 4],
      ['Robert Quinn', 6, 2],
      ['Albert Wilson', 8, 3],
      ['Josh Sitton', 7, 3],
    ] as const) {
      const moved = moveTo(s, 'MIA', name, { apy, years, signedSeason: 2016 })
      s = moved.state
      ids.push(moved.id)
    }
    return { state: s, ids }
  }

  /** Bump one of `teamId`'s multi-year deals so next season's committed payroll sits exactly at the cap. */
  function capedOut(s: LeagueState, teamId: TeamId): LeagueState {
    const nextCap = ctx.modules.fa.capFor(s.season + 1, ctx)
    const team = s.teams[teamId]!
    const committed = team.roster
      .filter((r) => controlSeasons(s, r.contract, ctx) >= 1)
      .reduce((sum, r) => sum + r.contract.apy, 0)
    const target = team.roster.find((r) => r.contract.years >= 3)!
    return withContract(s, teamId, target.playerId, {
      apy: target.contract.apy + (nextCap - committed),
    })
  }

  // QA H3: offseason trades skipped the cap check entirely.
  it('H3: dumping $39M on a capped-out team in the offseason is invalid for cap reasons', () => {
    const { state: s, ids } = kcDump()
    const capped = capedOut(s, 'KC')
    const evaluation = trade.evaluate(
      capped,
      userProposal(capped, { players: ids }, { picks: [nextPick('KC', 2)] }, 'KC'),
      ctx,
    )
    expect(evaluation.valid).toBe(false)
    expect(evaluation.reasons.join(' ')).toMatch(
      /KC cannot absorb \$\d+\.\dM more salary next season/,
    )
  })

  it('H3: the real KC of this offseason cannot take the $39M either way', () => {
    const { state: s, ids } = kcDump()
    const evaluation = trade.evaluate(
      s,
      userProposal(s, { players: ids }, { picks: [nextPick('KC', 2)] }, 'KC'),
      ctx,
    )
    expect(evaluation.valid ? evaluation.p : 0).toBeLessThan(0.05)
  })

  it('H3: the user is held to next season’s cap too', () => {
    let s = state
    const ids: PlayerId[] = []
    for (const [name, apy] of [
      ['Brock Osweiler', 18],
      ['Albert Wilson', 8],
      ['Josh Sitton', 7],
    ] as const) {
      const moved = moveTo(s, 'KC', name, { apy, years: 3, signedSeason: 2016 })
      s = moved.state
      ids.push(moved.id)
    }
    s = capedOut(s, 'MIA')
    const evaluation = trade.evaluate(s, userProposal(s, {}, { players: ids }, 'KC'), ctx)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.reasons.join(' ')).toMatch(/MIA cannot absorb .* next season/)
  })

  it('H3: an expiring deal is off next season’s books, and a like-for-like swap still works', () => {
    const { state: s, ids } = kcDump()
    const expiring = withContract(capedOut(s, 'KC'), 'MIA', ids[0]!, { years: 1 })
    const one = trade.evaluate(
      expiring,
      userProposal(expiring, { players: [ids[0]!] }, {}, 'KC'),
      ctx,
    )
    expect(one.reasons.join(' ')).not.toMatch(/absorb/)

    const cheap = (t: TeamId) =>
      state.teams[t]!.roster.find(
        (r) => r.contract.years >= 2 && r.contract.apy <= 2 && r.contract.apy >= 1,
      )!
    const mine = cheap('MIA')
    const theirs = cheap('KC')
    const swap = trade.evaluate(
      state,
      userProposal(state, { players: [mine.playerId] }, { players: [theirs.playerId] }, 'KC'),
      ctx,
    )
    expect(swap.valid, swap.reasons.join('; ')).toBe(true)
  })

  it('control: a star with three or more seasons left is not discounted for control', () => {
    const star = Object.keys(state.teams)
      .sort()
      .filter((t) => t !== 'MIA')
      .flatMap((t) => state.teams[t]!.roster)
      .filter((r) => controlSeasons(state, r.contract, ctx) >= 3)
      .map((r) => r.playerId)
      .sort((a, b) => trade.playerValue(state, b, ctx) - trade.playerValue(state, a, ctx))[0]!
    const owner = Object.keys(state.teams).find((t) =>
      state.teams[t]!.roster.some((r) => r.playerId === star),
    )!
    const years = state.teams[owner]!.roster.find((r) => r.playerId === star)!.contract.years
    const longer = trade.playerValue(
      withContract(state, owner, star, { years: years + 2 }),
      star,
      ctx,
    )
    expect(trade.playerValue(state, star, ctx)).toBeGreaterThan(30)
    expect(trade.playerValue(state, star, ctx) / longer).toBeGreaterThan(0.95)
  })
})

describe('trade — control of deals signed this offseason (contract years mean seasons played)', () => {
  const { state: base, ctx } = scenario()
  const offseason: LeagueState = { ...base, phase: 'FREE_AGENCY' }
  const deal = (years: number, signedSeason: number): Contract => ({
    ...OLD_DEAL,
    years,
    signedSeason,
  })

  it('a fresh deal covers all its years; an older deal has already used the season just played', () => {
    const next = offseason.season + 1
    expect(controlSeasons(offseason, deal(1, next), ctx)).toBe(1)
    expect(controlSeasons(offseason, deal(3, next), ctx)).toBe(3)
    expect(controlSeasons(offseason, deal(1, offseason.season), ctx)).toBe(0)
    expect(controlSeasons(offseason, deal(3, offseason.season), ctx)).toBe(2)
  })

  it('a deal means the same in season, whenever it was signed', () => {
    const inSeason: LeagueState = { ...base, phase: 'PRESEASON' }
    expect(controlSeasons(inSeason, deal(1, inSeason.season), ctx)).toBe(1)
    expect(controlSeasons(inSeason, deal(3, inSeason.season - 1), ctx)).toBe(3)
  })

  it('a star on a fresh 1-year deal is worth more than the same star on an expiring one', () => {
    const star = { id: 'star', pos: 'WR' as const, ovr: 88, age: 27, apy: 1, years: 1 }
    const placed = putPlayer(offseason, 'DAL', star)
    const withSigned = (signedSeason: number): LeagueState => {
      const team = placed.teams['DAL']!
      const roster = team.roster.map((r) =>
        r.playerId === 'star' ? { ...r, contract: { ...r.contract, signedSeason } } : r,
      )
      return { ...placed, teams: { ...placed.teams, DAL: { ...team, roster } } }
    }
    const fresh = trade.playerValue(withSigned(offseason.season + 1), 'star', ctx)
    const expiring = trade.playerValue(withSigned(offseason.season), 'star', ctx)
    expect(expiring).toBeLessThan(1)
    expect(fresh).toBeGreaterThan(5)
  })
})
