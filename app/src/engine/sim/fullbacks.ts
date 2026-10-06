import type { EngineContext, LeagueState, PlayerId, Season, SeasonData } from '@contracts/index'

const taggedInChunk = new WeakMap<SeasonData, ReadonlySet<PlayerId>>()

/**
 * Fullbacks tagged in the season chunk. Fallback for players whose `role` did not survive into
 * `state.players` (the league/history/draft player builders copy a fixed field list).
 */
function chunkFullbacks(ctx: EngineContext, season: Season): ReadonlySet<PlayerId> {
  let chunk: SeasonData | undefined
  try {
    chunk = ctx.seasonData(season)
  } catch {
    return new Set()
  }
  if (!chunk) return new Set()
  let ids = taggedInChunk.get(chunk)
  if (!ids) {
    ids = new Set(chunk.players.players.filter((p) => p.role === 'FB').map((p) => p.id))
    taggedInChunk.set(chunk, ids)
  }
  return ids
}

/** The fullbacks among `backs` (all listed at RB): they block and catch, they do not carry the load. */
export function fullbacksAmong(
  state: LeagueState,
  ctx: EngineContext,
  backs: readonly PlayerId[],
): ReadonlySet<PlayerId> {
  const tagged = chunkFullbacks(ctx, state.season)
  return new Set(backs.filter((id) => state.players[id]?.role === 'FB' || tagged.has(id)))
}
