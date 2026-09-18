/**
 * docs/DESIGN.md §2: every token listed must exist on :root (dark default), and every color token
 * must be redefined under :root[data-theme="light"].
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url)), 'utf8')

function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const braceStart = source.indexOf('{', start)
  let depth = 0
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(braceStart + 1, i)
    }
  }
  throw new Error(`unbalanced braces for selector: ${selector}`)
}

function variableNames(block: string): Set<string> {
  const names = new Set<string>()
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:/gi)) names.add(m[1]!)
  return names
}

const rootBlock = extractBlock(css, ':root {')
const rootVars = variableNames(rootBlock)
const lightBlock = extractBlock(css, ":root[data-theme='light']")
const lightVars = variableNames(lightBlock)

// docs/DESIGN.md §2.1 "night game"
const COLOR_TOKENS = [
  '--surface-0', '--surface-1', '--surface-2', '--surface-3', '--line',
  '--text-1', '--text-2', '--text-3', '--text-inverse',
  '--accent', '--on-accent', '--danger', '--on-danger', '--positive', '--on-positive',
]
const TEAM_TOKENS = ['--team-primary', '--team-secondary', '--on-team-primary']

// docs/DESIGN.md §2.3 type scale
const TYPE_TOKENS = [
  '--font-display', '--font-body',
  '--fs-1', '--fs-2', '--fs-3',
  '--fd-1', '--fd-2', '--fd-3', '--fd-4', '--fd-5',
  '--lh-body', '--lh-display', '--ls-display',
]

// docs/DESIGN.md §2.4 space, radius, border, shadow, motion, layering
const LAYOUT_TOKENS = [
  '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8',
  '--r-0', '--r-1', '--r-2',
  '--bw', '--bw-plate',
  '--shadow-raise', '--shadow-hover', '--shadow-press', '--shadow-none',
  '--t-snap', '--t-quick', '--t-reveal', '--stagger', '--ease-mech', '--ease-out',
  '--z-rail', '--z-strip', '--z-modal', '--z-toast',
]

describe('design tokens (docs/DESIGN.md §2)', () => {
  it.each([...COLOR_TOKENS, ...TEAM_TOKENS, ...TYPE_TOKENS, ...LAYOUT_TOKENS])('defines %s on :root', (name) => {
    expect(rootVars.has(name)).toBe(true)
  })

  it.each(COLOR_TOKENS)('redefines the color token %s for the light theme', (name) => {
    expect(lightVars.has(name)).toBe(true)
  })
})
