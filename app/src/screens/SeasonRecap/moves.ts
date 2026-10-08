/**
 * Pure helpers for the "Your moves" view (docs/HANDOFF.md Phase 5 brief item: transactions log).
 * Reads only state.transactions/players/scouting/picks — never anything else — so this stays
 * hindsight-safe by construction.
 */
import type { DraftPick, LeagueState, PickRef, PlayerId, Transaction } from '@contracts/index'
import { leagueYear } from '../shared/phaseLabel'

export type MoveFilter = 'all' | 'trades' | 'draft' | 'signings' | 'releases'

export const MOVE_FILTERS: MoveFilter[] = ['all', 'trades', 'draft', 'signings', 'releases']

export const MOVE_FILTER_LABEL: Record<MoveFilter, string> = {
  all: 'All',
  trades: 'Trades',
  draft: 'Draft',
  signings: 'Signings',
  releases: 'Releases',
}

/** UDFA counts as a signing everywhere in this view (filters and the count summary alike). */
function isSigningKind(kind: Transaction['kind']): boolean {
  return kind === 'SIGN' || kind === 'RESIGN' || kind === 'UDFA'
}

export function matchesFilter(t: Transaction, filter: MoveFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'trades':
      return t.kind === 'TRADE'
    case 'draft':
      return t.kind === 'DRAFT'
    case 'signings':
      return isSigningKind(t.kind)
    case 'releases':
      return t.kind === 'RELEASE'
  }
}

export interface SeasonMoves {
  season: number
  entries: Transaction[]
}

/** Groups by league year (offseason moves lead into the next season), newest first, in log order. */
export function groupBySeason(transactions: Transaction[]): SeasonMoves[] {
  const bySeason = new Map<number, Transaction[]>()
  for (const t of transactions) {
    const year = leagueYear(t.season, t.phase)
    const list = bySeason.get(year)
    if (list) list.push(t)
    else bySeason.set(year, [t])
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => b - a)
    .map(([season, entries]) => ({ season, entries }))
}

const COUNT_GROUPS: {
  match: (kind: Transaction['kind']) => boolean
  singular: string
  plural: string
}[] = [
  { match: (k) => k === 'TRADE', singular: 'trade', plural: 'trades' },
  { match: (k) => k === 'DRAFT', singular: 'pick', plural: 'picks' },
  { match: isSigningKind, singular: 'signing', plural: 'signings' },
  { match: (k) => k === 'RELEASE', singular: 'release', plural: 'releases' },
  { match: (k) => k === 'LEFT_LEAGUE', singular: 'departure', plural: 'departures' },
]

/** "2 trades · 8 picks · 3 signings · 1 release"; a kind with zero entries is left out. */
export function summarizeCounts(entries: Transaction[]): string {
  const parts: string[] = []
  for (const group of COUNT_GROUPS) {
    const n = entries.filter((e) => group.match(e.kind)).length
    if (n > 0) parts.push(`${n} ${n === 1 ? group.singular : group.plural}`)
  }
  return parts.join(' · ')
}

export interface RatingChange {
  /** Rounded consensus ovr at the moment of the move; undefined for backfilled entries. */
  then?: number
  /** Rounded current consensus ovr; undefined when the player has no scouting record. */
  now: number
}

/** "Then -> now" for one player in a move. Returns undefined when there is no "now" to show. */
export function ratingFor(
  state: LeagueState,
  playerId: PlayerId,
  ovrAtMove: Record<string, number>,
): RatingChange | undefined {
  const now = state.scouting[playerId]?.ovr
  if (now == null) return undefined
  const rawThen = ovrAtMove[playerId]
  return rawThen == null
    ? { now: Math.round(now) }
    : { then: Math.round(rawThen), now: Math.round(now) }
}

/** The DraftPick that a traded-for pick reference has since become, if it has been used. */
export function pickUsedAs(
  state: LeagueState,
  pick: Pick<PickRef, 'season' | 'round' | 'originalTeam' | 'pick'>,
): DraftPick | undefined {
  return state.picks.find(
    (p) =>
      p.season === pick.season &&
      p.round === pick.round &&
      p.originalTeam === pick.originalTeam &&
      (pick.pick == null || p.pick === pick.pick) &&
      p.playerId != null,
  )
}
