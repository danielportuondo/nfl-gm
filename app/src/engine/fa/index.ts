/**
 * engine/fa — free agency, contracts, cap (§6.6). Implements FaModule (contracts/engine/fa.ts).
 *
 * Money is $M. Cap enforcement is a hard gate only during REGULAR/PLAYOFFS/PRESEASON (validateRoster);
 * offseason phases (OFFSEASON_RESIGN/DRAFT/UDFA/FREE_AGENCY) may run over cap transiently — runAiCutdowns
 * brings every AI team back under cap (and to legal size) before PRESEASON's validateRoster runs.
 */
import {
  SeasonNotLoadedError, STARTER_TEMPLATE, faStub, isInHistory,
  type Contract, type EngineContext, type FaModule, type LeagueState, type PlayerId, type Position,
  type Rng, type RosterSlot, type RosterValidation, type Season, type TeamId,
} from '@contracts/index'
import { faConstants } from './constants'

const round2 = (x: number): number => Math.round(x * 100) / 100

// -------------------------------------------------------------------------------------------
// Cap / payroll
// -------------------------------------------------------------------------------------------

function lastRealCapSeason(ctx: EngineContext): Season {
  return Math.max(...Object.keys(ctx.data.cap.bySeason).map(Number))
}

function capFor(season: Season, ctx: EngineContext): number {
  const table = ctx.data.cap.bySeason
  const exact = table[String(season)]
  if (exact !== undefined) return exact
  const last = lastRealCapSeason(ctx)
  const base = table[String(last)]!
  if (season < last) return base
  return base * Math.pow(1 + ctx.data.cap.growthAfterData, season - last)
}

function payroll(state: LeagueState, teamId: TeamId): number {
  const team = state.teams[teamId]
  if (!team) return 0
  return team.roster.reduce((sum, slot) => sum + slot.contract.apy, 0) + team.deadMoney
}

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

function clampYears(years: number, max = faConstants.contractYearsSchemaMax): number {
  return Math.min(max, Math.max(1, Math.round(years)))
}

function rookieContract(pick: { round: number; pick: number } | null, season: Season, ctx: EngineContext): Contract {
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
  const { topPct, decay } = faConstants.rookieScale
  const pct = Math.max(faConstants.minCapPct, topPct * Math.exp(-decay * (pick.pick - 1)))
  return {
    years: faConstants.rookieContractYears,
    apy: round2(pct * cap),
    guaranteedPct: 1,
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
  const rookieDeal = player.draft !== null && yearsIn >= 0 && yearsIn < faConstants.rookieContractYears
  if (rookieDeal) {
    return {
      years: clampYears(faConstants.rookieContractYears - yearsIn),
      apy: apyHint ?? marketApyVal,
      guaranteedPct: 1,
      signedSeason: player.rookieSeason,
      rookie: true,
    }
  }
  // No signedSeason hint exists yet on RosterEntry; a veteran re-synthesized from a roster snapshot is
  // assumed to have signed this same season (there is no way to recover the real signing year here).
  const years = hint?.years !== undefined ? clampYears(hint.years) : clampYears(veteranYears(age), faConstants.maxYears)
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

/** Game-legal size applies from PRESEASON through the playoffs; offseason phases allow up to 90. */
function rosterLimits(state: LeagueState): { min: number; max: number } {
  const gate = state.phase === 'PRESEASON' || state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
  return gate ? faConstants.gameRoster : { min: 0, max: faConstants.offseasonRosterMax }
}

function capGatedPhase(state: LeagueState): boolean {
  return state.phase === 'PRESEASON' || state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
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

function starterCounts(state: LeagueState, roster: readonly RosterSlot[]): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {}
  for (const slot of roster) {
    const pos = state.players[slot.playerId]?.pos
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

/** Slots that can legally be cut without dropping a position below its STARTER_TEMPLATE minimum. */
function cutCandidates(state: LeagueState, roster: readonly RosterSlot[]): RosterSlot[] {
  const counts = starterCounts(state, roster)
  return roster.filter((slot) => {
    const pos = state.players[slot.playerId]?.pos
    return pos !== undefined && (counts[pos] ?? 0) > (STARTER_TEMPLATE[pos] ?? 0)
  })
}

/** Size-driven cuts: prefer players off the real opening-day roster, then lowest consensus value. */
function cutOrderBySize(state: LeagueState, roster: readonly RosterSlot[], keepSet: Set<PlayerId> | null): PlayerId[] {
  return cutCandidates(state, roster)
    .sort((a, b) => {
      const aKeep = keepSet?.has(a.playerId) ? 1 : 0
      const bKeep = keepSet?.has(b.playerId) ? 1 : 0
      if (aKeep !== bKeep) return aKeep - bKeep
      const diff = (state.scouting[a.playerId]?.ovr ?? 0) - (state.scouting[b.playerId]?.ovr ?? 0)
      return diff !== 0 ? diff : a.playerId.localeCompare(b.playerId)
    })
    .map((s) => s.playerId)
}

/** Cap-driven cuts: prefer players off the real opening-day roster, then most expensive first. */
function cutOrderByCap(state: LeagueState, roster: readonly RosterSlot[], keepSet: Set<PlayerId> | null): PlayerId[] {
  return cutCandidates(state, roster)
    .sort((a, b) => {
      const aKeep = keepSet?.has(a.playerId) ? 1 : 0
      const bKeep = keepSet?.has(b.playerId) ? 1 : 0
      if (aKeep !== bKeep) return aKeep - bKeep
      const diff = b.contract.apy - a.contract.apy
      return diff !== 0 ? diff : a.playerId.localeCompare(b.playerId)
    })
    .map((s) => s.playerId)
}

function realOpeningDayRoster(state: LeagueState, ctx: EngineContext, teamId: TeamId): Set<PlayerId> | null {
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

/**
 * Dead money applies to every release; divergence only to the user's (§6.8) — an AI team trimming its
 * camp roster is still on the historical path, and snapToHistory must stay free to place those players.
 */
function releaseFrom(
  state: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  ctx: EngineContext,
  opts: { diverge: boolean },
): LeagueState {
  const team = state.teams[teamId]
  if (!team) throw new Error(`fa.release: unknown team "${teamId}"`)
  const slot = team.roster.find((r) => r.playerId === playerId)
  if (!slot) throw new Error(`fa.release: player "${playerId}" is not on team "${teamId}"`)
  const remainingGuaranteed = slot.contract.apy * slot.contract.years * slot.contract.guaranteedPct
  const deadCharge = round2(remainingGuaranteed * faConstants.deadMoneyPct)
  const roster = team.roster.filter((r) => r.playerId !== playerId)
  let s: LeagueState = {
    ...state,
    teams: { ...state.teams, [teamId]: { ...team, roster, deadMoney: round2(team.deadMoney + deadCharge) } },
    freeAgents: [...state.freeAgents, playerId].sort(),
  }
  if (opts.diverge) s = ctx.modules.history.markDiverged(s, [playerId])
  return s
}

function release(state: LeagueState, teamId: TeamId, playerId: PlayerId, ctx: EngineContext): LeagueState {
  return releaseFrom(state, teamId, playerId, ctx, { diverge: true })
}

/** Natural contract expiration: no dead money, no divergence — the player simply leaves the roster. */
function expireToFreeAgent(state: LeagueState, teamId: TeamId, playerId: PlayerId): LeagueState {
  const team = state.teams[teamId]
  if (!team) return state
  const roster = team.roster.filter((r) => r.playerId !== playerId)
  if (roster.length === team.roster.length) return state
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster } }, freeAgents: [...state.freeAgents, playerId].sort() }
}

function resignAsk(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const market = marketApy(state, playerId, ctx)
  const r = ctx.modules.rng.fromSeed(state.seed, state.season, 'resignAsk', playerId)
  const jitter = (r.next() * 2 - 1) * faConstants.resignAskJitter
  return round2(market * (1 + jitter))
}

function resign(state: LeagueState, playerId: PlayerId, contract: Contract, ctx: EngineContext): LeagueState {
  const teamId = findTeamOf(state, playerId)
  if (!teamId) throw new Error(`fa.resign: player "${playerId}" is not on a roster`)
  const ask = resignAsk(state, playerId, ctx)
  if (contract.apy < ask) throw new Error(`fa.resign: offer $${contract.apy}M is below the ask $${ask}M`)
  const team = state.teams[teamId]!
  const currentApy = team.roster.find((r) => r.playerId === playerId)!.contract.apy
  const projectedPayroll = payroll(state, teamId) - currentApy + contract.apy
  if (projectedPayroll > capFor(state.season, ctx)) throw new Error(`fa.resign: contract would exceed the salary cap`)
  let s = ctx.modules.history.markDiverged(state, [playerId])
  const roster = s.teams[teamId]!.roster.map((r) => (r.playerId === playerId ? { ...r, contract } : r))
  s = { ...s, teams: { ...s.teams, [teamId]: { ...s.teams[teamId]!, roster } } }
  return s
}

function runAiResign(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState {
  let s = state
  const realTeams = realTeamsOf(ctx, s.season + 1)
  for (const teamId of Object.keys(s.teams).sort()) {
    const team = s.teams[teamId]
    if (!team || team.userControlled) continue
    const expiringIds = team.roster.filter((slot) => slot.contract.years === 1).map((slot) => slot.playerId).sort()
    for (const playerId of expiringIds) {
      const player = s.players[playerId]
      const slot = s.teams[teamId]!.roster.find((r) => r.playerId === playerId)
      if (!player || !slot) continue
      let keep: boolean
      if (realTeams && player.real) {
        keep = realTeams.get(playerId) === teamId
      } else {
        const ovr = s.scouting[playerId]?.ovr ?? 40
        const marketVal = marketApy(s, playerId, ctx)
        const spaceAfter = capSpace(s, teamId, ctx) + slot.contract.apy - marketVal
        const decide = rng.fork(`resign:${teamId}:${playerId}`)
        keep = ovr >= faConstants.aiResignOvrThreshold && spaceAfter >= 0 && decide.chance(faConstants.aiResignBaseChance)
      }
      if (keep) {
        const contract = synthesizeContract(s, playerId, s.season, ctx)
        const roster = s.teams[teamId]!.roster.map((r) => (r.playerId === playerId ? { ...r, contract } : r))
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
  const avg = roster.reduce((sum, r) => sum + (state.scouting[r.playerId]?.ovr ?? 60), 0) / roster.length
  return Math.min(1, Math.max(0, (avg - 55) / 30))
}

function acceptProbability(ratio: number, quality: number): number {
  const x = 3 * (ratio - 1) + (quality - 0.5)
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
): { accepted: boolean; state: LeagueState } {
  const team = state.teams[teamId]
  if (!team) throw new Error(`fa.offer: unknown team "${teamId}"`)
  const p = offerOdds(state, teamId, playerId, contract, ctx)
  const limits = rosterLimits(state)
  const projectedSize = team.roster.length + 1
  const projectedPayroll = payroll(state, teamId) + contract.apy
  const gatesOk = projectedSize <= limits.max && projectedPayroll <= capFor(state.season, ctx)
  if (!gatesOk || !rng.chance(p)) return { accepted: false, state }
  let s = ctx.modules.history.markDiverged(state, [playerId])
  const roster = [...s.teams[teamId]!.roster, { playerId, teamId, contract }]
  s = {
    ...s,
    teams: { ...s.teams, [teamId]: { ...s.teams[teamId]!, roster } },
    freeAgents: s.freeAgents.filter((id) => id !== playerId),
  }
  return { accepted: true, state: s }
}

function pickFallbackTeam(state: LeagueState, ctx: EngineContext, playerId: PlayerId, rng: Rng): TeamId | undefined {
  const player = state.players[playerId]!
  const cost = marketApy(state, playerId, ctx)
  const candidates = Object.keys(state.teams)
    .sort()
    .filter((id) => {
      const t = state.teams[id]!
      return !t.userControlled && t.roster.length < faConstants.offseasonRosterMax && capSpace(state, id, ctx) >= cost
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
    const contract = synthesizeContract(s, playerId, s.season, ctx)
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
  let s = state
  const { min, max } = faConstants.gameRoster
  for (const teamId of Object.keys(s.teams).sort()) {
    const team = s.teams[teamId]
    if (!team || team.userControlled) continue
    const keepSet = realOpeningDayRoster(s, ctx, teamId)

    let guard = 0
    while ((s.teams[teamId]?.roster.length ?? 0) > max && guard++ < 200) {
      const roster = s.teams[teamId]!.roster
      const cutId = cutOrderBySize(s, roster, keepSet)[0]
      if (cutId === undefined) break
      s = releaseFrom(s, teamId, cutId, ctx, { diverge: false })
    }

    guard = 0
    while (payroll(s, teamId) > capFor(s.season, ctx) && (s.teams[teamId]?.roster.length ?? 0) > min && guard++ < 200) {
      const roster = s.teams[teamId]!.roster
      const cutId = cutOrderByCap(s, roster, keepSet)[0]
      if (cutId === undefined) break
      s = releaseFrom(s, teamId, cutId, ctx, { diverge: false })
    }
  }
  return s
}

function rolloverContracts(state: LeagueState, _ctx: EngineContext): { state: LeagueState; expiring: Record<TeamId, PlayerId[]> } {
  let teams = state.teams
  let freeAgents = state.freeAgents
  const expiring: Record<TeamId, PlayerId[]> = {}
  for (const teamId of Object.keys(teams).sort()) {
    const team = teams[teamId]!
    const kept: RosterSlot[] = []
    const exp: PlayerId[] = []
    for (const slot of team.roster) {
      const years = slot.contract.years - 1
      if (years <= 0) exp.push(slot.playerId)
      else kept.push({ ...slot, contract: { ...slot.contract, years } })
    }
    if (exp.length) expiring[teamId] = exp.sort()
    teams = { ...teams, [teamId]: { ...team, roster: kept, deadMoney: 0 } }
    freeAgents = [...freeAgents, ...exp]
  }
  return { state: { ...state, teams, freeAgents: [...new Set(freeAgents)].sort() }, expiring }
}

// -------------------------------------------------------------------------------------------
// Module
// -------------------------------------------------------------------------------------------

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
  validateRoster,
  rolloverContracts,
}
