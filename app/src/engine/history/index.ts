/**
 * engine/history — PHASE 2 SCAFFOLD. fa-cap (3C) replaces this file per contracts/engine/history.ts and HANDOFF §6.8.
 *
 * Divergence bookkeeping is complete (it is a Set); snapToHistory keeps its NotImplementedError stub.
 */
import { historyStub, type HistoryModule } from '@contracts/index'

export const history: HistoryModule = {
  ...historyStub,
  markDiverged: (state, playerIds) =>
    playerIds.every((id) => state.divergence.has(id)) ? state : { ...state, divergence: new Set([...state.divergence, ...playerIds]) },
  isDiverged: (state, playerId) => state.divergence.has(playerId),
  snapLog: (state, season) => (season === undefined ? state.snapLog : state.snapLog.filter((e) => e.season === season)),
}
