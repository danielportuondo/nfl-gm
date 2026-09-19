/**
 * HANDOFF §6.1: nothing under app/src/screens or app/src/ui may read LeagueState.truth or import a truth
 * module. ESLint enforces it too; this test is the belt to that suspender. Also: no Math.random in engine.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = fileURLToPath(new URL('../src/', import.meta.url))

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('truth isolation', () => {
  const uiFiles = [...walk(join(src, 'screens')), ...walk(join(src, 'ui'))]
  it('UI never reads .truth or imports truth/TrueTrajectory', () => {
    const offenders = uiFiles.filter((f) => {
      const code = stripComments(readFileSync(f, 'utf8'))
      return (
        /\.truth\b/.test(code) ||
        /\[['"]truth['"]\]/.test(code) ||
        /\bTrueTrajectory\b/.test(code) ||
        /from\s+['"][^'"]*truth[^'"]*['"]/i.test(code) ||
        /\btrajectories\b/.test(code)
      )
    })
    expect(offenders.map((f) => f.replace(src, 'src/'))).toEqual([])
  })
})

describe('engine determinism', () => {
  it('engine never calls Math.random or Date.now', () => {
    const offenders = walk(join(src, 'engine')).filter((f) => {
      const code = stripComments(readFileSync(f, 'utf8'))
      return (
        /Math\.random\s*\(/.test(code) ||
        /Date\.now\s*\(/.test(code) ||
        /new Date\s*\(\s*\)/.test(code)
      )
    })
    expect(offenders.map((f) => f.replace(src, 'src/'))).toEqual([])
  })
})
