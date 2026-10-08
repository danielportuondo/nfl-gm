/**
 * engine/fa — free agency, contracts, cap (§6.6). Implements FaModule (contracts/engine/fa.ts).
 *
 * Money is $M. Cap enforcement is a hard gate only during REGULAR/PLAYOFFS/PRESEASON (validateRoster);
 * offseason phases (OFFSEASON_RESIGN/DRAFT/UDFA/FREE_AGENCY) may run over cap transiently — runAiCutdowns
 * brings every AI team back under cap (and to legal size) before PRESEASON's validateRoster runs.
 */
import {
  ContractSchema,
  SeasonNotLoadedError,
  STARTER_TEMPLATE,
  faStub,
  isInHistory,
  type Contract,
  type EngineContext,
  type FaModule,
  type LeagueState,
  type PlayerId,
  type Position,
  type Rng,
  type RosterSlot,
  type RosterValidation,
  type Season,
  type TeamId,
} from '@contracts/index'
import { faConstants } from './constants'
import { runAiCutdownsImpl } from './aiCutdown'
import { suggestCutdown } from './cutdown'
import {
  capFor,
  capGate,
  capGatedPhase,
  capRefusal,
  isExpiringDeal,
  seasonsLeft,
  payroll,
  releaseFrom,
  round2,
  roundUpTenth,
  rosterLimits,
  stampOffseasonDeal,
} from './internal'
import { logRelease, logResign, logSign } from './transactions'

// -------------------------------------------------------------------------------------------
// Input validation
// -------------------------------------------------------------------------------------------

/**
 * `resign`/`offer` write a caller-supplied Contract straight into state; ContractSchema (the source of
 * truth for bounds, contracts/schemas.ts) is re-checked here so a bad `years` or `guaranteedPct` never
 * reaches deadChargeFor/payroll math (a negative guaranteedPct would produce negative dead money).
 */
function assertValidContract(contract: Contract): void {
  const result = ContractSchema.safeParse(contract)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || 'contract'}: ${i.message}`)
    throw new Error(`invalid contract: ${detail.join('; ')}`)
  }
}

// -------------------------------------------------------------------------------------------
// Cap / payroll
// -------------------------------------------------------------------------------------------

function capSpace(state: LeagueState, teamId: TeamId, ctx: EngineContext): number {
  return capFor(state.season, ctx) - payroll(state, teamId)
}

// -------------------------------------------------------------------------------------------
// Market curve
// -------------------------------------------------------------------------------------------

function capPctFor(pos: Position, ovr: number, age: number): number {
  const c = faConstants
  const x = Math.max(0, ovr - c.valueFloor) / c.valueSpan
  const base = Math.pow(x, c.valueExp) * c.topCapPct
  const posMult = c.positionMultiplier[pos] ?? 1
  const peak = c.peakAge[pos] ?? 27
  const declineStart = peak + c.declineGraceYears
  const perYear = pos === 'RB' ? c.rbDeclinePerYear : c.declinePerYear
  const ageMult = age > declineStart ? Math.pow(perYear, age - declineStart) : 1
  return Math.min(c.maxCapPct, Math.max(c.minCapPct, base * posMult * ageMult))
}

function marketApy(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const player = state.players[playerId]
  if (!player) throw new Error(`fa.marketApy: unknown player "${playerId}"`)
  const ovr = state.scouting[playerId]?.ovr ?? 40
  const age = state.season - player.birthYear
  return round2(capPctFor(player.pos, ovr, age) * capFor(state.season, ctx))
}

function veteranYears(age: number): number {
  for (const band of faConstants.yearsByAge) if (age <= band.maxAge) return band.years
  return faConstants.defaultYears
}

/** Years a veteran of this age and position can plausibly have left (QB/K/P play longer). */
function maxYearsForAge(pos: Position, age: number): number {
  const { default: base, specialist } = faConstants.contractEndAge
  const endAge = pos === 'QB' || pos === 'K' || pos === 'P' ? specialist : base
  return Math.max(1, endAge - age)
}

function clampYears(years: number, max = faConstants.contractYearsSchemaMax): number {
  return Math.min(max, Math.max(1, Math.round(years)))
}

function rookieGuaranteedPct(round: number): number {
  return (
    faConstants.rookieGuaranteedPctByRound[round - 1] ??
    faConstants.rookieGuaranteedPctByRound.at(-1) ??
    1
  )
}

function rookieContract(
  pick: { round: number; pick: number } | null,
  season: Season,
  ctx: EngineContext,
): Contract {
  const cap = capFor(season, ctx)
  if (!pick) {
    return {
      years: faConstants.udfaContractYears,
      apy: round2(faConstants.minCapPct * cap),
      guaranteedPct: faConstants.udfaGuaranteedPct,
      signedSeason: season,
      rookie: true,
    }
  }
  const { topPct, topPctFromCbaSeason, cbaSeason, decay } = faConstants.rookieScale
  const top = season >= cbaSeason ? topPctFromCbaSeason : topPct
  const pct = Math.max(faConstants.minCapPct, top * Math.exp(-decay * (pick.pick - 1)))
  return {
    years: faConstants.rookieContractYears,
    apy: round2(pct * cap),
    guaranteedPct: rookieGuaranteedPct(pick.round),
    signedSeason: season,
    rookie: true,
  }
}

function synthesizeContract(
  state: LeagueState,
  playerId: PlayerId,
  season: Season,
  ctx: EngineContext,
  hint?: { apy?: number; years?: number },
): Contract {
  const player = state.players[playerId]
  if (!player) throw new Error(`fa.synthesizeContract: unknown player "${playerId}"`)
  const ovr = state.scouting[playerId]?.ovr ?? 40
  const age = season - player.birthYear
  // The contracts data occasionally records a $0 APY; a hint has to be a real salary to be used. Hint
  // years can arrive up to 10 from some roster sources; the schema caps at 7, so always clamp.
  const apyHint = hint?.apy !== undefined && hint.apy > 0 ? hint.apy : undefined
  const marketApyVal = round2(capPctFor(player.pos, ovr, age) * capFor(season, ctx))
  const yearsIn = season - player.rookieSeason
  const rookieDeal =
    player.draft !== null && yearsIn >= 0 && yearsIn < faConstants.rookieContractYears
  if (rookieDeal) {
    // Without a recorded salary a rookie is priced off his slot, never the veteran market curve.
    const slot = { round: player.draft!.round, pick: player.draft!.pick }
    return {
      years: clampYears(faConstants.rookieContractYears - yearsIn),
      apy: apyHint ?? rookieContract(slot, player.rookieSeason, ctx).apy,
      guaranteedPct: rookieGuaranteedPct(player.draft!.round),
      signedSeason: player.rookieSeason,
      rookie: true,
    }
  }
  // No signedSeason hint exists yet on RosterEntry; a veteran re-synthesized from a roster snapshot is
  // assumed to have signed this same season (there is no way to recover the real signing year here).
  const years = Math.min(
    maxYearsForAge(player.pos, age),
    hint?.years !== undefined
      ? clampYears(hint.years)
      : clampYears(veteranYears(age), faConstants.maxYears),
  )
  return {
    years,
    apy: apyHint ?? marketApyVal,
    guaranteedPct: faConstants.veteranGuaranteedPct,
    signedSeason: season,
    rookie: false,
  }
}

// -------------------------------------------------------------------------------------------
// Roster helpers
// -------------------------------------------------------------------------------------------

function freeAgentPool(state: LeagueState): PlayerId[] {
  return [...state.freeAgents].sort(
    (a, b) => (state.scouting[b]?.ovr ?? 0) - (state.scouting[a]?.ovr ?? 0) || a.localeCompare(b),
  )
}

function validateRoster(state: LeagueState, teamId: TeamId, ctx: EngineContext): RosterValidation {
  const team = state.teams[teamId]
  const size = team?.roster.length ?? 0
  const limits = rosterLimits(state)
  const errors: string[] = []
  if (!team) errors.push('unknown team')
  if (size < limits.min) errors.push(`roster has ${size} players; minimum is ${limits.min}`)
  if (size > limits.max) errors.push(`roster has ${size} players; maximum is ${limits.max}`)
  const cap = capFor(state.season, ctx)
  const pay = payroll(state, teamId)
  if (capGatedPhase(state) && pay > cap) {
    errors.push(`payroll $${pay.toFixed(2)}M exceeds cap $${cap.toFixed(2)}M`)
  }
  return { ok: errors.length === 0, size, payroll: pay, capSpace: cap - pay, errors }
}

function findTeamOf(state: LeagueState, playerId: PlayerId): TeamId | undefined {
  return Object.keys(state.teams)
    .sort()
    .find((teamId) => state.teams[teamId]!.roster.some((r) => r.playerId === playerId))
}

function realOpeningDayRoster(
  state: LeagueState,
  ctx: EngineContext,
  teamId: TeamId,
): Set<PlayerId> | null {
  if (!isInHistory(ctx, state.season)) return null
  try {
    const sd = ctx.seasonData(state.season)
    return sd ? new Set((sd.rosters.rosters[teamId] ?? []).map((e) => e.playerId)) : null
  } catch (e) {
    if (e instanceof SeasonNotLoadedError) return null
    throw e
  }
}

function realTeamsOf(ctx: EngineContext, season: Season): Map<PlayerId, TeamId | null> | null {
  if (!isInHistory(ctx, season)) return null
  try {
    const sd = ctx.seasonData(season)
    return sd ? new Map(sd.players.players.map((p) => [p.id, p.team])) : null
  } catch (e) {
    if (e instanceof SeasonNotLoadedError) return null
    throw e
  }
}

// -------------------------------------------------------------------------------------------
// Release / resign
// -------------------------------------------------------------------------------------------

function release(
  state: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  ctx: EngineContext,
): LeagueState {
  const s = releaseFrom(state, teamId, playerId, ctx, { diverge: true })
  if (teamId !== state.userTeam) return s
  const booked = (t: LeagueState['teams'][TeamId] | undefined) =>
    (t?.deadMoney ?? 0) + (t?.carriedDeadMoney ?? 0)
  const deadMoney = round2(booked(s.teams[teamId]) - booked(state.teams[teamId]))
  return logRelease(state, s, playerId, deadMoney)
}

/** Natural contract expiration: no dead money, no divergence — the player simply leaves the roster. */
function expireToFreeAgent(state: LeagueState, teamId: TeamId, playerId: PlayerId): LeagueState {
  const team = state.teams[teamId]
  if (!team) return state
  const roster = team.roster.filter((r) => r.playerId !== playerId)
  if (roster.length === team.roster.length) return state
  return {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, roster } },
    freeAgents: [...state.freeAgents, playerId].sort(),
  }
}

function resignAsk(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const market = marketApy(state, playerId, ctx)
  const r = ctx.modules.rng.fromSeed(state.seed, state.season, 'resignAsk', playerId)
  const jitter = (r.next() * 2 - 1) * faConstants.resignAskJitter
  return round2(market * (1 + jitter))
}

function resign(
  state: LeagueState,
  playerId: PlayerId,
  contract: Contract,
  ctx: EngineContext,
): LeagueState {
  assertValidContract(contract)
  if (state.phase !== 'OFFSEASON_RESIGN')
    throw new Error(
      `fa.resign: only allowed during OFFSEASON_RESIGN (current phase is "${state.phase}")`,
    )
  const teamId = findTeamOf(state, playerId)
  if (!teamId) throw new Error(`fa.resign: player "${playerId}" is not on a roster`)
  const team = state.teams[teamId]!
  const slot = team.roster.find((r) => r.playerId === playerId)!
  // Matches how the Free Agency screen (and rolloverContracts) treat a contract as expiring.
  if (!isExpiringDeal(state, slot.contract))
    throw new Error(
      `fa.resign: player "${playerId}"'s contract has ${slot.contract.years} years remaining, not expiring`,
    )
  if (ctx.modules.lifecycle.leavesAfterSeason(state, playerId))
    throw new Error('fa.resign: He is leaving football and has no season left to sign for')
  const ask = resignAsk(state, playerId, ctx)
  if (contract.apy < ask - faConstants.askTolerance - 1e-9)
    throw new Error(`fa.resign: That offer is below the ask of $${roundUpTenth(ask).toFixed(1)}M`)
  // The expiring deal being renewed is not in next season's books, so the whole new apy counts.
  const refusal = capRefusal(capGate(state, teamId, ctx), contract.apy)
  if (refusal) throw new Error(`fa.resign: ${refusal}`)
  const renewed = stampOffseasonDeal(state, contract)
  let s = ctx.modules.history.markDiverged(state, [playerId])
  const roster = s.teams[teamId]!.roster.map((r) =>
    r.playerId === playerId ? { ...r, contract: renewed } : r,
  )
  s = { ...s, teams: { ...s.teams, [teamId]: { ...s.teams[teamId]!, roster } } }
  return logResign(state, s, playerId, renewed)
}

function runAiResign(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState {
  let s = state
  const realTeams = realTeamsOf(ctx, s.season + 1)
  for (const teamId of Object.keys(s.teams).sort()) {
    const team = s.teams[teamId]
    if (!team || team.userControlled) continue
    const expiringIds = team.roster
      .filter((slot) => isExpiringDeal(s, slot.contract))
      .map((slot) => slot.playerId)
      .sort()
    for (const playerId of expiringIds) {
      const player = s.players[playerId]
      const slot = s.teams[teamId]!.roster.find((r) => r.playerId === playerId)
      if (!player || !slot) continue
      let keep: boolean
      if (ctx.modules.lifecycle.leavesAfterSeason(s, playerId)) {
        keep = false
      } else if (realTeams && player.real) {
        keep = realTeams.get(playerId) === teamId
      } else {
        const ovr = s.scouting[playerId]?.ovr ?? 40
        const marketVal = marketApy(s, playerId, ctx)
        const spaceAfter = capSpace(s, teamId, ctx) + slot.contract.apy - marketVal
        const decide = rng.fork(`resign:${teamId}:${playerId}`)
        keep =
          ovr >= faConstants.aiResignOvrThreshold &&
          spaceAfter >= 0 &&
          decide.chance(faConstants.aiResignBaseChance)
      }
      if (keep) {
        const contract = stampOffseasonDeal(s, synthesizeContract(s, playerId, s.season, ctx))
        const roster = s.teams[teamId]!.roster.map((r) =>
          r.playerId === playerId ? { ...r, contract } : r,
        )
        s = { ...s, teams: { ...s.teams, [teamId]: { ...s.teams[teamId]!, roster } } }
      } else {
        s = expireToFreeAgent(s, teamId, playerId)
      }
    }
  }
  return s
}

// -------------------------------------------------------------------------------------------
// Free agency bidding
// -------------------------------------------------------------------------------------------

function teamQuality(state: LeagueState, teamId: TeamId): number {
  const roster = state.teams[teamId]?.roster ?? []
  if (roster.length === 0) return 0.5
  const avg =
    roster.reduce((sum, r) => sum + (state.scouting[r.playerId]?.ovr ?? 60), 0) / roster.length
  return Math.min(1, Math.max(0, (avg - 55) / 30))
}

function acceptProbability(ratio: number, quality: number): number {
  const { askSlope, atAskBias, qualityWeight } = faConstants.acceptance
  const x = askSlope * (ratio - 1) + atAskBias + qualityWeight * (quality - 0.5)
  return Math.min(1, Math.max(0, 1 / (1 + Math.exp(-x))))
}

function offerOdds(
  state: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  contract: Contract,
  ctx: EngineContext,
): number {
  const ask = resignAsk(state, playerId, ctx)
  const ratio = contract.apy / Math.max(0.01, ask)
  return acceptProbability(ratio, teamQuality(state, teamId))
}

function offer(
  state: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  contract: Contract,
  ctx: EngineContext,
  rng: Rng,
): { accepted: boolean; state: LeagueState; reason?: string } {
  assertValidContract(contract)
  const team = state.teams[teamId]
  if (!team) throw new Error(`fa.offer: unknown team "${teamId}"`)
  const p = offerOdds(state, teamId, playerId, contract, ctx)
  if (team.roster.length + 1 > rosterLimits(state).max) {
    const reason = `Your roster is full (${team.roster.length} players). Release someone first.`
    return { accepted: false, state, reason }
  }
  const capReason = capRefusal(capGate(state, teamId, ctx), contract.apy)
  if (capReason) return { accepted: false, state, reason: capReason }
  if (!rng.chance(p)) return { accepted: false, state }
  let s = ctx.modules.history.markDiverged(state, [playerId])
  const signed = stampOffseasonDeal(state, contract)
  const roster = [...s.teams[teamId]!.roster, { playerId, teamId, contract: signed }]
  s = {
    ...s,
    teams: { ...s.teams, [teamId]: { ...s.teams[teamId]!, roster } },
    freeAgents: s.freeAgents.filter((id) => id !== playerId),
  }
  if (teamId === state.userTeam) s = logSign(state, s, playerId, signed)
  // A real absentee signed in season is out for the weeks he really missed, from the signing on.
  return { accepted: true, state: ctx.modules.lifecycle.applyWeekAbsences(s) }
}

function pickFallbackTeam(
  state: LeagueState,
  ctx: EngineContext,
  playerId: PlayerId,
  rng: Rng,
): TeamId | undefined {
  const player = state.players[playerId]!
  const cost = marketApy(state, playerId, ctx)
  const candidates = Object.keys(state.teams)
    .sort()
    .filter((id) => {
      const t = state.teams[id]!
      const atPosition = t.roster.filter(
        (r) => state.players[r.playerId]?.pos === player.pos,
      ).length
      // Need-driven: a team past camp size only adds a position it is short at, so the pool is not
      // drained to 90-man rosters before the user's own free agency and preseason fill.
      const wantsBody =
        t.roster.length < faConstants.aiFallbackRosterTarget ||
        atPosition < (faConstants.positionMinimums[player.pos] ?? 0)
      return (
        !t.userControlled &&
        wantsBody &&
        t.roster.length < faConstants.offseasonRosterMax &&
        capSpace(state, id, ctx) >= cost
      )
    })
  if (candidates.length === 0) return undefined
  const scored = candidates.map((id) => {
    const team = state.teams[id]!
    const count = team.roster.filter((r) => state.players[r.playerId]?.pos === player.pos).length
    const need = Math.max(0, (STARTER_TEMPLATE[player.pos] ?? 1) - count)
    const noise = rng.fork(`faFallback:${id}:${playerId}`).next() * 0.25
    return { id, score: need + capSpace(state, id, ctx) / 1000 + noise }
  })
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return scored[0]?.id
}

function runAiFreeAgency(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState {
  let s = state
  const realTeams = realTeamsOf(ctx, s.season + 1)
  for (const playerId of freeAgentPool(s)) {
    const player = s.players[playerId]
    if (!player) continue
    let targetTeam: TeamId | undefined
    if (realTeams && player.real) {
      const rt = realTeams.get(playerId)
      if (rt && s.teams[rt] && !s.teams[rt]!.userControlled) targetTeam = rt
    }
    if (!targetTeam) targetTeam = pickFallbackTeam(s, ctx, playerId, rng)
    if (!targetTeam) continue
    const team = s.teams[targetTeam]
    if (!team || team.roster.length >= faConstants.offseasonRosterMax) continue
    const contract = stampOffseasonDeal(s, synthesizeContract(s, playerId, s.season, ctx))
    if (payroll(s, targetTeam) + contract.apy > capFor(s.season, ctx)) continue
    const roster = [...team.roster, { playerId, teamId: targetTeam, contract }]
    s = {
      ...s,
      teams: { ...s.teams, [targetTeam]: { ...team, roster } },
      freeAgents: s.freeAgents.filter((id) => id !== playerId),
    }
  }
  return s
}

// -------------------------------------------------------------------------------------------
// Cutdowns / rollover
// -------------------------------------------------------------------------------------------

function runAiCutdowns(state: LeagueState, ctx: EngineContext): LeagueState {
  return runAiCutdownsImpl(state, ctx, {
    rookieContract,
    synthesizeContract,
    freeAgentPool,
    realRoster: realOpeningDayRoster,
  })
}

function rolloverContracts(
  state: LeagueState,
  _ctx: EngineContext,
): { state: LeagueState; expiring: Record<TeamId, PlayerId[]> } {
  let teams = state.teams
  let freeAgents = state.freeAgents
  const expiring: Record<TeamId, PlayerId[]> = {}
  for (const teamId of Object.keys(teams).sort()) {
    const team = teams[teamId]!
    const kept: RosterSlot[] = []
    const exp: PlayerId[] = []
    for (const slot of team.roster) {
      // A deal made this offseason starts now: nothing has been played under it yet.
      if (slot.contract.signedSeason >= state.season) {
        kept.push(slot)
        continue
      }
      const years = slot.contract.years - 1
      if (years <= 0) exp.push(slot.playerId)
      else kept.push({ ...slot, contract: { ...slot.contract, years } })
    }
    if (exp.length) expiring[teamId] = exp.sort()
    // Season S's dead money clears; what offseason releases booked becomes the new year's.
    teams = {
      ...teams,
      [teamId]: {
        ...team,
        roster: kept,
        deadMoney: team.carriedDeadMoney ?? 0,
        carriedDeadMoney: 0,
      },
    }
    freeAgents = [...freeAgents, ...exp]
  }
  return { state: { ...state, teams, freeAgents: [...new Set(freeAgents)].sort() }, expiring }
}

// -------------------------------------------------------------------------------------------
// Module
// -------------------------------------------------------------------------------------------

export {
  capGate,
  committedPayroll,
  gateSeason,
  isExpiringDeal,
  roundUpTenth,
  seasonsLeft,
} from './internal'
export type { CapGate } from './internal'

export const fa: FaModule = {
  ...faStub,
  capFor,
  payroll,
  capSpace,
  marketApy,
  rookieContract,
  synthesizeContract,
  resignAsk,
  resign,
  runAiResign,
  freeAgentPool,
  offer,
  offerOdds,
  runAiFreeAgency,
  runAiCutdowns,
  release,
  suggestCutdown,
  validateRoster,
  rolloverContracts,
  seasonsLeft,
  isExpiringDeal,
}
