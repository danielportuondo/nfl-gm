/**
 * engine/draft — draft order, AI picking, draft-room state machine, UDFA (§6.4). Owned by draft-ai (3A).
 *
 * The AI NEVER reads `state.truth`. It ranks by `state.scouting[id].pot` and need. Enforced by lint.
 *
 * Draft-year convention: the draft held in season S's DRAFT phase (before TRAINING_CAMP increments the
 * season) is the S+1 class. `DraftPick.season`, `draftRoom.season` and the chunk read by loadProspects /
 * buildDraftOrder are all S+1; `league.newGame(S)` owns picks for S+1 and S+2 (the next two drafts).
 */
import type {
  DraftPick,
  DraftRoomState,
  LeagueState,
  NeedProfile,
  PlayerId,
  Season,
  TeamId,
  TradeProposal,
} from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface DraftModule {
  /**
   * Picks for `season`: in history, the real order from the season chunk (comp/traded picks as they
   * happened), with owner overridden by in-game trades already recorded in state.picks. Post-history:
   * reverse standings with playoff ordering, 7 rounds × 32, no comp picks.
   */
  buildDraftOrder(state: LeagueState, season: Season, ctx: EngineContext): DraftPick[]

  /**
   * Add the season's prospects to state.players/scouting (and truth from trajectories when real),
   * returning the new state. In history: real class + real UDFAs from the chunk. Post-history:
   * lifecycle.generateDraftClass.
   */
  loadProspects(state: LeagueState, ctx: EngineContext): LeagueState

  /** Enter DRAFT phase: state.draftRoom = ON_CLOCK at pick index 0, board sorted by consensus pot. */
  startDraft(state: LeagueState, ctx: EngineContext): LeagueState

  /**
   * AI selection for the team on the clock:
   *  1. If the historical pick at this slot is available and the team is not saturated there, take them.
   *  2. Else best of `pot × needWeight(pos) × ageAdj` + small seeded noise; 10% of the time ignore need.
   */
  aiPick(state: LeagueState, ctx: EngineContext, rng: Rng): PlayerId

  /**
   * User selection while on the clock. Throws if not the user's pick or player unavailable. Needs ctx for
   * the rookie contract (fa.rookieContract) and the divergence mark (history.markDiverged).
   */
  userPick(state: LeagueState, playerId: PlayerId, ctx: EngineContext): LeagueState

  /**
   * Resolve the current pick (AI: aiPick; user: must have picked or auto-picks best available when
   * `auto`), log it, advance to the next pick; when the user comes on the clock, populate
   * draftRoom.pendingOffers via trade.generateAiOffers(…, 'draft'). Runs consecutive AI picks until
   * the user is on the clock or the draft is COMPLETE. Returns the new state.
   */
  advance(state: LeagueState, ctx: EngineContext, opts?: { auto?: boolean }): LeagueState

  /** Sim the rest of the draft with the user auto-picking; convenience for headless/tests. */
  autoDraftToEnd(state: LeagueState, ctx: EngineContext): LeagueState

  /**
   * UDFA phase: user signings applied first (up to 90 roster), then AI teams sign from the pool using
   * the same anchored logic (real UDFA team when known). Clears draftRoom, moves unsigned to freeAgents.
   */
  runUdfa(state: LeagueState, ctx: EngineContext, userSignings: PlayerId[]): LeagueState

  /** Need profile vs STARTER_TEMPLATE and starter quality. Uses consensus only. */
  teamNeeds(state: LeagueState, teamId: TeamId): NeedProfile

  /** Offers targeted at the user's current pick; convenience over trade.generateAiOffers. */
  offersForCurrentPick(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[]

  /** Read-only view of the room for the UI. */
  room(state: LeagueState): DraftRoomState | null
}

export const draftStub: DraftModule = {
  buildDraftOrder: () => notImplemented('draft.buildDraftOrder'),
  loadProspects: () => notImplemented('draft.loadProspects'),
  startDraft: () => notImplemented('draft.startDraft'),
  aiPick: () => notImplemented('draft.aiPick'),
  userPick: () => notImplemented('draft.userPick'),
  advance: () => notImplemented('draft.advance'),
  autoDraftToEnd: () => notImplemented('draft.autoDraftToEnd'),
  runUdfa: () => notImplemented('draft.runUdfa'),
  teamNeeds: () => notImplemented('draft.teamNeeds'),
  offersForCurrentPick: () => notImplemented('draft.offersForCurrentPick'),
  room: () => notImplemented('draft.room'),
}
