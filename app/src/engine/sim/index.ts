/**
 * engine/sim — game simulation + box scores (HANDOFF §6.3).
 *
 * Pure per-game functions; the league module applies results to state. Sim reads `state.truth` for
 * team strength — that is the hindsight model: games are decided by who players really are.
 */
import type {
  EngineContext,
  Game,
  GameResult,
  InjuryEvent,
  LeagueState,
  Rng,
  SimModule,
  TeamId,
} from '@contracts/index'
import { buildBoxScore, offenseTotals } from './boxScore'
import { simConstants } from './constants'
import { sampleInjuries } from './injuries'
import { drawScore, expectedMargin } from './score'
import { availableByPosition, computeTeamStrength, strengthFrom } from './strength'

export const sim: SimModule = {
  constants: simConstants,

  teamStrength(state: LeagueState, teamId: TeamId, _ctx: EngineContext) {
    return computeTeamStrength(state, teamId)
  },

  simulateGame(state: LeagueState, game: Game, ctx: EngineContext, rng: Rng): GameResult {
    const homeSquad = availableByPosition(state, game.home)
    const awaySquad = availableByPosition(state, game.away)
    const home = strengthFrom(state, homeSquad)
    const away = strengthFrom(state, awaySquad)

    const mu = expectedMargin(home.overall, away.overall, game.neutralSite === true)
    const score = drawScore(mu, game.season, rng.fork('score'))

    const boxRng = rng.fork('box')
    const homeTotals = offenseTotals(score.home, boxRng)
    const awayTotals = offenseTotals(score.away, boxRng)
    const box = buildBoxScore(
      state,
      { teamId: game.home, byPos: homeSquad, totals: homeTotals, takeaways: awayTotals.passInt },
      { teamId: game.away, byPos: awaySquad, totals: awayTotals, takeaways: homeTotals.passInt },
      boxRng,
    )

    const injuryRng = rng.fork('injuries')
    const injuries: InjuryEvent[] = [
      ...sampleInjuries(state, ctx, game.home, homeSquad, injuryRng),
      ...sampleInjuries(state, ctx, game.away, awaySquad, injuryRng),
    ]

    return {
      gameId: game.id,
      homeScore: score.home,
      awayScore: score.away,
      overtime: score.overtime,
      box,
      injuries,
    }
  },

  gameRng(state: LeagueState, game: Game, ctx: EngineContext): Rng {
    return ctx.modules.rng.fromSeed(state.seed, game.season, game.week, game.id)
  },
}

export { simConstants } from './constants'
export { apportion } from './boxScore'
export {
  availableByPosition,
  computeTeamStrength,
  resetTruthFallbackCount,
  truthFallbackCount,
  trueValue,
} from './strength'
export { drawScore, expectedMargin, isPlausibleScore } from './score'
export { sampleInjuries } from './injuries'
