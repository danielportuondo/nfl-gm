import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DATA_SCHEMAS, SavedLeagueSchema, TEAM_IDS, toSaved, type DataSchemaName } from '@contracts/index'
import { generateEngineContractDoc, generateJsonSchemas } from '../src/contracts/generate'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'

describe('mock league fixture', () => {
  it('produces a schema-valid league with 32 teams and ~1,700 players', () => {
    const league = mockLeague()
    const parsed = SavedLeagueSchema.safeParse(toSaved(league))
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5), null, 2)).toBe(true)
    expect(Object.keys(league.teams)).toHaveLength(32)
    expect(Object.keys(league.players).length).toBeGreaterThanOrEqual(1700)
    for (const id of TEAM_IDS) expect(league.teams[id]!.roster).toHaveLength(53)
  })

  it('is deterministic for the same seed and differs across seeds', () => {
    const a = mockLeague({ seed: 'alpha' })
    const b = mockLeague({ seed: 'alpha' })
    const c = mockLeague({ seed: 'beta' })
    expect(a.players).toEqual(b.players)
    expect(a.truth).toEqual(b.truth)
    expect(a.schedule).toEqual(b.schedule)
    expect(a.players).not.toEqual(c.players)
  })

  it('never exposes truth through scouting (pot is not the real future)', () => {
    const league = mockLeague()
    const leaks = Object.keys(league.players).filter((id) => {
      const future = Object.values(league.truth[id]!.bySeason)
      return future.length > 2 && league.scouting[id]!.pot === Math.max(...future)
    })
    // Random coincidences are allowed; systematic equality is not.
    expect(leaks.length / Object.keys(league.players).length).toBeLessThan(0.1)
  })

  it('bundle files validate against every data schema', () => {
    const bundle = mockBundle()
    const season = bundle.seasons[2015]!
    const cases: [DataSchemaName, unknown][] = [
      ['manifest', bundle.static.manifest],
      ['teams', { attribution: bundle.static.manifest.attribution, teams: Object.values(bundle.static.teams) }],
      ['cap', bundle.static.cap],
      ['curves', bundle.static.curves],
      ['injuryModel', bundle.static.injuryModel],
      ['seasonPlayers', season.players],
      ['seasonRosters', season.rosters],
      ['seasonDraft', season.draft],
      ['seasonSchedule', season.schedule],
      ['trajectories', { attribution: bundle.static.manifest.attribution, seasons: [2015, 2023], byPlayer: bundle.trajectories }],
    ]
    for (const [name, value] of cases) {
      const r = DATA_SCHEMAS[name].safeParse(value)
      expect(r.success, `${name}: ${JSON.stringify(r.error?.issues.slice(0, 3))}`).toBe(true)
    }
  })
})

describe('generated contract artifacts are committed and in sync', () => {
  const schemas = generateJsonSchemas()
  for (const name of Object.keys(schemas) as DataSchemaName[]) {
    it(`src/contracts/schemas/${name}.schema.json matches schemas.ts`, () => {
      const onDisk = readFileSync(new URL(`../src/contracts/schemas/${name}.schema.json`, import.meta.url), 'utf8')
      expect(onDisk).toBe(schemas[name])
    })
  }
  it('docs/ENGINE_CONTRACT.md matches the contract sources', () => {
    const onDisk = readFileSync(new URL('../../docs/ENGINE_CONTRACT.md', import.meta.url), 'utf8')
    expect(onDisk).toBe(generateEngineContractDoc())
  })
})
