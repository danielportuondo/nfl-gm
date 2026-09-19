/**
 * Node-side access to the shipped data (app/public/data) for scripts and integration tests: read the
 * JSON files into a MemoryBundle, validate them through MemoryDataSource, and hand back an
 * EngineContext over the real engine. The browser goes through HttpDataSource instead.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DATA_FILES,
  SeasonNotLoadedError,
  type CapFile,
  type CurvesFile,
  type EngineContext,
  type EngineModules,
  type InjuryModelFile,
  type Manifest,
  type MemoryBundle,
  type Season,
  type SeasonData,
  type SeasonDraftFile,
  type SeasonPlayersFile,
  type SeasonRostersFile,
  type SeasonScheduleFile,
  type StaticData,
  type TeamId,
  type TeamInfo,
  type TeamsFile,
  type TrajectoriesFile,
} from '@contracts/index'
import { MemoryDataSource } from '@data/index'
import { engineModules } from '@engine/index'

export const PUBLIC_DATA_DIR = fileURLToPath(new URL('../../public/data/', import.meta.url))

/** Seasons newGame(start) needs: the start chunk plus the next two draft classes, while in history. */
export function seasonsForNewGame(start: Season, latestRealSeason: Season): Season[] {
  const out: Season[] = []
  for (let s = start; s <= Math.min(start + 2, latestRealSeason); s++) out.push(s)
  return out
}

function readJson<T>(root: string, relativePath: string): T {
  return JSON.parse(readFileSync(`${root}${relativePath}`, 'utf8')) as T
}

export function readManifest(root = PUBLIC_DATA_DIR): Manifest {
  return readJson<Manifest>(root, DATA_FILES.manifest)
}

/** Raw (not yet validated) bundle; MemoryDataSource validates on load. Seasons past the data are skipped. */
export function readPublicBundle(seasons: readonly Season[], root = PUBLIC_DATA_DIR): MemoryBundle {
  const manifest = readManifest(root)
  const teams: Record<TeamId, TeamInfo> = {}
  for (const t of readJson<TeamsFile>(root, DATA_FILES.teams).teams) teams[t.id] = t
  const staticData: StaticData = {
    manifest,
    teams,
    cap: readJson<CapFile>(root, DATA_FILES.cap),
    curves: readJson<CurvesFile>(root, DATA_FILES.curves),
    injuryModel: readJson<InjuryModelFile>(root, DATA_FILES.injuryModel),
  }
  const seasonChunks: Record<Season, SeasonData> = {}
  const path = (name: keyof typeof DATA_FILES, season: Season) =>
    DATA_FILES[name].replace('{yyyy}', String(season))
  for (const season of [...new Set(seasons)].sort((a, b) => a - b)) {
    if (season > manifest.latestRealSeason || !manifest.seasons.includes(season)) continue
    seasonChunks[season] = {
      players: readJson<SeasonPlayersFile>(root, path('seasonPlayers', season)),
      rosters: readJson<SeasonRostersFile>(root, path('seasonRosters', season)),
      draft: readJson<SeasonDraftFile>(root, path('seasonDraft', season)),
      schedule: readJson<SeasonScheduleFile>(root, path('seasonSchedule', season)),
    }
  }
  return {
    static: staticData,
    seasons: seasonChunks,
    trajectories: readJson<TrajectoriesFile>(root, DATA_FILES.trajectories).byPlayer,
  }
}

/** Validated EngineContext over the shipped data. `seasons` are loaded eagerly; others throw SeasonNotLoadedError. */
export async function loadRealContext(
  seasons: readonly Season[],
  modules: EngineModules = engineModules,
  root = PUBLIC_DATA_DIR,
): Promise<EngineContext> {
  const source = MemoryDataSource(readPublicBundle(seasons, root))
  const data = await source.loadStatic()
  const trajectories = await source.loadTrajectories()
  const loaded = new Map<Season, SeasonData>()
  for (const season of seasons) {
    if (season <= data.manifest.latestRealSeason)
      loaded.set(season, await source.loadSeason(season))
  }
  return {
    data,
    trajectories,
    seasonData: (season) => {
      const chunk = loaded.get(season)
      if (chunk) return chunk
      if (season > data.manifest.latestRealSeason) return undefined
      throw new SeasonNotLoadedError(season)
    },
    modules,
  }
}

/** Real regular-season win totals (ties count half) when the schedule carries scores; null otherwise. */
export function realWinTotals(schedule: SeasonScheduleFile): Record<TeamId, number> | null {
  const wins: Record<TeamId, number> = {}
  let scored = 0
  for (const g of schedule.games) {
    if (g.type !== 'REG') continue
    if (g.homeScore == null || g.awayScore == null) continue
    scored++
    const homeCredit = g.homeScore > g.awayScore ? 1 : g.homeScore === g.awayScore ? 0.5 : 0
    wins[g.home] = (wins[g.home] ?? 0) + homeCredit
    wins[g.away] = (wins[g.away] ?? 0) + (1 - homeCredit)
  }
  return scored > 0 ? wins : null
}
