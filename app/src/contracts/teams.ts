/**
 * Canonical franchise identities. ORCHESTRATOR-OWNED.
 *
 * A TeamId is the franchise's CURRENT nflverse abbreviation and is stable across relocations and
 * renames. The pipeline maps every historical code to the canonical id via TEAM_ALIASES; the UI shows
 * the era-appropriate city/name from TeamInfo.eras.
 */
import type { Conference, Division, TeamId } from './types'

export const TEAM_IDS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LAR',
  'LAC',
  'LV',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
] as const satisfies readonly TeamId[]

export type CanonicalTeamId = (typeof TEAM_IDS)[number]

/**
 * Historical nflverse codes → canonical id. Codes not listed map to themselves. nflverse spells teams
 * three ways across its own releases (relocation codes, alternate roster codes such as ARZ/BLT/CLV/HST,
 * and PFR-style codes in draft_picks such as GNB/KAN/NWE); pipeline/.../build/teams.py mirrors this table.
 */
export const TEAM_ALIASES: Record<string, CanonicalTeamId> = {
  STL: 'LAR',
  LA: 'LAR',
  LAR: 'LAR',
  SL: 'LAR',
  RAM: 'LAR',
  SD: 'LAC',
  LAC: 'LAC',
  SDG: 'LAC',
  OAK: 'LV',
  LV: 'LV',
  LVR: 'LV',
  RAI: 'LV',
  WSH: 'WAS',
  WAS: 'WAS',
  JAC: 'JAX',
  JAX: 'JAX',
  ARZ: 'ARI',
  PHO: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
  GNB: 'GB',
  KAN: 'KC',
  NOR: 'NO',
  NWE: 'NE',
  SFO: 'SF',
  TAM: 'TB',
}

export function canonicalTeamId(code: string): CanonicalTeamId {
  const upper = code.toUpperCase()
  const mapped = TEAM_ALIASES[upper] ?? upper
  if (!(TEAM_IDS as readonly string[]).includes(mapped))
    throw new Error(`Unknown team code: ${code}`)
  return mapped as CanonicalTeamId
}

export const DIVISIONS: Record<CanonicalTeamId, { conf: Conference; div: Division }> = {
  BUF: { conf: 'AFC', div: 'East' },
  MIA: { conf: 'AFC', div: 'East' },
  NE: { conf: 'AFC', div: 'East' },
  NYJ: { conf: 'AFC', div: 'East' },
  BAL: { conf: 'AFC', div: 'North' },
  CIN: { conf: 'AFC', div: 'North' },
  CLE: { conf: 'AFC', div: 'North' },
  PIT: { conf: 'AFC', div: 'North' },
  HOU: { conf: 'AFC', div: 'South' },
  IND: { conf: 'AFC', div: 'South' },
  JAX: { conf: 'AFC', div: 'South' },
  TEN: { conf: 'AFC', div: 'South' },
  DEN: { conf: 'AFC', div: 'West' },
  KC: { conf: 'AFC', div: 'West' },
  LV: { conf: 'AFC', div: 'West' },
  LAC: { conf: 'AFC', div: 'West' },
  DAL: { conf: 'NFC', div: 'East' },
  NYG: { conf: 'NFC', div: 'East' },
  PHI: { conf: 'NFC', div: 'East' },
  WAS: { conf: 'NFC', div: 'East' },
  CHI: { conf: 'NFC', div: 'North' },
  DET: { conf: 'NFC', div: 'North' },
  GB: { conf: 'NFC', div: 'North' },
  MIN: { conf: 'NFC', div: 'North' },
  ATL: { conf: 'NFC', div: 'South' },
  CAR: { conf: 'NFC', div: 'South' },
  NO: { conf: 'NFC', div: 'South' },
  TB: { conf: 'NFC', div: 'South' },
  ARI: { conf: 'NFC', div: 'West' },
  LAR: { conf: 'NFC', div: 'West' },
  SF: { conf: 'NFC', div: 'West' },
  SEA: { conf: 'NFC', div: 'West' },
}

/** Era-correct league structure (docs/HANDOFF.md §4). */
export function leagueFormat(season: number): {
  regularSeasonGames: 16 | 17
  playoffTeams: 12 | 14
  byesPerConf: 1 | 2
} {
  return {
    regularSeasonGames: season >= 2021 ? 17 : 16,
    playoffTeams: season >= 2020 ? 14 : 12,
    byesPerConf: season >= 2020 ? 1 : 2,
  }
}

/** Positional roster template used for need computation and depth charts (starters). */
export const STARTER_TEMPLATE: Record<string, number> = {
  QB: 1,
  RB: 1,
  WR: 3,
  TE: 1,
  OL: 5,
  DL: 4,
  LB: 3,
  CB: 3,
  S: 2,
  K: 1,
  P: 1,
}

/** Typical 53-man distribution used by the mock fixture and procedural class sizing. */
export const ROSTER_TEMPLATE_53: Record<string, number> = {
  QB: 3,
  RB: 4,
  WR: 6,
  TE: 3,
  OL: 9,
  DL: 9,
  LB: 7,
  CB: 6,
  S: 4,
  K: 1,
  P: 1,
}
