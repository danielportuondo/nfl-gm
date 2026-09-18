/**
 * Data-layer loaders (contracts/data.ts `DataSource`). Every file is validated against its zod schema
 * from @contracts/index before being handed to the engine. `MemoryDataSource` serves an in-memory
 * `MemoryBundle` (tests, headless harness); `HttpDataSource` fetches from `app/public/data` and caches
 * by URL.
 */
import {
  CapFileSchema, CurvesFileSchema, DATA_FILES, InjuryModelFileSchema, ManifestSchema,
  SeasonDraftFileSchema, SeasonPlayersFileSchema, SeasonRostersFileSchema, SeasonScheduleFileSchema,
  TeamsFileSchema, TrajectoriesFileSchema,
  type CapFile, type CurvesFile, type DataSource, type InjuryModelFile, type Manifest, type MemoryBundle,
  type Season, type SeasonData, type StaticData, type TeamId, type TeamInfo, type TrajectoryTable,
} from '@contracts/index'
import type { ZodType } from 'zod'

function validateOrThrow<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`${label}: failed schema validation — ${issues}`)
  }
  return parsed.data
}

function teamsRecordToArray(teams: Record<TeamId, TeamInfo>): TeamInfo[] {
  return Object.keys(teams)
    .sort()
    .map((id) => teams[id]!)
}

function teamsArrayToRecord(teams: TeamInfo[]): Record<TeamId, TeamInfo> {
  const out: Record<TeamId, TeamInfo> = {}
  for (const t of teams) out[t.id] = t
  return out
}

// -------------------------------------------------------------------------------------------
// MemoryDataSource — validates and serves an in-memory MemoryBundle (tests, headless harness).
// -------------------------------------------------------------------------------------------

export function MemoryDataSource(bundle: MemoryBundle): DataSource {
  let manifestCache: Manifest | undefined
  let staticCache: StaticData | undefined
  const seasonCache = new Map<Season, SeasonData>()
  let trajectoriesCache: TrajectoryTable | undefined

  return {
    async loadManifest() {
      manifestCache ??= validateOrThrow(ManifestSchema, bundle.static.manifest, 'manifest.json')
      return manifestCache
    },

    async loadStatic() {
      if (!staticCache) {
        const attribution = bundle.static.manifest.attribution
        validateOrThrow(TeamsFileSchema, { attribution, teams: teamsRecordToArray(bundle.static.teams) }, 'teams.json')
        validateOrThrow(CapFileSchema, bundle.static.cap, 'cap.json')
        validateOrThrow(CurvesFileSchema, bundle.static.curves, 'curves.json')
        validateOrThrow(InjuryModelFileSchema, bundle.static.injuryModel, 'injuryModel.json')
        staticCache = bundle.static
      }
      return staticCache
    },

    async loadSeason(season) {
      const cached = seasonCache.get(season)
      if (cached) return cached
      const sd = bundle.seasons[season]
      if (!sd) throw new Error(`season/${season}: not present in the memory bundle`)
      validateOrThrow(SeasonPlayersFileSchema, sd.players, `season/${season}/players.json`)
      validateOrThrow(SeasonRostersFileSchema, sd.rosters, `season/${season}/rosters.json`)
      validateOrThrow(SeasonDraftFileSchema, sd.draft, `season/${season}/draft.json`)
      validateOrThrow(SeasonScheduleFileSchema, sd.schedule, `season/${season}/schedule.json`)
      seasonCache.set(season, sd)
      return sd
    },

    async loadTrajectories() {
      if (!trajectoriesCache) {
        const seasons = Object.values(bundle.trajectories).flatMap((t) => [t.start, t.start + t.values.length - 1])
        const range: [Season, Season] = seasons.length
          ? [Math.min(...seasons), Math.max(...seasons)]
          : [bundle.static.manifest.latestRealSeason, bundle.static.manifest.latestRealSeason]
        validateOrThrow(
          TrajectoriesFileSchema,
          { attribution: bundle.static.manifest.attribution, seasons: range, byPlayer: bundle.trajectories },
          'trajectories.json',
        )
        trajectoriesCache = bundle.trajectories
      }
      return trajectoriesCache
    },

    clear() {
      manifestCache = undefined
      staticCache = undefined
      seasonCache.clear()
      trajectoriesCache = undefined
    },
  }
}

// -------------------------------------------------------------------------------------------
// HttpDataSource — fetches app/public/data/*.json, validates, caches by URL.
// -------------------------------------------------------------------------------------------

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function HttpDataSource(baseUrl: string): DataSource {
  const cache = new Map<string, unknown>()

  async function fetchJson(path: string): Promise<unknown> {
    const url = joinUrl(baseUrl, path)
    if (cache.has(url)) return cache.get(url)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${path}: request failed with status ${res.status}`)
    const json: unknown = await res.json()
    cache.set(url, json)
    return json
  }

  async function fetchValidated<T>(schema: ZodType<T>, path: string): Promise<T> {
    const json = await fetchJson(path)
    return validateOrThrow(schema, json, path)
  }

  const loadManifest = () => fetchValidated(ManifestSchema, DATA_FILES.manifest)

  return {
    loadManifest,

    async loadStatic() {
      const [manifest, teamsFile, cap, curves, injuryModel] = await Promise.all([
        loadManifest(),
        fetchValidated(TeamsFileSchema, DATA_FILES.teams),
        fetchValidated(CapFileSchema, DATA_FILES.cap) as Promise<CapFile>,
        fetchValidated(CurvesFileSchema, DATA_FILES.curves) as Promise<CurvesFile>,
        fetchValidated(InjuryModelFileSchema, DATA_FILES.injuryModel) as Promise<InjuryModelFile>,
      ])
      return { manifest, teams: teamsArrayToRecord(teamsFile.teams), cap, curves, injuryModel }
    },

    async loadSeason(season) {
      const path = (name: keyof typeof DATA_FILES) => DATA_FILES[name].replace('{yyyy}', String(season))
      const [players, rosters, draft, schedule] = await Promise.all([
        fetchValidated(SeasonPlayersFileSchema, path('seasonPlayers')),
        fetchValidated(SeasonRostersFileSchema, path('seasonRosters')),
        fetchValidated(SeasonDraftFileSchema, path('seasonDraft')),
        fetchValidated(SeasonScheduleFileSchema, path('seasonSchedule')),
      ])
      return { players, rosters, draft, schedule }
    },

    async loadTrajectories() {
      const file = await fetchValidated(TrajectoriesFileSchema, DATA_FILES.trajectories)
      return file.byPlayer
    },

    clear() {
      cache.clear()
    },
  }
}
