/**
 * fa.suggestCutdown (contracts/engine/fa.ts doc comment; docs/DECISIONS.md 2026-09-20). Pure,
 * deterministic cutdown suggestion: size first (lowest consensus ovr), then cap (most net savings per
 * rating point above 40). Consensus and contracts only — no history anchoring, no truth. Simulates
 * cumulatively via the shared releaseFrom (diverge: false) so the reported numbers match exactly what
 * fa.release would book, without actually diverging or mutating the caller's state.
 */
import type {
  CutdownPlan,
  CutdownSuggestion,
  EngineContext,
  LeagueState,
  PlayerId,
  RosterSlot,
  TeamId,
} from '@contracts/index'
import {
  capFor,
  cutCandidates,
  deadChargeFor,
  payroll,
  releaseFrom,
  rosterLimits,
} from './internal'

function byPlayerId(a: PlayerId, b: PlayerId): number {
  return a.localeCompare(b)
}

function eligible(
  state: LeagueState,
  roster: readonly RosterSlot[],
  excluded: ReadonlySet<PlayerId>,
): RosterSlot[] {
  return cutCandidates(state, roster).filter((slot) => !excluded.has(slot.playerId))
}

/** Lowest consensus ovr first; ties broken by playerId. */
function lowestOvrCandidate(
  state: LeagueState,
  roster: readonly RosterSlot[],
  excluded: ReadonlySet<PlayerId>,
): PlayerId | undefined {
  const candidates = eligible(state, roster, excluded).sort((a, b) => {
    const diff = (state.scouting[a.playerId]?.ovr ?? 40) - (state.scouting[b.playerId]?.ovr ?? 40)
    return diff !== 0 ? diff : byPlayerId(a.playerId, b.playerId)
  })
  return candidates[0]?.playerId
}

/** Highest netSavings / max(1, ovr - 40) among candidates that actually save money; ties by playerId. */
function bestCapCandidate(
  state: LeagueState,
  roster: readonly RosterSlot[],
  excluded: ReadonlySet<PlayerId>,
): PlayerId | undefined {
  let best: { playerId: PlayerId; ratio: number } | undefined
  for (const slot of eligible(state, roster, excluded)) {
    const netSavings = slot.contract.apy - deadChargeFor(slot.contract)
    if (netSavings <= 0) continue
    const ovr = state.scouting[slot.playerId]?.ovr ?? 40
    const ratio = netSavings / Math.max(1, ovr - 40)
    if (
      !best ||
      ratio > best.ratio ||
      (ratio === best.ratio && byPlayerId(slot.playerId, best.playerId) < 0)
    ) {
      best = { playerId: slot.playerId, ratio }
    }
  }
  return best?.playerId
}

function cutOne(
  working: LeagueState,
  teamId: TeamId,
  playerId: PlayerId,
  ctx: EngineContext,
  reason: CutdownSuggestion['reason'],
): { state: LeagueState; suggestion: CutdownSuggestion } {
  const slot = working.teams[teamId]!.roster.find((r) => r.playerId === playerId)!
  const deadMoney = deadChargeFor(slot.contract)
  const netSavings = slot.contract.apy - deadMoney
  const state = releaseFrom(working, teamId, playerId, ctx, { diverge: false })
  return { state, suggestion: { playerId, reason, deadMoney, netSavings } }
}

export function suggestCutdown(
  state: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  protect: readonly PlayerId[] = [],
): CutdownPlan {
  const team = state.teams[teamId]
  if (!team) throw new Error(`fa.suggestCutdown: unknown team "${teamId}"`)
  const protectSet = new Set(protect)
  const { min, max } = rosterLimits(state)
  const cap = capFor(state.season, ctx)

  let working = state
  const cuts: CutdownSuggestion[] = []

  let guard = 0
  while ((working.teams[teamId]?.roster.length ?? 0) > max && guard++ < 1000) {
    const playerId = lowestOvrCandidate(working, working.teams[teamId]!.roster, protectSet)
    if (playerId === undefined) break
    const cut = cutOne(working, teamId, playerId, ctx, 'size')
    working = cut.state
    cuts.push(cut.suggestion)
  }

  guard = 0
  while (
    payroll(working, teamId) > cap &&
    (working.teams[teamId]?.roster.length ?? 0) > min &&
    guard++ < 1000
  ) {
    const playerId = bestCapCandidate(working, working.teams[teamId]!.roster, protectSet)
    if (playerId === undefined) break
    const cut = cutOne(working, teamId, playerId, ctx, 'cap')
    working = cut.state
    cuts.push(cut.suggestion)
  }

  const sizeAfter = working.teams[teamId]?.roster.length ?? 0
  const payrollAfter = payroll(working, teamId)
  return {
    cuts,
    sizeAfter,
    payrollAfter,
    capSpaceAfter: cap - payrollAfter,
    ok: sizeAfter <= max && payrollAfter <= cap,
  }
}
