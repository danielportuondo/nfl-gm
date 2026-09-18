/**
 * engine/fa — PHASE 2 SCAFFOLD. fa-cap (3C) replaces this file per contracts/engine/fa.ts and HANDOFF §6.6.
 *
 * Implements only what league.newGame, simWeek and advancePhase(PRESEASON) need to run on real data:
 * cap lookup, payroll, contract synthesis from roster hints, opening-day cutdowns and roster-size
 * validation. Everything else keeps its NotImplementedError stub so nothing mistakes this for the module.
 * Cap is reported, not enforced: the roster hints are APYs, not cap hits, so enforcement waits for 3C.
 */
import {
  STARTER_TEMPLATE, faStub,
  type Contract, type EngineContext, type FaModule, type LeagueState, type PlayerId, type Position,
  type RosterSlot, type RosterValidation, type Season, type TeamId,
} from '@contracts/index'
import { faConstants } from './constants'

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

function capPctFor(ovr: number): number {
  const { minCapPct, valueFloor, valueSpan, valueExp, topCapPct } = faConstants
  const x = Math.max(0, ovr - valueFloor) / valueSpan
  return Math.max(minCapPct, Math.pow(x, valueExp) * topCapPct)
}

function veteranYears(age: number): number {
  for (const band of faConstants.yearsByAge) if (age <= band.maxAge) return band.years
  return faConstants.defaultYears
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
  // The contracts data occasionally records a $0 APY; a hint has to be a real salary to be used.
  const apyHint = hint?.apy !== undefined && hint.apy > 0 ? hint.apy : undefined
  const yearsIn = season - player.rookieSeason
  const rookieDeal = player.draft !== null && yearsIn >= 0 && yearsIn < faConstants.rookieContractYears
  if (rookieDeal) {
    return {
      years: faConstants.rookieContractYears - yearsIn,
      apy: apyHint ?? Math.round(capPctFor(ovr) * capFor(season, ctx) * 100) / 100,
      guaranteedPct: 1,
      signedSeason: player.rookieSeason,
      rookie: true,
    }
  }
  const age = season - player.birthYear
  const years = Math.min(faConstants.maxYears, Math.max(1, hint?.years ?? veteranYears(age)))
  return {
    years,
    apy: apyHint ?? Math.round(capPctFor(ovr) * capFor(season, ctx) * 100) / 100,
    guaranteedPct: faConstants.veteranGuaranteedPct,
    signedSeason: season,
    rookie: false,
  }
}

function freeAgentPool(state: LeagueState): PlayerId[] {
  return [...state.freeAgents].sort(
    (a, b) => (state.scouting[b]?.ovr ?? 0) - (state.scouting[a]?.ovr ?? 0) || a.localeCompare(b),
  )
}

/** Game-legal size applies from PRESEASON (the gate into the season) through the playoffs. */
function rosterLimits(state: LeagueState): { min: number; max: number } {
  const gate = state.phase === 'PRESEASON' || state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
  return gate ? faConstants.gameRoster : { min: 0, max: faConstants.offseasonRosterMax }
}

function validateRoster(state: LeagueState, teamId: TeamId, ctx: EngineContext): RosterValidation {
  const team = state.teams[teamId]
  const size = team?.roster.length ?? 0
  const limits = rosterLimits(state)
  const errors: string[] = []
  if (!team) errors.push('unknown team')
  if (size < limits.min) errors.push(`roster has ${size} players; minimum is ${limits.min}`)
  if (size > limits.max) errors.push(`roster has ${size} players; maximum is ${limits.max}`)
  return { ok: errors.length === 0, size, payroll: payroll(state, teamId), capSpace: capSpace(state, teamId, ctx), errors }
}

/** Lowest consensus value first, never below the STARTER_TEMPLATE count at a position. */
function cutOrder(state: LeagueState, roster: readonly RosterSlot[]): PlayerId[] {
  const counts: Partial<Record<Position, number>> = {}
  for (const slot of roster) {
    const pos = state.players[slot.playerId]?.pos
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1
  }
  return roster
    .map((slot) => slot.playerId)
    .filter((id) => {
      const pos = state.players[id]?.pos
      return pos !== undefined && (counts[pos] ?? 0) > (STARTER_TEMPLATE[pos] ?? 0)
    })
    .sort((a, b) => (state.scouting[a]?.ovr ?? 0) - (state.scouting[b]?.ovr ?? 0) || a.localeCompare(b))
}

function runAiCutdowns(state: LeagueState, _ctx: EngineContext): LeagueState {
  const max = faConstants.gameRoster.max
  let teams = state.teams
  let freeAgents = state.freeAgents
  for (const teamId of Object.keys(teams).sort()) {
    const team = teams[teamId]!
    if (team.userControlled || team.roster.length <= max) continue
    const cuts = new Set(cutOrder(state, team.roster).slice(0, team.roster.length - max))
    const roster = team.roster.filter((slot) => !cuts.has(slot.playerId))
    teams = { ...teams, [teamId]: { ...team, roster } }
    freeAgents = [...freeAgents, ...[...cuts].sort()]
  }
  return teams === state.teams ? state : { ...state, teams, freeAgents }
}

export const fa: FaModule = {
  ...faStub,
  capFor,
  payroll,
  capSpace,
  synthesizeContract,
  freeAgentPool,
  validateRoster,
  runAiCutdowns,
}
