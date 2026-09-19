/**
 * engine/sim — game simulation + box scores (§6.3). Owned by sim-engine (1D).
 *
 * Pure per-game functions. The league module applies results to state. Sim reads `state.truth`
 * (current-season true values) for strength — that is the point of the hindsight model: games are
 * decided by who players really are, not by what scouts think.
 */
import type { Game, GameResult, LeagueState, TeamId, TeamStrength } from '../types'
import type { EngineContext } from './context'
import { notImplemented } from './context'
import type { Rng } from './rng'

export interface SimConstants {
  /** Points of expected margin per point of overall-rating difference. Calibrated so sd(wins) ≈ 3.0 over 17 games. */
  k: number
  /** Home-field advantage in points (≈2.0). */
  hfa: number
  /** σ of the game margin (≈13.5). */
  marginSd: number
  /** Mean and σ of total points (≈45, 10). */
  totalMean: number
  totalSd: number
  /** Probability a game inside the OT window ends tied (era-dependent, small). */
  tieP: number
  offenseWeights: { QB: number; OL: number; WRTE: number; RB: number }
  defenseWeights: { DL: number; LB: number; CB: number; S: number }
  stWeight: number
  /** How much bench quality matters (0–1). */
  benchFactor: number
}

export interface SimModule {
  /** Tunable constants; qa-balance (Phase 5) may edit the values file, not the shape. */
  constants: SimConstants

  /**
   * Strength from the team's depth chart using TRUE current-season values (state.truth[id].bySeason[season]),
   * excluding injured players; falls back to league.autoDepthChart when the chart is missing slots.
   * offense: QB ~0.35, OL(5) ~0.25, WR/TE ~0.25, RB ~0.15; defense: DL/LB/CB/S ~equal with edge for
   * pass rush and CB; special teams small. Returns 40–99-scale numbers.
   */
  teamStrength(state: LeagueState, teamId: TeamId, ctx: EngineContext): TeamStrength

  /**
   * Simulate one game. margin ~ N(k·(home − away) + HFA, σ); total ~ N(45, 10) clipped; scores snapped
   * to realistic football scores; OT/ties per era. Box score allocated by usage weights. Injury events
   * sampled from ctx.data.injuryModel when settings.injuries. All randomness from `rng`.
   */
  simulateGame(state: LeagueState, game: Game, ctx: EngineContext, rng: Rng): GameResult

  /** Rng scope convention so league and calibration agree: rng.fromSeed(seed, season, week, game.id). */
  gameRng(state: LeagueState, game: Game, ctx: EngineContext): Rng
}

export const simStub: SimModule = {
  constants: {
    k: 0.9,
    hfa: 2.0,
    marginSd: 13.5,
    totalMean: 45,
    totalSd: 10,
    tieP: 0.003,
    offenseWeights: { QB: 0.35, OL: 0.25, WRTE: 0.25, RB: 0.15 },
    defenseWeights: { DL: 0.3, LB: 0.2, CB: 0.3, S: 0.2 },
    stWeight: 0.05,
    benchFactor: 0.15,
  },
  teamStrength: () => notImplemented('sim.teamStrength'),
  simulateGame: () => notImplemented('sim.simulateGame'),
  gameRng: () => notImplemented('sim.gameRng'),
}
