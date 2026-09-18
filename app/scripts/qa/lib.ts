/**
 * Shared scaffolding for the Phase 5B balance/exploit scripts.
 *
 * These scripts play the adversary: they are allowed to read `state.truth` (the hindsight model) to
 * construct the best offer a cheating user could make. Nothing here runs in the app — it lives under
 * scripts/ precisely so the truth-isolation rule that binds src/screens and src/ui does not apply.
 */
import type { EngineContext, LeagueState, PlayerId, Season, TeamId } from '../../src/contracts/index'
import { TEAM_IDS } from '../../src/contracts/index'
import { loadRealContext, readManifest, seasonsForNewGame } from '../lib/publicData'

export const DEFAULT_SETTINGS = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
} as const

export interface NewGameOpts {
  season: Season
  userTeam?: TeamId
  seed?: string
  seasons?: number
  strictness?: 'lenient' | 'balanced' | 'strict' | 'ruthless'
}

export async function newRealGame(opts: NewGameOpts): Promise<{ state: LeagueState; ctx: EngineContext }> {
  const manifest = readManifest()
  const seasons = opts.seasons ?? 1
  const wanted = new Set<Season>()
  for (let s = opts.season; s < opts.season + seasons; s++) {
    for (const x of seasonsForNewGame(s, manifest.latestRealSeason)) wanted.add(x)
  }
  const ctx = await loadRealContext([...wanted].sort((a, b) => a - b))
  const state = ctx.modules.league.newGame(
    {
      seed: opts.seed ?? 'qa',
      startSeason: opts.season,
      userTeam: opts.userTeam ?? 'IND',
      horizonSeasons: seasons,
      settings: { ...DEFAULT_SETTINGS, tradeStrictness: opts.strictness ?? 'balanced' },
    },
    ctx,
  )
  return { state, ctx }
}

// --- statistics ------------------------------------------------------------------------------

export function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0
}

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length)
}

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[i]!
}

export function pct(x: number, digits = 1): string {
  return `${(100 * x).toFixed(digits)}%`
}

// --- hindsight -------------------------------------------------------------------------------

/** What a player is really worth in `season` (the hidden trajectory). Adversary-only. */
export function trueValue(state: LeagueState, playerId: PlayerId, season: Season): number | null {
  return state.truth[playerId]?.bySeason[String(season)] ?? null
}

/** Consensus minus truth over the next `years`: positive = the league overrates him (sell high). */
export function hindsightEdge(state: LeagueState, playerId: PlayerId, years = 3): number {
  const consensus = state.scouting[playerId]?.ovr ?? 0
  const future: number[] = []
  for (let i = 1; i <= years; i++) {
    const v = trueValue(state, playerId, state.season + i)
    if (v !== null) future.push(v)
  }
  // A player with no future at all has retired/left: his real value to the buyer is replacement level.
  const realised = future.length ? mean(future) : 42
  return consensus - realised
}

export function rosterOf(state: LeagueState, teamId: TeamId): readonly PlayerId[] {
  return (state.teams[teamId]?.roster ?? []).map((r) => r.playerId)
}

export function aiTeams(state: LeagueState): TeamId[] {
  return TEAM_IDS.filter((t) => t !== state.userTeam)
}

export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)))
  return rows
    .map((row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  '))
    .join('\n')
}
