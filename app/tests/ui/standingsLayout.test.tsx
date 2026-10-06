// @vitest-environment jsdom
/**
 * 2019 QA L3: at 721-1199px (rail visible, two cards per row) each division card was ~200-390px
 * wide for a 422px table, so PF, PA and Clinched sat clipped inside the card with no cue. Below
 * 721px the cards already stack; there they compact so the table fits the phone card.
 * jsdom has no layout, so this pins the markup hooks and the CSS rules that do the work; the real
 * widths were measured in a browser (docs/DECISIONS.md).
 */
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TEAM_IDS, type StandingRow } from '@contracts/index'
import { mockStatic } from '@fixtures/mockLeague'
import { Standings } from '@screens/Standings'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

// vitest's css handling empties `?raw` css imports, and jsdom breaks import.meta.url; vitest runs
// from app/, so read the file from there.
const css = readFileSync(resolve(process.cwd(), 'src/ui/primitives/primitives.css'), 'utf8')

function rows(): StandingRow[] {
  return TEAM_IDS.map((teamId, i) => ({
    teamId,
    wins: 16 - i,
    losses: i,
    ties: 0,
    pct: (16 - i) / 16,
    pointsFor: 400 - i,
    pointsAgainst: 300 + i,
    divRank: (i % 4) + 1,
    confRank: (i % 16) + 1,
    clinched: i === 0 ? 'DIV' : null,
  }))
}

/** Declarations of the rule for `selector` inside any `atRule` block (it can appear many times). */
function ruleIn(atRule: string, selector: string): string | null {
  let from = 0
  for (;;) {
    const start = css.indexOf(atRule, from)
    if (start === -1) return null
    const open = css.indexOf('{', start)
    let depth = 0
    let end = open
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}' && --depth === 0) {
        end = i
        break
      }
    }
    const block = css.slice(open + 1, end)
    const hit = [block.indexOf(`${selector} {`), block.indexOf(`${selector},`)]
      .filter((i) => i !== -1)
      .sort((a, b) => a - b)[0]
    if (hit !== undefined) return block.slice(block.indexOf('{', hit) + 1, block.indexOf('}', hit))
    from = end
  }
}

describe('Standings division cards', () => {
  it('render all six columns in every card', () => {
    render(<Standings data={mockStatic()} rows={rows()} />)
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(8)
    for (const table of tables) {
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent?.replace(/[▲▼]/g, '').trim())
      expect(headers).toEqual(['Team', 'W-L-T', 'Pct', 'PF', 'PA', 'Clinched'])
    }
  })

  it('carry the hook classes the layout rules target', () => {
    const { container } = render(<Standings data={mockStatic()} rows={rows()} />)
    expect(container.querySelectorAll('.gg-col-6.gg-standings-col')).toHaveLength(8)
    expect(container.querySelectorAll('.gg-panel.gg-standings')).toHaveLength(8)
  })

  it('stack one per row while the rail is visible and two columns would clip', () => {
    const rule = ruleIn(
      '@media (min-width: 721px) and (max-width: 1199px)',
      '.gg-board > .gg-standings-col',
    )
    expect(rule).toMatch(/grid-column:\s*span 12/)
  })

  it('show the abbreviation on phones so the table fits without scrolling', () => {
    const { container } = render(<Standings data={mockStatic()} rows={rows()} />)
    const first = container.querySelector('.gg-standings__full')!
    expect(first.textContent).toMatch(/\w+ \w+/)
    expect(first.nextElementSibling).toHaveClass('gg-standings__abbr')
    expect(first.nextElementSibling!.textContent).toMatch(/^[A-Z]{2,3}$/)
    expect(ruleIn('@media (max-width: 720px)', '.gg-standings__full')).toMatch(/display:\s*none/)
    expect(ruleIn('@media (max-width: 720px)', '.gg-standings__abbr')).toMatch(/display:\s*inline/)
    expect(ruleIn('@media (max-width: 720px)', '.gg-standings .gg-table th')).toMatch(
      /padding-inline:\s*var\(--sp-1\)/,
    )
    expect(css).toMatch(/\.gg-standings__abbr\s*\{\s*display:\s*none/)
    const card = ruleIn('@media (max-width: 720px)', '.gg-panel.gg-standings')
    expect(card).toMatch(/padding:\s*var\(--sp-3\)/)
  })
})
