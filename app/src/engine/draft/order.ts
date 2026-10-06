/**
 * Draft order (§6.4). The opening draft — the startSeason class of a game that opens at DRAFT — is the
 * real order from the season chunk (comp and traded picks as they happened), because no sim season
 * precedes it. Every later draft, in history or not, follows the previous SIM season: reverse standings
 * with playoff ordering, 7 × 32, no comp picks, ownership moved only by in-game trades in state.picks.
 * `pick` stays null until the draft actually starts, because those standings are what settle it.
 */
import {
  TEAM_IDS,
  isInHistory,
  SeasonNotLoadedError,
  type DraftPick,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Season,
  type StandingRow,
  type TeamId,
} from '@contracts/index'
import { draftConstants } from './constants'

/** Worst record first; playoff teams behind everyone else, champion last (comp picks omitted in v1). */
export function draftTeamOrder(state: LeagueState): TeamId[] {
  const last = state.history[state.history.length - 1]
  if (!last) return [...TEAM_IDS]
  const rows = new Map<TeamId, StandingRow>(last.standings.map((row) => [row.teamId, row]))
  const group = (id: TeamId): number => {
    if (id === last.champion) return 3
    if (id === last.runnerUp) return 2
    const clinched = rows.get(id)?.clinched
    return clinched && clinched !== 'OUT' ? 1 : 0
  }
  const diff = (id: TeamId): number => {
    const row = rows.get(id)
    return row ? row.pointsFor - row.pointsAgainst : 0
  }
  return [...TEAM_IDS].sort(
    (a, b) =>
      group(a) - group(b) ||
      (rows.get(a)?.pct ?? 0) - (rows.get(b)?.pct ?? 0) ||
      diff(a) - diff(b) ||
      a.localeCompare(b),
  )
}

const ownerKey = (round: number, originalTeam: TeamId): string => `${round}:${originalTeam}`

/** Only the opening draft has no sim season before it; a PRESEASON-start game never holds startSeason picks. */
export const isOpeningDraft = (state: LeagueState, season: Season): boolean =>
  season === state.startSeason

function ownRoundPicks(
  season: Season,
  ownerOf: (round: number, team: TeamId) => TeamId,
): DraftPick[] {
  const picks: DraftPick[] = []
  for (let round = 1; round <= draftConstants.rounds; round++) {
    for (const teamId of TEAM_IDS) {
      picks.push({
        season,
        round,
        pick: null,
        originalTeam: teamId,
        owner: ownerOf(round, teamId),
        playerId: null,
      })
    }
  }
  return picks
}

export function buildOrder(state: LeagueState, season: Season, ctx: EngineContext): DraftPick[] {
  const owned = new Map(
    state.picks
      .filter((p) => p.season === season)
      .map((p) => [ownerKey(p.round, p.originalTeam), p]),
  )
  const ownerOf = (round: number, originalTeam: TeamId, fallback: TeamId): TeamId =>
    owned.get(ownerKey(round, originalTeam))?.owner ?? fallback

  if (isOpeningDraft(state, season) && isInHistory(ctx, season)) {
    const sd = ctx.seasonData(season)
    if (!sd) throw new SeasonNotLoadedError(season)
    return sd.draft.order.map((entry) => ({
      season,
      round: entry.round,
      pick: entry.pick,
      originalTeam: entry.originalTeam,
      owner: ownerOf(entry.round, entry.originalTeam, entry.team),
      playerId: null,
    }))
  }

  return ownRoundPicks(season, (round, teamId) => ownerOf(round, teamId, teamId))
}

/**
 * A non-opening draft's picks as 7 × 32 unnumbered own-round picks. Idempotent on picks built by
 * buildOrder; it exists for saves made before the sim-order rule, which hold later in-history drafts
 * in their real-life shape (real numbers, comp picks, the selecting team as originalTeam). Those keep
 * one owner per round/team — an in-game trade (owner ≠ originalTeam) over the untouched entry, since
 * the real data never encodes a traded pick that way — and lose their comp and extra traded picks.
 */
export function simOrderPicks(picks: readonly DraftPick[], season: Season): DraftPick[] {
  const owners = new Map<string, TeamId>()
  const byNumber = [...picks]
    .filter((p) => p.season === season)
    .sort((a, b) => (a.pick ?? 0) - (b.pick ?? 0))
  for (const p of byNumber) {
    const key = ownerKey(p.round, p.originalTeam)
    const current = owners.get(key)
    if (current === undefined || (current === p.originalTeam && p.owner !== p.originalTeam))
      owners.set(key, p.owner)
  }
  return ownRoundPicks(season, (round, teamId) => owners.get(ownerKey(round, teamId)) ?? teamId)
}

/**
 * The room's `order`: this season's picks from state.picks, pick numbers settled from last season's
 * standings when the order was generated with `pick: null`.
 */
export function settleOrder(picks: readonly DraftPick[], state: LeagueState): DraftPick[] {
  const mine = picks.filter((p) => p.pick !== null)
  const unsettled = picks.filter((p) => p.pick === null)
  const settled: DraftPick[] = mine.map((p) => ({ ...p }))

  if (unsettled.length > 0) {
    const slot = new Map(draftTeamOrder(state).map((id, i) => [id, i]))
    const byRound = [...unsettled].sort(
      (a, b) =>
        a.round - b.round ||
        (slot.get(a.originalTeam) ?? TEAM_IDS.length) -
          (slot.get(b.originalTeam) ?? TEAM_IDS.length) ||
        a.originalTeam.localeCompare(b.originalTeam),
    )
    let next = settled.length > 0 ? Math.max(...settled.map((p) => p.pick ?? 0)) + 1 : 1
    for (const p of byRound) settled.push({ ...p, pick: next++ })
  }

  return settled.sort((a, b) => (a.pick ?? 0) - (b.pick ?? 0))
}

/** Who the slot really went to in real life, by overall pick number. Empty outside history. */
export function historicalOccupants(season: Season, ctx: EngineContext): Map<number, PlayerId> {
  const map = new Map<number, PlayerId>()
  if (!isInHistory(ctx, season)) return map
  const sd = ctx.seasonData(season)
  if (!sd) throw new SeasonNotLoadedError(season)
  for (const entry of sd.draft.order) if (entry.playerId) map.set(entry.pick, entry.playerId)
  return map
}
