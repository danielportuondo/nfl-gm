/**
 * Shared helpers between index.ts and cutdown.ts (cap math, roster limits, cut-eligibility, and the
 * release primitive). Factored out so suggestCutdown can simulate cumulative releases exactly as
 * fa.release would book them, without a circular import between the two files.
 */
import {
  STARTER_TEMPLATE,
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

/** Dead money a release books this season: the guaranteed remainder, scaled by `deadMoneyPct`. */
export function deadChargeFor(contract: Contract): number {
  return round2(contract.apy * contract.years * contract.guaranteedPct * faConstants.deadMoneyPct)
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
  const deadCharge = deadChargeFor(slot.contract)
  const roster = team.roster.filter((r) => r.playerId !== playerId)
  let s: LeagueState = {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: { ...team, roster, deadMoney: round2(team.deadMoney + deadCharge) },
    },
    freeAgents: [...state.freeAgents, playerId].sort(),
  }
  if (opts.diverge) s = ctx.modules.history.markDiverged(s, [playerId])
  return s
}
