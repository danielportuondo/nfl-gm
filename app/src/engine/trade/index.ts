/**
 * engine/trade — PHASE 2 SCAFFOLD. trade-ai (3B) replaces this file per contracts/engine/trade.ts and HANDOFF §6.5.
 *
 * league.simWeek asks for AI-initiated offers every week; until the trade AI exists there are none.
 * Everything else keeps its NotImplementedError stub.
 */
import { tradeStub, type TradeModule } from '@contracts/index'

export const trade: TradeModule = {
  ...tradeStub,
  generateAiOffers: () => [],
}
