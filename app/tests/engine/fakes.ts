/**
 * Minimal deterministic fakes for sim/draft/trade/fa/lifecycle/history, for engine tests written before
 * those modules exist (docs/HANDOFF.md; league-engine brief). Never throw "not implemented" — every
 * method is a cheap, deterministic passthrough so league tests can drive full season loops.
 *
 * `sim` is the one fake with real behavior: a seeded coin-flip game so results and injuries vary.
 * Everything else is a no-op passthrough (return state unchanged / empty collections).
 */
import {
  POSITIONS,
  TEAM_IDS,
  type DraftModule,
  type DraftPick,
  type EngineContext,
  type EngineModules,
  type FaModule,
  type HistoryModule,
  type LifecycleModule,
  type MemoryBundle,
  type NeedProfile,
  type Position,
  type Season,
  type SimModule,
  type TradeModule,
} from '@contracts/index'
import { rng } from '@engine/rng'
import { league } from '@engine/league'

// --- sim: seeded coin-flip games ------------------------------------------------------------

export const fakeSim: SimModule = {
  constants: {
    k: 0.9,
    hfa: 2.0,
    marginSd: 13.5,
    totalMean: 45,
    totalSd: 10,
    tieP: 0,
    offenseWeights: { QB: 0.35, OL: 0.25, WRTE: 0.25, RB: 0.15 },
    defenseWeights: { DL: 0.3, LB: 0.2, CB: 0.3, S: 0.2 },
    stWeight: 0.05,
    benchFactor: 0.15,
  },
  teamStrength: () => ({ off: 70, def: 70, st: 70, overall: 70 }),
  gameRng: (state, game) => rng.fromSeed(state.seed, state.season, state.week, game.id),
  simulateGame: (_state, game, _ctx, r) => {
    const homeWin = r.chance(0.5)
    return {
      gameId: game.id,
      homeScore: homeWin ? 24 : 17,
      awayScore: homeWin ? 17 : 24,
      overtime: false,
      injuries: [],
    }
  },
}

// --- draft: enough structure to complete a headless draft phase -----------------------------

export const fakeDraft: DraftModule = {
  buildDraftOrder: (_state, season) => {
    const picks: DraftPick[] = []
    for (let round = 1; round <= 7; round++) {
      TEAM_IDS.forEach((teamId, i) => {
        picks.push({
          season,
          round,
          pick: (round - 1) * 32 + i + 1,
          originalTeam: teamId,
          owner: teamId,
          playerId: null,
        })
      })
    }
    return picks
  },
  loadProspects: (state) => state,
  startDraft: (state, ctx) => {
    // Draft-year convention: season S's DRAFT phase drafts the S+1 class (contracts/engine/draft.ts).
    const season = state.season + 1
    const sd = ctx.seasonData(season)
    const available = sd ? sd.draft.prospects.map((p) => p.id) : []
    return {
      ...state,
      draftRoom: {
        season,
        status: 'ON_CLOCK',
        currentPickIndex: 0,
        order: fakeDraft.buildDraftOrder(state, season, ctx),
        available,
        udfaPool: sd?.draft.udfa ?? [],
        log: [],
        pendingOffers: [],
      },
    }
  },
  aiPick: (state) => {
    const available = state.draftRoom?.available ?? []
    const id = available[0]
    if (!id) throw new Error('fakeDraft.aiPick: no players available')
    return id
  },
  userPick: (state) => state,
  advance: (state) => state,
  autoDraftToEnd: (state) => {
    if (!state.draftRoom) return state
    return {
      ...state,
      draftRoom: {
        ...state.draftRoom,
        status: 'COMPLETE',
        currentPickIndex: state.draftRoom.order.length,
      },
    }
  },
  runUdfa: (state) => ({ ...state, draftRoom: null }),
  teamNeeds: (): NeedProfile => ({
    byPos: Object.fromEntries(POSITIONS.map((p) => [p, 0])) as Record<Position, number>,
    top: [],
    saturated: [],
  }),
  offersForCurrentPick: () => [],
  room: (state) => state.draftRoom,
}

// --- trade: valuation/acceptance are no-ops --------------------------------------------------

export const fakeTrade: TradeModule = {
  constants: {
    marginByStrictness: { lenient: -0.03, balanced: 0.05, strict: 0.15, ruthless: 0.3 },
    scale: 12,
    futurePickDiscount: 0.85,
    maxFirstsPerDeal: 2,
    annoyancePerLowball: 1,
    annoyanceMarginPerPoint: 0.02,
  },
  playerValue: () => 0,
  pickValue: () => 0,
  evaluate: () => ({
    valueIn: 0,
    valueOut: 0,
    needAdj: 0,
    margin: 0,
    p: 0,
    valid: false,
    reasons: [],
  }),
  submit: (state, proposal, ctx, _r) => ({
    accepted: false,
    evaluation: fakeTrade.evaluate(state, proposal, ctx),
    counter: null,
    state,
  }),
  execute: (state) => state,
  generateAiOffers: () => [],
  suggestTrades: () => [],
}

// --- fa: flat contracts, passthrough cap/roster bookkeeping ----------------------------------

const FLAT_APY = 1
const FLAT_YEARS = 3

export const fakeFa: FaModule = {
  capFor: (season, ctx) => ctx.data.cap.bySeason[String(season)] ?? 200,
  payroll: (state, teamId) =>
    (state.teams[teamId]?.roster ?? []).reduce((sum, r) => sum + r.contract.apy, 0),
  capSpace: (state, teamId, ctx) =>
    fakeFa.capFor(state.season, ctx) -
    fakeFa.payroll(state, teamId) -
    (state.teams[teamId]?.deadMoney ?? 0),
  marketApy: () => FLAT_APY,
  rookieContract: (_pick, season) => ({
    years: 4,
    apy: FLAT_APY,
    guaranteedPct: 1,
    signedSeason: season,
    rookie: true,
  }),
  synthesizeContract: (_state, _playerId, season, _ctx, hint) => ({
    years: hint?.years ?? FLAT_YEARS,
    apy: hint?.apy ?? FLAT_APY,
    guaranteedPct: 0.5,
    signedSeason: season,
    rookie: false,
  }),
  resignAsk: () => FLAT_APY,
  resign: (state) => state,
  runAiResign: (state) => state,
  freeAgentPool: (state) => state.freeAgents,
  offer: (state) => ({ accepted: true, state }),
  offerOdds: () => 1,
  runAiFreeAgency: (state) => state,
  runAiCutdowns: (state) => state,
  release: (state) => state,
  validateRoster: (state, teamId) => ({
    ok: true,
    size: state.teams[teamId]?.roster.length ?? 0,
    payroll: fakeFa.payroll(state, teamId),
    capSpace: 0,
    errors: [],
  }),
  rolloverContracts: (state) => ({ state, expiring: {} }),
}

// --- lifecycle: no aging/retirement/injury churn ----------------------------------------------

export const fakeLifecycle: LifecycleModule = {
  progressSeason: (state) => state,
  retirements: (state) => ({ state, retired: [] }),
  refreshScouting: (state) => state,
  tickInjuries: (state) => state,
  applyInjuryEvents: (state) => state,
  generateDraftClass: () => ({ prospects: [], truth: {}, order: [], draftedCount: 0 }),
  age: (state, playerId, season) =>
    (season ?? state.season) - (state.players[playerId]?.birthYear ?? 0),
}

// --- history: no anchoring ---------------------------------------------------------------------

export const fakeHistory: HistoryModule = {
  snapToHistory: (state) => state,
  markDiverged: (state, playerIds) => ({
    ...state,
    divergence: new Set([...state.divergence, ...playerIds]),
  }),
  isDiverged: (state, playerId) => state.divergence.has(playerId),
  snapLog: (state, season) =>
    season === undefined ? state.snapLog : state.snapLog.filter((e) => e.season === season),
}

/** Real `rng` and real `league` (the module under test), fakes for everything else. */
export function makeFakeModules(overrides: Partial<EngineModules> = {}): EngineModules {
  return {
    rng,
    league,
    sim: fakeSim,
    draft: fakeDraft,
    trade: fakeTrade,
    fa: fakeFa,
    lifecycle: fakeLifecycle,
    history: fakeHistory,
    ...overrides,
  }
}

/** EngineContext over a MemoryBundle, with fakes for every module but rng/league. */
export function makeFakeContext(
  bundle: MemoryBundle,
  overrides: Partial<EngineModules> = {},
): EngineContext {
  return {
    data: bundle.static,
    trajectories: bundle.trajectories,
    seasonData: (season: Season) => bundle.seasons[season],
    modules: makeFakeModules(overrides),
  }
}
