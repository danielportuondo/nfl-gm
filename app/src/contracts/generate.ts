/**
 * Generates the derived contract artifacts (pure; the CLI wrapper in scripts/gen-contracts.ts writes them):
 *  - src/contracts/schemas/<name>.schema.json  (JSON Schema 2020-12 from the zod schemas)
 *  - docs/ENGINE_CONTRACT.md                    (the engine interfaces, verbatim, with a table of contents)
 * tests/contracts.test.ts regenerates in memory and fails if the committed files drift.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { DATA_FILES, DATA_SCHEMAS, type DataSchemaName } from './schemas'

const here = fileURLToPath(new URL('.', import.meta.url))

export const ENGINE_CONTRACT_FILES = [
  'types.ts',
  'teams.ts',
  'data.ts',
  'engine/context.ts',
  'engine/rng.ts',
  'engine/league.ts',
  'engine/sim.ts',
  'engine/draft.ts',
  'engine/trade.ts',
  'engine/fa.ts',
  'engine/lifecycle.ts',
  'engine/history.ts',
  'engine/persistence.ts',
] as const

export function generateJsonSchemas(): Record<DataSchemaName, string> {
  const out = {} as Record<DataSchemaName, string>
  for (const name of Object.keys(DATA_SCHEMAS) as DataSchemaName[]) {
    const json = z.toJSONSchema(DATA_SCHEMAS[name], { target: 'draft-2020-12' }) as Record<
      string,
      unknown
    >
    const ordered = {
      $schema: json.$schema,
      $id: `https://gridiron-gm.dev/schemas/${name}.schema.json`,
      title: name,
      description: `Gridiron GM data contract for ${DATA_FILES[name]}. Generated from app/src/contracts/schemas.ts — do not edit by hand. Data courtesy of nflverse (CC BY 4.0).`,
      ...Object.fromEntries(Object.entries(json).filter(([k]) => k !== '$schema')),
    }
    out[name] = JSON.stringify(ordered, null, 2) + '\n'
  }
  return out
}

export function generateEngineContractDoc(): string {
  const sections = ENGINE_CONTRACT_FILES.map((rel) => {
    const src = readFileSync(`${here}${rel}`, 'utf8').trimEnd()
    return `## \`app/src/contracts/${rel}\`\n\n\`\`\`ts\n${src}\n\`\`\`\n`
  })
  const toc = ENGINE_CONTRACT_FILES.map(
    (rel) => `- [\`${rel}\`](#appsrccontracts${rel.replace(/[/.]/g, '')})`,
  ).join('\n')
  return [
    '# Engine contract',
    '',
    '**Generated** from `app/src/contracts/` by `pnpm gen:contracts`. Do not edit by hand; edit the source',
    'and regenerate. `tests/contracts.test.ts` fails when this file is stale.',
    '',
    'Every engine module is a plain object of pure functions over `LeagueState` (input never mutated).',
    'Cross-module calls go through `EngineContext.modules`. Randomness only through `engine/rng`, seeded from',
    '`LeagueState.seed` + scope. Nothing under `app/src/screens` or `app/src/ui` reads `LeagueState.truth`.',
    'Ownership per module is in the header comment of each file; see `docs/HANDOFF.md` §3 and §7.',
    '',
    toc,
    '',
    ...sections,
  ].join('\n')
}
