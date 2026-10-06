import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Game } from '@contracts/index'
import { CURATED_NOTE_KEYS, noGameNote, offWeeks } from '@screens/shared/scheduleNotes'

const SEASON_DIR = join(__dirname, '../../public/data/season')

function realSchedule(season: number): Game[] {
  const file = join(SEASON_DIR, String(season), 'schedule.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { games: Game[] }
  return raw.games
}

describe('noGameNote', () => {
  it('explains the 2017 Dolphins week 1 (Hurricane Irma)', () => {
    const games = realSchedule(2017)
    const note = noGameNote(games, 2017, 'MIA', 1)
    expect(note).toMatch(/Hurricane Irma/)
    expect(note).toMatch(/week 11/)
    expect(noGameNote(games, 2017, 'TB', 1)).toMatch(/Hurricane Irma/)
  })

  it('explains the canceled 2022 Bills-Bengals game and the 16-game season', () => {
    const games = realSchedule(2022)
    const note = noGameNote(games, 2022, 'BUF', 17)
    expect(note).toMatch(/canceled/)
    expect(note).toMatch(/16 games/)
    expect(noGameNote(games, 2022, 'CIN', 17)).toMatch(/canceled/)
    // Buffalo's ordinary bye is still just a bye.
    expect(noGameNote(games, 2022, 'BUF', 7)).toMatch(/^Bye week/)
  })

  it('calls an ordinary week off a bye and returns nothing when the team plays', () => {
    const games = realSchedule(2017)
    const [bye] = offWeeks(games, 2017, 'NE')
    expect(noGameNote(games, 2017, 'NE', bye!)).toMatch(/^Bye week/)
    expect(noGameNote(games, 2017, 'NE', 1)).toBeNull()
  })

  it('has a curated note for every team with an unusual schedule in the real data', () => {
    const unexplained: string[] = []
    const offKeys = new Set<string>()
    for (const dir of readdirSync(SEASON_DIR).sort()) {
      const season = Number(dir)
      if (!existsSync(join(SEASON_DIR, dir, 'schedule.json'))) continue
      const games = realSchedule(season)
      const teams = [...new Set(games.flatMap((g) => [g.home, g.away]))].sort()
      for (const team of teams) {
        const off = offWeeks(games, season, team)
        for (const week of off) offKeys.add(`${season}-${team}-${week}`)
        // A normal season has exactly one bye, never in the first three weeks.
        const unusual = off.length !== 1 || off.some((w) => w <= 3)
        const explained = off.some((w) => CURATED_NOTE_KEYS.has(`${season}-${team}-${w}`))
        if (unusual && !explained)
          unexplained.push(`${season} ${team}: off weeks ${off.join(', ')}`)
      }
    }
    expect(unexplained).toEqual([])
    for (const key of CURATED_NOTE_KEYS) expect(offKeys).toContain(key)
  })
})
