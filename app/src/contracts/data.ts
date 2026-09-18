/**
 * Data-layer contract: loaders for app/public/data chunks (§6.10). Owned by league-engine (1C, app/src/data).
 *
 * Every loader validates against the zod schema in ./schemas.ts (dev builds always; prod builds may
 * skip validation for speed behind a flag). Loaders cache by URL. Base URL comes from import.meta.env.BASE_URL.
 */
import type { Manifest, Season, SeasonData, StaticData, TrajectoryTable } from './types'

export interface DataSource {
  loadManifest(): Promise<Manifest>
  loadStatic(): Promise<StaticData>
  loadSeason(season: Season): Promise<SeasonData>
  /** The hidden truth. Only the engine context should hold the result; never hand it to the UI layer. */
  loadTrajectories(): Promise<TrajectoryTable>
  /** Drop caches (tests). */
  clear(): void
}

/** A DataSource over an in-memory bundle, used by tests and the headless harness. */
export interface MemoryBundle {
  static: StaticData
  seasons: Record<Season, SeasonData>
  trajectories: TrajectoryTable
}
