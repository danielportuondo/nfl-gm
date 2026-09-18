/**
 * engine/draft — PHASE 2 SCAFFOLD. draft-ai (3A) replaces this file per contracts/engine/draft.ts and HANDOFF §6.4.
 *
 * Implements only what league.newGame needs: pick ownership for the next two drafts, plus the read-only
 * room view. Everything else keeps its NotImplementedError stub.
 */
import {
  TEAM_IDS, draftStub, isInHistory, SeasonNotLoadedError,
  type DraftModule, type DraftPick, type EngineContext, type LeagueState, type Season, type TeamId,
} from '@contracts/index'

const ROUNDS = 7

/** Worst record first, using last season's standings when available (in-game order is settled at DRAFT time by 3A). */
function proceduralTeamOrder(state: LeagueState): TeamId[] {
  const last = state.history[state.history.length - 1]
  if (!last) return [...TEAM_IDS]
  const rank = new Map(last.standings.map((row) => [row.teamId, row]))
  return [...TEAM_IDS].sort((a, b) => {
    const ra = rank.get(a)
    const rb = rank.get(b)
    if (!ra || !rb) return a.localeCompare(b)
    return ra.pct - rb.pct || ra.pointsFor - ra.pointsAgainst - (rb.pointsFor - rb.pointsAgainst) || a.localeCompare(b)
  })
}

function buildDraftOrder(state: LeagueState, season: Season, ctx: EngineContext): DraftPick[] {
  const owned = new Map(state.picks.filter((p) => p.season === season).map((p) => [`${p.round}:${p.originalTeam}`, p]))
  const ownerOf = (round: number, originalTeam: TeamId, fallback: TeamId): TeamId =>
    owned.get(`${round}:${originalTeam}`)?.owner ?? fallback

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

  const teams = proceduralTeamOrder(state)
  const picks: DraftPick[] = []
  for (let round = 1; round <= ROUNDS; round++) {
    for (const teamId of teams) {
      picks.push({ season, round, pick: null, originalTeam: teamId, owner: ownerOf(round, teamId, teamId), playerId: null })
    }
  }
  return picks
}

export const draft: DraftModule = {
  ...draftStub,
  buildDraftOrder,
  room: (state) => state.draftRoom,
}
