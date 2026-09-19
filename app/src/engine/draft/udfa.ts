/**
 * UDFA phase (§6.4): user signings first, then AI teams sign from the pool with the same anchored
 * logic — a real UDFA goes back to the team that really signed him when that is known, otherwise the
 * need-aware fallback fills rosters out. Everyone left over becomes a free agent.
 */
import {
  isInHistory,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Season,
  type TeamId,
} from '@contracts/index'
import { draftConstants, type DraftConstants } from './constants'
import { chooseProspect } from './picking'
import { sortByBoard } from './prospects'

function rosteredIds(state: LeagueState): Set<PlayerId> {
  const ids = new Set<PlayerId>()
  for (const teamId of Object.keys(state.teams).sort()) {
    for (const slot of state.teams[teamId]?.roster ?? []) ids.add(slot.playerId)
  }
  return ids
}

function sign(
  state: LeagueState,
  ctx: EngineContext,
  teamId: TeamId,
  playerId: PlayerId,
  season: Season,
): LeagueState {
  const team = state.teams[teamId]
  if (!team) throw new Error(`draft.runUdfa: unknown team "${teamId}"`)
  const contract = ctx.modules.fa.rookieContract(null, season, ctx)
  return {
    ...state,
    teams: {
      ...state.teams,
      [teamId]: { ...team, roster: [...team.roster, { playerId, teamId, contract }] },
    },
    freeAgents: state.freeAgents.filter((id) => id !== playerId),
  }
}

/** Where a real undrafted rookie actually ended up that season. Empty outside history. */
function realTeams(ctx: EngineContext, season: Season): Map<PlayerId, TeamId> {
  const map = new Map<PlayerId, TeamId>()
  if (!isInHistory(ctx, season)) return map
  const sd = ctx.seasonData(season)
  if (!sd) return map
  for (const p of sd.players.players) if (p.team) map.set(p.id, p.team)
  return map
}

const rosterSize = (state: LeagueState, teamId: TeamId): number =>
  state.teams[teamId]?.roster.length ?? 0

export function runUdfaPhase(
  state: LeagueState,
  ctx: EngineContext,
  userSignings: readonly PlayerId[],
  c: DraftConstants = draftConstants,
): LeagueState {
  const room = state.draftRoom
  if (!room) return state
  const season = room.season

  const rostered = rosteredIds(state)
  let pool = sortByBoard(
    state,
    [...new Set([...room.udfaPool, ...room.available])].filter((id) => !rostered.has(id)),
  )
  let s: LeagueState = state

  const take = (id: PlayerId): void => {
    pool = pool.filter((other) => other !== id)
  }

  for (const id of userSignings) {
    if (!pool.includes(id)) throw new Error(`draft.runUdfa: "${id}" is not in the UDFA pool`)
    if (rosterSize(s, s.userTeam) >= c.rosterMax) break
    s = sign(s, ctx, s.userTeam, id, season)
    s = ctx.modules.history.markDiverged(s, [id])
    take(id)
  }

  const anchors = realTeams(ctx, season)
  for (const id of [...pool]) {
    const teamId = anchors.get(id)
    if (!teamId || !s.teams[teamId] || teamId === s.userTeam) continue
    if (rosterSize(s, teamId) >= c.rosterMax) continue
    s = sign(s, ctx, teamId, id, season)
    take(id)
  }

  const fillable = Object.keys(s.teams)
    .filter((teamId) => teamId !== s.userTeam)
    .sort()
  let progressed = true
  while (pool.length > 0 && progressed) {
    progressed = false
    for (const teamId of [...fillable].sort(
      (a, b) => rosterSize(s, a) - rosterSize(s, b) || a.localeCompare(b),
    )) {
      if (pool.length === 0) break
      if (rosterSize(s, teamId) >= Math.min(c.udfaFillTo, c.rosterMax)) continue
      const rng = ctx.modules.rng.fromSeed(s.seed, season, 'udfa', teamId, pool.length)
      const id = chooseProspect(
        s,
        ctx,
        rng,
        { teamId, season, round: c.rounds, available: pool, anchor: null },
        c,
      )
      s = sign(s, ctx, teamId, id, season)
      take(id)
      progressed = true
    }
  }

  return {
    ...s,
    freeAgents: [...new Set([...s.freeAgents, ...pool])].sort(),
    draftRoom: null,
  }
}
