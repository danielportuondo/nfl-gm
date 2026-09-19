/**
 * engine/fa — free agency, contracts, cap (§6.6). Owned by fa-cap (3C).
 */
import type { Contract, LeagueState, PlayerId, RosterValidation, Season, TeamId } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface FaModule {
  /** Cap in $M for a season: real table, then growthAfterData compounding beyond the last real season. */
  capFor(season: Season, ctx: EngineContext): number

  /** Sum of roster apy + deadMoney. */
  payroll(state: LeagueState, teamId: TeamId): number
  capSpace(state: LeagueState, teamId: TeamId, ctx: EngineContext): number

  /** capPct(pos, consensus.ovr, age) × cap, fit to APY-at-position percentiles. Min ≈ 0.3% of cap. */
  marketApy(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** 4 years, apy from slot table (fit to real rookie scale % of cap); UDFA = minimum, 3 years. */
  rookieContract(
    pick: { round: number; pick: number } | null,
    season: Season,
    ctx: EngineContext,
  ): Contract

  /** Veteran contract synthesized from market apy; length by age (younger → longer, max 5). */
  synthesizeContract(
    state: LeagueState,
    playerId: PlayerId,
    season: Season,
    ctx: EngineContext,
    hint?: { apy?: number; years?: number },
  ): Contract

  /** Expiring players' asks for the OFFSEASON_RESIGN phase: marketApy × (1 ± 10%), seeded per player. */
  resignAsk(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** User re-signs at `apy` ≥ ask. Throws if below ask or over cap. */
  resign(
    state: LeagueState,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
  ): LeagueState

  /** AI teams re-sign: history-anchored when the player is on their real next-season roster, else by value/need under cap. Unsigned → freeAgents. */
  runAiResign(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /** Unsigned players, sorted by consensus ovr desc. */
  freeAgentPool(state: LeagueState): PlayerId[]

  /**
   * User offer with 1-day simulated bidding: P(accept) rises with offer/ask and team quality.
   * Hard gates: cap, roster ≤ 90 (offseason) / 53 (in-season). Marks the player diverged on success.
   */
  offer(
    state: LeagueState,
    teamId: TeamId,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
    rng: Rng,
  ): { accepted: boolean; state: LeagueState }

  /** P(accept) the offer would face before any hard gate (cap, roster size); pure, for UI previews. */
  offerOdds(
    state: LeagueState,
    teamId: TeamId,
    playerId: PlayerId,
    contract: Contract,
    ctx: EngineContext,
  ): number

  /** AI signings: history-anchored (real team for that season) with value/need fallback under cap. */
  runAiFreeAgency(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState

  /**
   * PRESEASON → REGULAR: every AI team over 53 releases down to 53 (release() dead-money rules), keeping
   * STARTER_TEMPLATE minimums; in history prefer the players on the real opening-day roster
   * (seasonData(season).rosters), otherwise cut lowest consensus value first. The user's team is left
   * alone — league.advancePhase throws if it is still over 53. Called by league before validateRoster.
   */
  runAiCutdowns(state: LeagueState, ctx: EngineContext): LeagueState

  /** Release: dead money = 25% of remaining guaranteed apy × years, charged this season. Marks diverged. */
  release(state: LeagueState, teamId: TeamId, playerId: PlayerId, ctx: EngineContext): LeagueState

  /** 46–53 to sim a game (≤90 in the offseason), under cap, ≥1 QB/K/P etc. per STARTER_TEMPLATE. */
  validateRoster(state: LeagueState, teamId: TeamId, ctx: EngineContext): RosterValidation

  /** Decrement contract years at season rollover; expiring → returned for the re-sign phase. */
  rolloverContracts(
    state: LeagueState,
    ctx: EngineContext,
  ): { state: LeagueState; expiring: Record<TeamId, PlayerId[]> }
}

export const faStub: FaModule = {
  capFor: () => notImplemented('fa.capFor'),
  payroll: () => notImplemented('fa.payroll'),
  capSpace: () => notImplemented('fa.capSpace'),
  marketApy: () => notImplemented('fa.marketApy'),
  rookieContract: () => notImplemented('fa.rookieContract'),
  synthesizeContract: () => notImplemented('fa.synthesizeContract'),
  resignAsk: () => notImplemented('fa.resignAsk'),
  resign: () => notImplemented('fa.resign'),
  runAiResign: () => notImplemented('fa.runAiResign'),
  freeAgentPool: () => notImplemented('fa.freeAgentPool'),
  offer: () => notImplemented('fa.offer'),
  offerOdds: () => notImplemented('fa.offerOdds'),
  runAiFreeAgency: () => notImplemented('fa.runAiFreeAgency'),
  runAiCutdowns: () => notImplemented('fa.runAiCutdowns'),
  release: () => notImplemented('fa.release'),
  validateRoster: () => notImplemented('fa.validateRoster'),
  rolloverContracts: () => notImplemented('fa.rolloverContracts'),
}
