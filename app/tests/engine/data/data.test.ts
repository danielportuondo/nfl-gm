import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DATA_FILES } from '@contracts/index'
import { mockBundle } from '@fixtures/mockLeague'
import { HttpDataSource, MemoryDataSource } from '@data/index'

describe('MemoryDataSource', () => {
  const bundle = mockBundle({ season: 2015 })

  it('loads and validates the manifest', async () => {
    const ds = MemoryDataSource(bundle)
    const manifest = await ds.loadManifest()
    expect(manifest.latestRealSeason).toBe(2015)
  })

  it('loads and validates static data', async () => {
    const ds = MemoryDataSource(bundle)
    const data = await ds.loadStatic()
    expect(Object.keys(data.teams)).toHaveLength(32)
    expect(data.cap.bySeason['2015']).toBeGreaterThan(0)
  })

  it('loads and validates a season chunk', async () => {
    const ds = MemoryDataSource(bundle)
    const season = await ds.loadSeason(2015)
    expect(season.players.players.length).toBeGreaterThan(0)
    expect(Object.keys(season.rosters.rosters)).toHaveLength(32)
  })

  it('throws for a season not present in the bundle', async () => {
    const ds = MemoryDataSource(bundle)
    await expect(ds.loadSeason(1999)).rejects.toThrow(/not present/)
  })

  it('loads and validates trajectories', async () => {
    const ds = MemoryDataSource(bundle)
    const trajectories = await ds.loadTrajectories()
    expect(Object.keys(trajectories).length).toBeGreaterThan(0)
  })

  it('caches loadSeason results', async () => {
    const ds = MemoryDataSource(bundle)
    const a = await ds.loadSeason(2015)
    const b = await ds.loadSeason(2015)
    expect(a).toBe(b)
    ds.clear()
    const c = await ds.loadSeason(2015)
    expect(c).toEqual(a)
  })
})

describe('HttpDataSource', () => {
  const bundle = mockBundle({ season: 2015 })
  const baseUrl = 'https://example.test/data'

  function urlFor(path: string): string {
    return `${baseUrl}/${path}`
  }

  function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches, validates, and caches files by URL', async () => {
    const teamsFile = {
      attribution: bundle.static.manifest.attribution,
      teams: Object.values(bundle.static.teams),
    }
    const fetchMock = vi.fn((input: string) => {
      if (input === urlFor(DATA_FILES.manifest))
        return Promise.resolve(jsonResponse(bundle.static.manifest))
      if (input === urlFor(DATA_FILES.teams)) return Promise.resolve(jsonResponse(teamsFile))
      if (input === urlFor(DATA_FILES.cap)) return Promise.resolve(jsonResponse(bundle.static.cap))
      if (input === urlFor(DATA_FILES.curves))
        return Promise.resolve(jsonResponse(bundle.static.curves))
      if (input === urlFor(DATA_FILES.injuryModel))
        return Promise.resolve(jsonResponse(bundle.static.injuryModel))
      throw new Error(`unexpected fetch: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const ds = HttpDataSource(baseUrl)
    const manifest = await ds.loadManifest()
    expect(manifest.latestRealSeason).toBe(bundle.static.manifest.latestRealSeason)
    await ds.loadManifest()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const teams = await ds.loadStatic()
    expect(Object.keys(teams.teams)).toHaveLength(32)
  })

  it('loads a full season chunk with substituted season path', async () => {
    const season = bundle.seasons[2015]!
    const fetchMock = vi.fn((input: string) => {
      if (input === urlFor(DATA_FILES.seasonPlayers.replace('{yyyy}', '2015')))
        return Promise.resolve(jsonResponse(season.players))
      if (input === urlFor(DATA_FILES.seasonRosters.replace('{yyyy}', '2015')))
        return Promise.resolve(jsonResponse(season.rosters))
      if (input === urlFor(DATA_FILES.seasonDraft.replace('{yyyy}', '2015')))
        return Promise.resolve(jsonResponse(season.draft))
      if (input === urlFor(DATA_FILES.seasonSchedule.replace('{yyyy}', '2015')))
        return Promise.resolve(jsonResponse(season.schedule))
      throw new Error(`unexpected fetch: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const ds = HttpDataSource(baseUrl)
    const loaded = await ds.loadSeason(2015)
    expect(loaded.players.players.length).toBe(season.players.players.length)
  })

  it('rejects an invalid file with a message naming the file', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === urlFor(DATA_FILES.manifest))
        return Promise.resolve(jsonResponse({ garbage: true }))
      throw new Error(`unexpected fetch: ${input}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const ds = HttpDataSource(baseUrl)
    await expect(ds.loadManifest()).rejects.toThrow(/manifest\.json/)
  })

  it('surfaces a non-ok HTTP response with the path in the message', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(null, false, 404)))
    vi.stubGlobal('fetch', fetchMock)

    const ds = HttpDataSource(baseUrl)
    await expect(ds.loadManifest()).rejects.toThrow(/manifest\.json/)
  })
})
