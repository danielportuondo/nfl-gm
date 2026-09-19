/**
 * The draft pool (§6.4). In history: the real class + real UDFAs from the season chunk. Post-history:
 * lifecycle.generateDraftClass.
 *
 * `copyRealTruth` is the ONLY function in engine/draft that touches trajectories or state.truth — it
 * seeds the hidden career of a real prospect exactly as league.newGame does for veterans. No picking,
 * ranking or need code below may read either.
 */
import {
  isInHistory,
  SeasonNotLoadedError,
  type CompactTrajectory,
  type EngineContext,
  type LeagueState,
  type Player,
  type PlayerId,
  type Prospect,
  type ScoutingView,
  type Season,
  type TrajectoryTable,
  type TrueTrajectory,
} from '@contracts/index'

/** Season S's DRAFT phase drafts the S+1 class. */
export const draftSeasonOf = (state: LeagueState): Season => state.season + 1

function compactToTrajectory(
  compact: CompactTrajectory,
  fallbackSeason: Season,
  fallback: number,
): TrueTrajectory {
  const bySeason: Record<string, number> = {}
  compact.values.forEach((v, i) => {
    if (v !== null) bySeason[String(compact.start + i)] = v
  })
  if (Object.keys(bySeason).length === 0) bySeason[String(fallbackSeason)] = fallback
  return { bySeason, retiresAfter: compact.retiresAfter }
}

/** HIDDEN-DATA BOUNDARY: real prospects' true careers come from the trajectory table. */
function copyRealTruth(
  prospects: readonly Prospect[],
  trajectories: TrajectoryTable,
  season: Season,
): Record<PlayerId, TrueTrajectory> {
  const truth: Record<PlayerId, TrueTrajectory> = {}
  for (const p of prospects) {
    const compact = trajectories[p.id]
    truth[p.id] = compact
      ? compactToTrajectory(compact, season, p.scouting.ovr)
      : { bySeason: { [String(season)]: p.scouting.ovr }, retiresAfter: season }
  }
  return truth
}

/** Prospects enter state undrafted: `draft` is filled in by the pick that actually takes them. */
function asUndraftedPlayer(p: Prospect): Player {
  return {
    id: p.id,
    name: p.name,
    pos: p.pos,
    birthYear: p.birthYear,
    college: p.college,
    heightIn: p.heightIn,
    weightLb: p.weightLb,
    draft: null,
    real: p.real,
    rookieSeason: p.rookieSeason,
  }
}

function merge(
  state: LeagueState,
  prospects: readonly Prospect[],
  truth: Record<PlayerId, TrueTrajectory>,
): LeagueState {
  const missing = prospects.filter((p) => !state.players[p.id])
  if (missing.length === 0) return state

  const players: Record<PlayerId, Player> = { ...state.players }
  const scouting: Record<PlayerId, ScoutingView> = { ...state.scouting }
  const nextTruth: Record<PlayerId, TrueTrajectory> = { ...state.truth }
  for (const p of missing) {
    players[p.id] = asUndraftedPlayer(p)
    scouting[p.id] = p.scouting
    const t = truth[p.id]
    if (t) nextTruth[p.id] = t
  }
  return { ...state, players, scouting, truth: nextTruth }
}

/** Idempotent: adds only the class members that are not in state yet. */
export function loadClass(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = draftSeasonOf(state)
  if (isInHistory(ctx, season)) {
    const sd = ctx.seasonData(season)
    if (!sd) throw new SeasonNotLoadedError(season)
    return merge(
      state,
      sd.draft.prospects,
      copyRealTruth(sd.draft.prospects, ctx.trajectories, season),
    )
  }
  // lifecycle stamps ids and rookieSeason with state.season; the class being drafted is season S+1.
  const rng = ctx.modules.rng.fromSeed(state.seed, season, 'draftClass')
  const generated = ctx.modules.lifecycle.generateDraftClass({ ...state, season }, ctx, rng)
  return merge(state, generated.prospects, generated.truth)
}

/** Class members still unsigned, best consensus pot first. */
export function classBoard(state: LeagueState, season: Season): PlayerId[] {
  const rostered = new Set<PlayerId>()
  for (const teamId of Object.keys(state.teams).sort()) {
    for (const slot of state.teams[teamId]?.roster ?? []) rostered.add(slot.playerId)
  }
  const ids = Object.keys(state.players)
    .filter((id) => {
      const p = state.players[id]
      return p !== undefined && p.rookieSeason === season && p.draft === null && !rostered.has(id)
    })
    .sort()
  return sortByBoard(state, ids)
}

export function sortByBoard(state: LeagueState, ids: readonly PlayerId[]): PlayerId[] {
  return [...ids].sort((a, b) => {
    const sa = state.scouting[a]
    const sb = state.scouting[b]
    return (sb?.pot ?? 0) - (sa?.pot ?? 0) || (sb?.ovr ?? 0) - (sa?.ovr ?? 0) || a.localeCompare(b)
  })
}

/**
 * The room's board and its UDFA pool. Every class member is draftable — a real class has fewer
 * matched selections than picks, and in a redraft a team may well take someone who really went
 * undrafted — so `udfaPool` records who went undrafted in real life (or, post-history, who falls
 * below the last pick), and the UDFA phase signs from it plus whatever the board has left.
 */
export function splitBoard(
  state: LeagueState,
  ctx: EngineContext,
  season: Season,
  pickCount: number,
): { available: PlayerId[]; udfaPool: PlayerId[] } {
  const board = classBoard(state, season)
  if (isInHistory(ctx, season)) {
    const sd = ctx.seasonData(season)
    if (!sd) throw new SeasonNotLoadedError(season)
    const udfa = new Set(sd.draft.udfa)
    return { available: board, udfaPool: board.filter((id) => udfa.has(id)) }
  }
  return { available: board, udfaPool: board.slice(pickCount) }
}
