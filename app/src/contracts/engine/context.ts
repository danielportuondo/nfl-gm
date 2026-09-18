/**
 * Shared engine plumbing. ORCHESTRATOR-OWNED.
 *
 * Every engine module is a plain object of pure functions that take `LeagueState` and return a new
 * `LeagueState` (never mutate the input). Cross-module calls go through `ctx.modules` so modules can
 * be developed and tested against stubs, and so there are no import cycles between engine folders.
 */
import type { Season, SeasonData, StaticData, TrajectoryTable } from '../types'
import type { DraftModule } from './draft'
import type { FaModule } from './fa'
import type { HistoryModule } from './history'
import type { LeagueModule } from './league'
import type { LifecycleModule } from './lifecycle'
import type { RngModule } from './rng'
import type { SimModule } from './sim'
import type { TradeModule } from './trade'

export interface EngineModules {
  rng: RngModule
  league: LeagueModule
  sim: SimModule
  draft: DraftModule
  trade: TradeModule
  fa: FaModule
  lifecycle: LifecycleModule
  history: HistoryModule
}

export interface EngineContext {
  data: StaticData
  /** The hidden truth for every real player. Only engine code may read it. */
  trajectories: TrajectoryTable
  /**
   * Real-season chunks already loaded by the data layer. Returns undefined when the season is past
   * `data.manifest.latestRealSeason` (procedural era). For an in-history season that is simply not
   * loaded yet, implementations must throw SeasonNotLoadedError — never silently go procedural.
   */
  seasonData: (season: Season) => SeasonData | undefined
  modules: EngineModules
}

export function isInHistory(ctx: EngineContext, season: Season): boolean {
  return season <= ctx.data.manifest.latestRealSeason
}

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`not implemented: ${what}`)
    this.name = 'NotImplementedError'
  }
}

export class SeasonNotLoadedError extends Error {
  constructor(season: Season) {
    super(`season ${season} is in history but its data chunk is not loaded`)
    this.name = 'SeasonNotLoadedError'
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what)
}
