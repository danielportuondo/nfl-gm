/**
 * Draft order (§6.4). In history: the real order from the season chunk (comp and traded picks as they
 * happened) with ownership overridden by in-game trades already recorded in state.picks. Post-history:
 * reverse standings with playoff ordering, 7 × 32, no comp picks. `pick` stays null until the draft
 * actually starts, because the previous season's standings are what settle it.
 */
import {
  TEAM_IDS, isInHistory, SeasonNotLoadedError,
  type DraftPick, type EngineContext, type LeagueState, type PlayerId, type Season, type StandingRow, type TeamId,
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

export function buildOrder(state: LeagueState, season: Season, ctx: EngineContext): DraftPick[] {
  const owned = new Map(
    state.picks.filter((p) => p.season === season).map((p) => [ownerKey(p.round, p.originalTeam), p]),
  )
  const ownerOf = (round: number, originalTeam: TeamId, fallback: TeamId): TeamId =>
    owned.get(ownerKey(round, originalTeam))?.owner ?? fallback

  if (isInHistory(ctx, season)) {
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

  const teams = draftTeamOrder(state)
  const picks: DraftPick[] = []
  for (let round = 1; round <= draftConstants.rounds; round++) {
    for (const teamId of teams) {
      picks.push({
        season,
        round,
        pick: null,
        originalTeam: teamId,
        owner: ownerOf(round, teamId, teamId),
        playerId: null,
      })
    }
  }
  return picks
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
        (slot.get(a.originalTeam) ?? TEAM_IDS.length) - (slot.get(b.originalTeam) ?? TEAM_IDS.length) ||
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
