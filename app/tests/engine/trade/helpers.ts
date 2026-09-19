/**
 * Hand-built trade scenarios. `putPlayer` swaps a synthetic player in for the last man on a roster
 * so team sizes stay at the legal 53 and only the asset under test varies.
 */
import {
  type EngineContext,
  type LeagueState,
  type PickRef,
  type Player,
  type PlayerId,
  type Position,
  type RosterSlot,
  type TeamId,
  type TradeProposal,
} from '@contracts/index'
import { makeFakeContext } from '../fakes'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'

export const SEASON = 2015
export const USER: TeamId = 'IND'
export const AI: TeamId = 'DAL'

export interface PlayerSpec {
  id: string
  pos: Position
  ovr: number
  pot?: number
  age?: number
  apy?: number
  years?: number
  injuredWeeks?: number
}

export function scenario(): { state: LeagueState; ctx: EngineContext } {
  const opts = { seed: 'trade-scenarios', season: SEASON, userTeam: USER }
  return { state: mockLeague(opts), ctx: makeFakeContext(mockBundle(opts)) }
}

function slotFor(state: LeagueState, teamId: TeamId, spec: PlayerSpec): RosterSlot {
  const slot: RosterSlot = {
    playerId: spec.id,
    teamId,
    contract: {
      years: spec.years ?? 2,
      apy: spec.apy ?? 4,
      guaranteedPct: 0.5,
      signedSeason: state.season,
      rookie: false,
    },
  }
  if (spec.injuredWeeks)
    slot.injured = { weeksOut: spec.injuredWeeks, kind: 'knee', season: state.season, week: 4 }
  return slot
}

/** Replace the last player on `teamId`'s roster with a synthetic one built to spec. */
export function putPlayer(state: LeagueState, teamId: TeamId, spec: PlayerSpec): LeagueState {
  const team = state.teams[teamId]!
  const dropped = team.roster[team.roster.length - 1]!
  const droppedPos = state.players[dropped.playerId]!.pos
  const age = spec.age ?? 26
  const player: Player = {
    id: spec.id,
    name: spec.id,
    pos: spec.pos,
    birthYear: state.season - age,
    draft: null,
    real: false,
    rookieSeason: state.season - Math.max(0, age - 22),
  }
  const depthChart = {
    ...team.depthChart,
    [droppedPos]: (team.depthChart[droppedPos] ?? []).filter((id) => id !== dropped.playerId),
  }
  depthChart[spec.pos] = [...(depthChart[spec.pos] ?? []), spec.id]
  return {
    ...state,
    players: { ...state.players, [spec.id]: player },
    scouting: {
      ...state.scouting,
      [spec.id]: { ovr: spec.ovr, pot: spec.pot ?? spec.ovr, confidence: 0.8 },
    },
    teams: {
      ...state.teams,
      [teamId]: {
        ...team,
        roster: [...team.roster.slice(0, -1), slotFor(state, teamId, spec)],
        depthChart,
      },
    },
  }
}

/** Cut the roster down so the team has room to take a player on. */
export function trimRoster(state: LeagueState, teamId: TeamId, size: number): LeagueState {
  const team = state.teams[teamId]!
  const kept = team.roster.slice(0, size)
  const keptIds = new Set(kept.map((r) => r.playerId))
  const depthChart = Object.fromEntries(
    Object.entries(team.depthChart).map(([pos, ids]) => [
      pos,
      (ids ?? []).filter((id) => keptIds.has(id)),
    ]),
  )
  return { ...state, teams: { ...state.teams, [teamId]: { ...team, roster: kept, depthChart } } }
}

/** Hand `count` picks of `round` to `teamId`, and return their refs. */
export function giftPicks(
  state: LeagueState,
  teamId: TeamId,
  round: number,
  count: number,
): { state: LeagueState; refs: PickRef[] } {
  const refs: PickRef[] = []
  const picks = state.picks.map((pick) => {
    if (refs.length >= count || pick.round !== round || pick.owner === teamId || pick.playerId)
      return pick
    refs.push({ season: pick.season, round: pick.round, originalTeam: pick.originalTeam })
    return { ...pick, owner: teamId }
  })
  return { state: { ...state, picks }, refs }
}

/** Hand the pick at a specific overall slot to `teamId` — the way to get a LATE first. */
export function giftPickAt(
  state: LeagueState,
  teamId: TeamId,
  overall: number,
): { state: LeagueState; ref: PickRef } {
  const pick = state.picks.find((p) => p.pick === overall && !p.playerId)
  if (!pick) throw new Error(`no pick at overall ${overall}`)
  const ref: PickRef = { season: pick.season, round: pick.round, originalTeam: pick.originalTeam }
  const picks = state.picks.map((p) => (p === pick ? { ...p, owner: teamId } : p))
  return { state: { ...state, picks }, ref }
}

export function pickOwnedBy(state: LeagueState, teamId: TeamId, round: number): PickRef {
  const pick = state.picks.find((p) => p.owner === teamId && p.round === round && !p.playerId)
  if (!pick) throw new Error(`no round-${round} pick owned by ${teamId}`)
  return { season: pick.season, round: pick.round, originalTeam: pick.originalTeam }
}

/**
 * A draft room with the user on the clock, built here rather than through `draft.startDraft` so the
 * scenario does not depend on which season chunk that module happens to read.
 */
export function draftRoomOnUserClock(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = state.season + 1
  const order = state.picks
    .filter((p) => p.season === season)
    .slice()
    .sort((a, b) => a.round - b.round || a.originalTeam.localeCompare(b.originalTeam))
    .map((pick, i) => ({ ...pick, pick: i + 1 }))
  const prospects = (ctx.seasonData(state.season)?.draft.prospects ?? []).slice(0, 8)
  const players = { ...state.players }
  const scouting = { ...state.scouting }
  for (const prospect of prospects) {
    players[prospect.id] = { ...prospect }
    scouting[prospect.id] = prospect.scouting
  }
  const currentPickIndex = order.findIndex((pick) => pick.owner === state.userTeam)
  return {
    ...state,
    players,
    scouting,
    draftRoom: {
      season,
      status: 'ON_CLOCK',
      currentPickIndex,
      order,
      available: prospects.map((p) => p.id),
      udfaPool: [],
      log: [],
      pendingOffers: [],
    },
  }
}

export function userProposal(
  state: LeagueState,
  gives: { players?: PlayerId[]; picks?: PickRef[] },
  wants: { players?: PlayerId[]; picks?: PickRef[] },
  counterparty: TeamId = AI,
): TradeProposal {
  return {
    id: 'test-proposal',
    offer: { teamId: state.userTeam, players: gives.players ?? [], picks: gives.picks ?? [] },
    request: { teamId: counterparty, players: wants.players ?? [], picks: wants.picks ?? [] },
    initiatedBy: 'USER',
    season: state.season,
    week: state.week,
  }
}

export const STARTER: PlayerSpec = { id: 'x-starter', pos: 'WR', ovr: 78, age: 26, apy: 5 }
export const ELITE: PlayerSpec = { id: 'x-elite', pos: 'WR', ovr: 92, pot: 95, age: 25, apy: 2 }
export const SCRUB: PlayerSpec = { id: 'x-scrub', pos: 'WR', ovr: 50, age: 29, apy: 0.5 }
