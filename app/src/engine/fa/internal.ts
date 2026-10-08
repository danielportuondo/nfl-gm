/**
 * Shared helpers between index.ts and cutdown.ts (cap math, roster limits, cut-eligibility, and the
 * release primitive). Factored out so suggestCutdown can simulate cumulative releases exactly as
 * fa.release would book them, without a circular import between the two files.
 */
import {
  STARTER_TEMPLATE,
  isOpeningOffseason,
  type Contract,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Position,
  type RosterSlot,
  type Season,
  type TeamId,
} from '@contracts/index'
import { faConstants } from './constants'

export const round2 = (x: number): number => Math.round(x * 100) / 100

function lastRealCapSeason(ctx: EngineContext): Season {
  return Math.max(...Object.keys(ctx.data.cap.bySeason).map(Number))
}

export function capFor(season: Season, ctx: EngineContext): number {
  const table = ctx.data.cap.bySeason
  const exact = table[String(season)]
  if (exact !== undefined) return exact
  const seasons = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)
  const first = seasons[0]!
  // Rookie deals for players drafted before the table (a 2007 first-rounder on a 2010 roster) price
  // off the earliest known cap, never the latest one.
  if (season < first) return table[String(first)]!
  const last = lastRealCapSeason(ctx)
  const base = table[String(last)]!
  return base * Math.pow(1 + ctx.data.cap.growthAfterData, season - last)
}

export function payroll(state: LeagueState, teamId: TeamId): number {
  const team = state.teams[teamId]
  if (!team) return 0
  return team.roster.reduce((sum, slot) => sum + slot.contract.apy, 0) + team.deadMoney
}

export function capGatedPhase(state: LeagueState): boolean {
  return state.phase === 'PRESEASON' || state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
}

/** Game-legal size applies from PRESEASON through the playoffs; offseason phases allow up to 90. */
export function rosterLimits(state: LeagueState): { min: number; max: number } {
  return capGatedPhase(state)
    ? faConstants.gameRoster
    : { min: 0, max: faConstants.offseasonRosterMax }
}

function starterCounts(
  state: LeagueState,
  roster: readonly RosterSlot[],
): Partial<Record<Position, number>> {
  const counts: Partial<Record<Position, number>> = {}
  for (const slot of roster) {
    const pos = state.players[slot.playerId]?.pos
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

/** Slots that can legally be cut without dropping a position below its STARTER_TEMPLATE minimum. */
export function cutCandidates(state: LeagueState, roster: readonly RosterSlot[]): RosterSlot[] {
  const counts = starterCounts(state, roster)
  return roster.filter((slot) => {
    const pos = state.players[slot.playerId]?.pos
    return pos !== undefined && (counts[pos] ?? 0) > (STARTER_TEMPLATE[pos] ?? 0)
  })
}

/** Dead money for `seasons` seasons left on a deal: the guaranteed remainder, scaled by `deadMoneyPct`. */
export function deadChargeFor(contract: Contract, seasons: number = contract.years): number {
  return round2(contract.apy * seasons * contract.guaranteedPct * faConstants.deadMoneyPct)
}

/**
 * What releasing `contract` costs right now. After the season closes the closed season is already
 * paid, so only the seasons still to play count (a deal that expires at the camp roll costs nothing).
 */
export function releaseCharge(state: LeagueState, contract: Contract): number {
  return deadChargeFor(contract, Math.max(0, seasonsLeft(state, contract)))
}

/**
 * Dead money applies to every release; divergence only to the user's (§6.8) — an AI team trimming its
 * camp roster is still on the historical path, and snapToHistory must stay free to place those players.
 * suggestCutdown also uses this (with diverge: false) so its simulated numbers match a real release.
 */
export function releaseFrom(
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
  const deadCharge = releaseCharge(state, slot.contract)
  const roster = team.roster.filter((r) => r.playerId !== playerId)
  // Cut after the season closes, the charge belongs to the next league year: it must outlive the camp
  // roll, which only clears the season just played.
  const books = isOffseasonPhase(state)
    ? { carriedDeadMoney: round2((team.carriedDeadMoney ?? 0) + deadCharge) }
    : { deadMoney: round2(team.deadMoney + deadCharge) }
  let s: LeagueState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: { ...team, roster, ...books },
    },
    freeAgents: [...state.freeAgents, playerId].sort(),
  }
  if (opts.diverge) s = ctx.modules.history.markDiverged(s, [playerId])
  return s
}

/**
 * Contract-length semantics: `years` is the number of seasons the player will actually play under the
 * deal. A deal made after a season closes is stamped `signedSeason` = the season it starts (state.season
 * + 1), which is how the camp rollover (rolloverContracts) knows not to tick it for the season just
 * played; deals from before the offseason still count that closed season until the rollover.
 */
const OFFSEASON_PHASES: ReadonlySet<LeagueState['phase']> = new Set([
  'OFFSEASON_RESIGN',
  'DRAFT',
  'UDFA',
  'FREE_AGENCY',
  'TRAINING_CAMP',
])

export function isOffseasonPhase(state: LeagueState): boolean {
  return OFFSEASON_PHASES.has(state.phase)
}

/** A deal signed during the offseason starts next season, so it is stamped with that season. */
export function stampOffseasonDeal(state: LeagueState, contract: Contract): Contract {
  return isOffseasonPhase(state) ? { ...contract, signedSeason: state.season + 1 } : contract
}

/** True while `contract` still counts a season that has already been played (before the camp rollover). */
function countsClosedSeason(state: LeagueState, contract: Contract): boolean {
  return (
    isOffseasonPhase(state) && !isOpeningOffseason(state) && contract.signedSeason <= state.season
  )
}

/** Seasons the player will still play under `contract`, as of now. */
export function seasonsLeft(state: LeagueState, contract: Contract): number {
  return contract.years - (countsClosedSeason(state, contract) ? 1 : 0)
}

/** In the re-signing window: the deal's last season has been played and it has not been renewed. */
export function isExpiringDeal(state: LeagueState, contract: Contract): boolean {
  return contract.years <= 1 && countsClosedSeason(state, contract)
}

/**
 * What a signing is measured against. In season: this season's cap and full payroll. In the offseason:
 * next season's cap against the deals still on the books when it starts. Expiring deals leave at the
 * camp rollover and this season's dead money resets there, so neither counts; dead money carried from
 * offseason releases does.
 */
export interface CapGate {
  season: Season
  nextSeason: boolean
  cap: number
  payroll: number
  space: number
}

export function gateSeason(state: LeagueState): Season {
  return isOffseasonPhase(state) ? state.season + 1 : state.season
}

/**
 * Payroll the gate counts: the full payroll in season; in the offseason the deals that outlive the
 * rollover plus the dead money already carried onto next season's books.
 */
export function committedPayroll(state: LeagueState, teamId: TeamId): number {
  if (!isOffseasonPhase(state)) return payroll(state, teamId)
  const team = state.teams[teamId]
  const deals = (team?.roster ?? []).reduce(
    (sum, slot) => sum + (seasonsLeft(state, slot.contract) >= 1 ? slot.contract.apy : 0),
    0,
  )
  return deals + (team?.carriedDeadMoney ?? 0)
}

export function capGate(state: LeagueState, teamId: TeamId, ctx: EngineContext): CapGate {
  const season = gateSeason(state)
  const cap = capFor(season, ctx)
  const committed = committedPayroll(state, teamId)
  return {
    season,
    nextSeason: isOffseasonPhase(state),
    cap,
    payroll: committed,
    space: cap - committed,
  }
}

const MONEY_EPSILON = 1e-6

/** Rounded up to $0.1M, so a printed ask is never below the real one. */
export function roundUpTenth(m: number): number {
  return Math.ceil(m * 10 - MONEY_EPSILON) / 10
}

function roundDownTenth(m: number): number {
  return Math.floor(m * 10 + MONEY_EPSILON) / 10
}

function formatTenths(m: number): string {
  return m < 0 ? `-$${Math.abs(m).toFixed(1)}M` : `$${m.toFixed(1)}M`
}

/** Plain-words refusal for a signing that does not fit under the cap, or null when it fits. */
export function capRefusal(gate: CapGate, apy: number): string | null {
  if (apy <= gate.space + 1e-9) return null
  const when = gate.nextSeason ? ' next season' : ''
  return `Not enough cap room${when}: need ${formatTenths(roundUpTenth(apy))}, have ${formatTenths(roundDownTenth(gate.space))}`
}
