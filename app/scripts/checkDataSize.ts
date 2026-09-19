/**
 * Data size budget check (HANDOFF §6.10).
 *
 *   pnpm --filter app exec tsx scripts/checkDataSize.ts
 *
 * Initial load = manifest.json, teams.json, cap.json, curves.json, injuryModel.json, trajectories.json,
 * gzipped together, must be <= 1.5 MB. Every file under public/data/season/** must individually gzip to
 * <= 1 MB (GitHub Pages serves gzip, so gzipped size is what a player actually downloads).
 */
import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const DATA_ROOT = join(import.meta.dirname, '..', 'public', 'data')
const INITIAL_LOAD_FILES = [
  'manifest.json',
  'teams.json',
  'cap.json',
  'curves.json',
  'injuryModel.json',
  'trajectories.json',
]
const INITIAL_LOAD_BUDGET_BYTES = 1.5 * 1024 * 1024
const SEASON_FILE_BUDGET_BYTES = 1 * 1024 * 1024

interface FileSize {
  path: string
  rawBytes: number
  gzipBytes: number
}

function gzipSize(path: string): FileSize {
  const raw = readFileSync(path)
  const gz = gzipSync(raw, { level: 9 })
  return { path: relative(DATA_ROOT, path), rawBytes: raw.byteLength, gzipBytes: gz.byteLength }
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...listFilesRecursive(full))
    else out.push(full)
  }
  return out
}

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`
}

function printTable(rows: FileSize[]): void {
  const nameWidth = Math.max(4, ...rows.map((r) => r.path.length))
  console.log(`${'file'.padEnd(nameWidth)}  raw        gzip`)
  for (const r of rows) {
    console.log(
      `${r.path.padEnd(nameWidth)}  ${fmtKB(r.rawBytes).padStart(9)}  ${fmtKB(r.gzipBytes).padStart(9)}`,
    )
  }
}

function main(): void {
  let failed = false

  const initialRows = INITIAL_LOAD_FILES.map((name) => gzipSize(join(DATA_ROOT, name)))
  const initialTotal = initialRows.reduce((sum, r) => sum + r.gzipBytes, 0)

  console.log('Initial load files:')
  printTable(initialRows)
  console.log(
    `Initial load total (gzip): ${fmtKB(initialTotal)} / budget ${fmtKB(INITIAL_LOAD_BUDGET_BYTES)}`,
  )
  if (initialTotal > INITIAL_LOAD_BUDGET_BYTES) {
    console.error(
      `FAIL: initial load exceeds budget by ${fmtKB(initialTotal - INITIAL_LOAD_BUDGET_BYTES)}`,
    )
    failed = true
  }
  console.log('')

  const seasonDir = join(DATA_ROOT, 'season')
  const seasonFiles = listFilesRecursive(seasonDir).filter((f) => f.endsWith('.json'))
  const seasonRows = seasonFiles.map(gzipSize).sort((a, b) => b.gzipBytes - a.gzipBytes)

  console.log(`Season files (${seasonRows.length} total), largest first:`)
  printTable(seasonRows.slice(0, 20))
  if (seasonRows.length > 20) console.log(`... and ${seasonRows.length - 20} more`)

  const oversized = seasonRows.filter((r) => r.gzipBytes > SEASON_FILE_BUDGET_BYTES)
  if (oversized.length > 0) {
    console.error('')
    console.error(
      `FAIL: ${oversized.length} season file(s) exceed the ${fmtKB(SEASON_FILE_BUDGET_BYTES)} gzip budget:`,
    )
    for (const r of oversized) console.error(`  ${r.path}: ${fmtKB(r.gzipBytes)}`)
    failed = true
  }

  console.log('')
  if (failed) {
    console.error('Data size budget check FAILED.')
    process.exit(1)
  }
  console.log('Data size budget check passed.')
}

main()
