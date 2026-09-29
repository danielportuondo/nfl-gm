/**
 * engine/trade — valuation, acceptance, AI offers (§6.5). Owned by trade-ai (3B).
 *
 * Values are computed from CONSENSUS (scouting) only. The AI never reads truth.
 */
import type { LeagueState, PickRef, PlayerId, TradeEvaluation, TradeProposal } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface TradeConstants {
  /** Margin as a fraction of valueOut per strictness (lenient −0.03, balanced 0.05, strict 0.15, ruthless 0.30). */
  marginByStrictness: Record<'lenient' | 'balanced' | 'strict' | 'ruthless', number>
  /**
   * Upper bound on the sigmoid scale. The effective scale is
   * clamp(scaleShareOfDeal × max(valueIn, valueOut), scaleMin, scale), so a lopsided deal between
   * low-value assets is as decisive as a big one (docs/DECISIONS.md 2026-09-28, amends HANDOFF §6.5).
   */
  scale: number
  /** Share of the larger side's value used as the sigmoid scale (0.2). */
  scaleShareOfDeal: number
  /** Lower bound on the effective sigmoid scale (1). */
  scaleMin: number
  /** Future-pick discount per year (0.85). */
  futurePickDiscount: number
  /** Max first-round picks the AI gives up in one deal (2). */
  maxFirstsPerDeal: number
  /** Annoyance added per declined lowball and its effect on margin. */
  annoyancePerLowball: number
  annoyanceMarginPerPoint: number
}

export interface TradeOutcome {
  accepted: boolean
  evaluation: TradeEvaluation
  /** When declined, the AI may ask for one more asset from the user's side. */
  counter: TradeProposal | null
  state: LeagueState
}

export interface TradeModule {
  constants: TradeConstants

  /** f(consensus.ovr, pot, age, pos, contract): steep above 80 ovr, youth+pot premium, age and cost discounts. */
  playerValue(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number

  /** Pick chart (Rich Hill–style exponential decay) × 0.85^yearsOut × owner-strength adjustment. */
  pickValue(state: LeagueState, pick: PickRef, ctx: EngineContext): number

  /**
   * Evaluate from the counterparty's (request.teamId) perspective. Hard gates → valid=false, p=0:
   * cap after trade, roster size 46–53 (offseason ≤90), >2 firsts, unknown assets. needAdj rewards
   * filling top-2 needs and penalizes saturated positions. Injured incoming players discounted.
   * Re-values players whose consensus dropped sharply this season. Pure.
   */
  evaluate(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): TradeEvaluation

  /**
   * How fair an AI-initiated proposal is to the user, by consensus value only: what the user gets
   * ÷ (gets + gives), in 0–1, 0.5 = even. No margin, strictness, need or annoyance. Drives the meter
   * on AI-initiated offers; the user's own proposals keep showing evaluate().p. Pure.
   */
  fairness(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): number

  /**
   * Roll against p. Accepted → execute. Declined → raise counterparty tradeAnnoyance and maybe counter.
   * AI-initiated proposals are always accepted by the AI (the bar shows fairness).
   */
  submit(state: LeagueState, proposal: TradeProposal, ctx: EngineContext, rng: Rng): TradeOutcome

  /**
   * Move players and picks; mark all involved players diverged (history.markDiverged). Pure.
   * When the user's team is one side, appends a TRADE Transaction to state.transactions (gave = the
   * user's side, got = the other team's, ovrAtMove from state.scouting before the move).
   */
  execute(state: LeagueState, proposal: TradeProposal, ctx: EngineContext): LeagueState

  /**
   * AI-initiated offers to the user: 0–3 in the draft when the user is on the clock (teams whose top
   * need matches the best available prospect), and per settings.aiOfferFrequency in-season. Each has
   * the AI's own p ≥ 0.5 and value within a plausible band.
   */
  generateAiOffers(
    state: LeagueState,
    ctx: EngineContext,
    rng: Rng,
    context: 'draft' | 'season',
  ): TradeProposal[]

  /**
   * Proactive suggestions for the user (Phase 6): AI-initiated deals that send the user a player at one
   * of their top consensus needs from a team that is not short there, priced so the AI's own p ≥ 0.5
   * and the user's side sits inside the plausibility band. AI-initiated, so accepting one always
   * executes while its assets are still in place. Consensus only — never reads truth.
   */
  suggestTrades(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[]
}

export const tradeStub: TradeModule = {
  constants: {
    marginByStrictness: { lenient: -0.03, balanced: 0.05, strict: 0.15, ruthless: 0.3 },
    scale: 12,
    scaleShareOfDeal: 0.2,
    scaleMin: 1,
    futurePickDiscount: 0.85,
    maxFirstsPerDeal: 2,
    annoyancePerLowball: 1,
    annoyanceMarginPerPoint: 0.02,
  },
  playerValue: () => notImplemented('trade.playerValue'),
  pickValue: () => notImplemented('trade.pickValue'),
  evaluate: () => notImplemented('trade.evaluate'),
  fairness: () => notImplemented('trade.fairness'),
  submit: () => notImplemented('trade.submit'),
  execute: () => notImplemented('trade.execute'),
  generateAiOffers: () => notImplemented('trade.generateAiOffers'),
  suggestTrades: () => notImplemented('trade.suggestTrades'),
}
