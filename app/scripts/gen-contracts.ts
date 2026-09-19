import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { generateEngineContractDoc, generateJsonSchemas } from '../src/contracts/generate'

const appRoot = fileURLToPath(new URL('..', import.meta.url))
const schemaDir = `${appRoot}src/contracts/schemas/`
mkdirSync(schemaDir, { recursive: true })

const schemas = generateJsonSchemas()
for (const [name, json] of Object.entries(schemas))
  writeFileSync(`${schemaDir}${name}.schema.json`, json)
writeFileSync(`${appRoot}../docs/ENGINE_CONTRACT.md`, generateEngineContractDoc())
console.log(
  `wrote ${Object.keys(schemas).length} JSON schemas to src/contracts/schemas/ and docs/ENGINE_CONTRACT.md`,
)
