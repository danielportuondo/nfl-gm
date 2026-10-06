/**
 * Pixelify Sans draws capital C as a near-closed O at heading sizes ("Oap", "OLE", "AFO East"), so
 * tokens.css overrides U+0043 in the display stack with a clear C from a compatible pixel face.
 * Display numerals work the same way (docs/DECISIONS.md "Display numerals from Oxanium").
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const cssPath = fileURLToPath(new URL('../../src/ui/tokens.css', import.meta.url))
const css = readFileSync(cssPath, 'utf8')

interface FontFace {
  family: string
  src: string
  range: string
}

function fontFaces(source: string): FontFace[] {
  const faces: FontFace[] = []
  for (const m of source.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1]!
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1]
    const src = /url\('([^']+)'\)/.exec(body)?.[1]
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1]
    if (family && src && range) faces.push({ family, src, range })
  }
  return faces
}

function rangeCovers(range: string, codePoint: number): boolean {
  return range.split(',').some((part) => {
    const [lo, hi = lo] = part
      .trim()
      .replace(/^U\+/i, '')
      .split('-')
      .map((h) => parseInt(h.replace(/^U\+/i, ''), 16))
    return codePoint >= lo! && codePoint <= hi!
  })
}

const displayStack = /--font-display:\s*([^;]+);/.exec(css)?.[1] ?? ''
const stackFamilies = [...displayStack.matchAll(/'([^']+)'/g)].map((m) => m[1]!)

describe('display font stack', () => {
  const faces = fontFaces(css)
  const capitalC = faces.find((f) => rangeCovers(f.range, 0x43))

  it('maps U+0043 (capital C) to its own face, before Pixelify Sans', () => {
    expect(capitalC).toBeDefined()
    expect(capitalC!.family).not.toMatch(/Pixelify/)
    const rank = stackFamilies.indexOf(capitalC!.family)
    expect(rank).toBeGreaterThanOrEqual(0)
    expect(rank).toBeLessThan(stackFamilies.findIndex((f) => f.startsWith('Pixelify Sans')))
  })

  it('does not capture other letters or the digits face', () => {
    expect(capitalC!.range.replace(/\s/g, '')).toBe('U+0043')
    const numerals = faces.find((f) => f.family === 'GG Numerals')!
    expect(rangeCovers(numerals.range, 0x43)).toBe(false)
    expect(rangeCovers(numerals.range, 0x37)).toBe(true)
  })

  it('ships the face self-hosted as a woff2 beside an OFL notice', () => {
    expect(capitalC!.src).toMatch(/^\.\/fonts\/.+\.woff2$/)
    const file = resolve(dirname(cssPath), capitalC!.src)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('wOF2')
    const notice = readFileSync(resolve(dirname(cssPath), 'fonts/OFL.txt'), 'utf8')
    expect(notice).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/)
  })
})
