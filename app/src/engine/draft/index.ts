/**
 * engine/draft — draft order, history-anchored AI picking, the draft-room state machine and the UDFA
 * phase (HANDOFF §6.4). Implements DraftModule (contracts/engine/draft.ts).
 *
 * Draft-year convention: the draft held in season S's DRAFT phase is the S+1 class, so `DraftPick.season`,
 * `draftRoom.season` and the chunk read here are all S+1.
 *
 * The AI ranks by CONSENSUS ONLY. `prospects.ts#copyRealTruth` is the single place in this folder that
 * touches trajectories/state.truth, and it only seeds hidden careers when the class is loaded.
 *
 * Two deliberate readings of the contract, both noted in the Phase 3A report:
 *  - `advance({ auto: true })` resolves the user's slot through the same anchored AI logic rather than
 *    raw best-available, so an uninvolved user does not knock the draft off its historical rails.
 *  - `userPick` takes an optional third argument, the EngineContext: a rookie contract (fa) and a
 *    divergence mark (history) cannot be produced without it. Called without it, it throws.
 */
import {
  draftStub,
  type DraftLogEntry,
  type DraftModule,
  type DraftPick,
  type DraftRoomState,
  type EngineContext,
  type LeagueState,
  type NeedProfile,
  type PlayerId,
  type Rng,
  type Season,
  type TeamId,
  type TradeProposal,
} from '@contracts/index'
import { draftConstants } from './constants'
import { needProfile } from './needs'
import { buildOrder, historicalOccupants, settleOrder } from './order'
import { chooseProspect } from './picking'
import { draftSeasonOf, loadClass, splitBoard } from './prospects'
import { runUdfaPhase } from './udfa'

function roomOf(state: LeagueState, what: string): DraftRoomState {
  const room = state.draftRoom
  if (!room) throw new Error(`draft.${what}: no draft in progress`)
  return room
}

const withRoom = (state: LeagueState, room: DraftRoomState): LeagueState => ({
  ...state,
  draftRoom: room,
})

function currentSlot(room: DraftRoomState): DraftPick | undefined {
  return room.order[room.currentPickIndex]
}

/** Procedural seasons are generated with `pick: null`; once the room settles the order, state.picks learns the numbers. */
function stampPickNumbers(picks: readonly DraftPick[], order: readonly DraftPick[]): DraftPick[] {
  const season = order[0]?.season
  if (season === undefined) return [...picks]
  const numbered = new Map(order.map((slot) => [`${slot.round}:${slot.originalTeam}`, slot.pick]))
  return picks.map((p) =>
    p.season === season && p.pick === null
      ? { ...p, pick: numbered.get(`${p.round}:${p.originalTeam}`) ?? null }
      : p,
  )
}

/** A mid-draft trade changes state.picks; unmade slots must follow the new owner. */
function syncOwners(state: LeagueState, room: DraftRoomState): DraftRoomState {
  // Keyed by pick number so a compensatory pick and the team's own pick in that round stay apart.
  const slotKey = (p: DraftPick): string =>
    p.pick === null ? `${p.round}:${p.originalTeam}` : `#${p.pick}`
  const owners = new Map<string, TeamId>()
  for (const p of state.picks) {
    if (p.season === room.season) owners.set(slotKey(p), p.owner)
  }
  let changed = false
  const order = room.order.map((slot) => {
    if (slot.playerId !== null) return slot
    const owner = owners.get(slotKey(slot))
    if (owner === undefined || owner === slot.owner) return slot
    changed = true
    return { ...slot, owner }
  })
  return changed ? { ...room, order } : room
}

/**
 * Stamp the player onto exactly one entry of state.picks — the slot's own pick number when it has one,
 * else the first unmade pick of that round/original team (a compensatory pick shares both).
 */
function fillPick(
  picks: readonly DraftPick[],
  slot: DraftPick,
  pickNumber: number,
  playerId: PlayerId,
): DraftPick[] {
  const matches = (p: DraftPick): boolean =>
    p.season === slot.season &&
    p.round === slot.round &&
    p.originalTeam === slot.originalTeam &&
    p.playerId === null
  let index = picks.findIndex((p) => matches(p) && p.pick === pickNumber)
  if (index < 0) index = picks.findIndex(matches)
  if (index < 0) return [...picks]
  return picks.map((p, i) => (i === index ? { ...p, pick: pickNumber, playerId } : p))
}

/** Make the pick at `currentPickIndex`: roster, contract, draft origin, log, board, next slot. */
function applySelection(
  state: LeagueState,
  ctx: EngineContext,
  playerId: PlayerId,
  anchors: Map<number, PlayerId>,
  opts: { explicitUserPick: boolean },
): LeagueState {
  const room = roomOf(state, 'advance')
  const index = room.currentPickIndex
  const slot = currentSlot(room)
  if (!slot) throw new Error('draft.advance: pick index past the end of the order')

  const pickNumber = slot.pick ?? index + 1
  const anchor = anchors.get(pickNumber) ?? null
  const historical = anchor !== null && anchor === playerId

  const team = state.teams[slot.owner]
  if (!team) throw new Error(`draft.advance: unknown team "${slot.owner}"`)
  const player = state.players[playerId]
  if (!player) throw new Error(`draft.advance: unknown player "${playerId}"`)

  const contract = ctx.modules.fa.rookieContract(
    { round: slot.round, pick: pickNumber },
    room.season,
    ctx,
  )
  const entry: DraftLogEntry = {
    pick: pickNumber,
    round: slot.round,
    team: slot.owner,
    playerId,
    historical,
  }
  const nextIndex = index + 1

  const nextRoom: DraftRoomState = {
    ...room,
    order: room.order.map((p, i) => (i === index ? { ...p, pick: pickNumber, playerId } : p)),
    available: room.available.filter((id) => id !== playerId),
    udfaPool: room.udfaPool.filter((id) => id !== playerId),
    log: [...room.log, entry],
    currentPickIndex: nextIndex,
    status: nextIndex >= room.order.length ? 'COMPLETE' : 'ON_CLOCK',
    pendingOffers: [],
  }

  let next: LeagueState = {
    ...state,
    teams: {
      ...state.teams,
      [slot.owner]: {
        ...team,
        roster: [...team.roster, { playerId, teamId: slot.owner, contract }],
      },
    },
    players: {
      ...state.players,
      [playerId]: {
        ...player,
        draft: { season: room.season, round: slot.round, pick: pickNumber, team: slot.owner },
      },
    },
    picks: fillPick(state.picks, slot, pickNumber, playerId),
    freeAgents: state.freeAgents.filter((id) => id !== playerId),
    draftRoom: nextRoom,
  }

  // §6.8: a user pick puts both the player and the historical occupant of the slot off the rails.
  if (slot.owner === state.userTeam && (opts.explicitUserPick || !historical)) {
    const displaced = anchor !== null && anchor !== playerId ? [anchor] : []
    next = ctx.modules.history.markDiverged(next, [playerId, ...displaced])
  }
  return next
}

function offersFor(state: LeagueState, ctx: EngineContext, rng: Rng): TradeProposal[] {
  return ctx.modules.trade.generateAiOffers(state, ctx, rng, 'draft')
}

function advanceImpl(
  state: LeagueState,
  ctx: EngineContext,
  opts?: { auto?: boolean },
): LeagueState {
  let s = state
  const season = roomOf(s, 'advance').season
  const anchors = historicalOccupants(season, ctx)

  for (let guard = roomOf(s, 'advance').order.length + 1; guard >= 0; guard--) {
    const room = syncOwners(s, roomOf(s, 'advance'))
    s = withRoom(s, room)
    if (room.status === 'COMPLETE') return s

    const slot = currentSlot(room)
    if (!slot) return withRoom(s, { ...room, status: 'COMPLETE' })

    if (slot.owner === s.userTeam && !opts?.auto) {
      if (room.pendingOffers.length > 0) return s
      const offerRng = ctx.modules.rng.fromSeed(
        s.seed,
        season,
        'draftOffers',
        room.currentPickIndex,
      )
      return withRoom(s, { ...room, pendingOffers: offersFor(s, ctx, offerRng) })
    }

    const rng = ctx.modules.rng.fromSeed(s.seed, season, 'draft', room.currentPickIndex)
    const chosen = chooseProspect(s, ctx, rng, {
      teamId: slot.owner,
      season,
      round: slot.round,
      available: room.available,
      anchor: anchors.get(slot.pick ?? room.currentPickIndex + 1) ?? null,
    })
    s = applySelection(s, ctx, chosen, anchors, { explicitUserPick: false })
  }
  throw new Error('draft.advance: draft failed to terminate')
}

function startDraftImpl(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = draftSeasonOf(state)
  if (state.draftRoom && state.draftRoom.season === season) return advanceImpl(state, ctx, {})

  let s = loadClass(state, ctx)
  const seasonPicks = s.picks.filter((p) => p.season === season)
  const order = settleOrder(seasonPicks.length > 0 ? seasonPicks : buildOrder(s, season, ctx), s)
  s = { ...s, picks: stampPickNumbers(s.picks, order) }
  const { available, udfaPool } = splitBoard(s, ctx, season, order.length)

  s = withRoom(s, {
    season,
    status: order.length === 0 ? 'COMPLETE' : 'ON_CLOCK',
    currentPickIndex: 0,
    order,
    available,
    udfaPool,
    log: [],
    pendingOffers: [],
  })
  return advanceImpl(s, ctx, {})
}

function userPickImpl(state: LeagueState, playerId: PlayerId, ctx?: EngineContext): LeagueState {
  const room = roomOf(state, 'userPick')
  const slot = currentSlot(room)
  if (!slot) throw new Error('draft.userPick: the draft is over')
  if (slot.owner !== state.userTeam)
    throw new Error(`draft.userPick: ${slot.owner} is on the clock, not ${state.userTeam}`)
  if (!room.available.includes(playerId))
    throw new Error(`draft.userPick: "${playerId}" is not on the board`)
  if (!ctx)
    throw new Error(
      'draft.userPick: needs the EngineContext (rookie contract + divergence); see CONTRACT REQUESTS',
    )
  return applySelection(state, ctx, playerId, historicalOccupants(room.season, ctx), {
    explicitUserPick: true,
  })
}

function aiPickImpl(state: LeagueState, ctx: EngineContext, rng: Rng): PlayerId {
  const room = roomOf(state, 'aiPick')
  const slot = currentSlot(room)
  if (!slot) throw new Error('draft.aiPick: the draft is over')
  const anchors = historicalOccupants(room.season, ctx)
  return chooseProspect(state, ctx, rng, {
    teamId: slot.owner,
    season: room.season,
    round: slot.round,
    available: room.available,
    anchor: anchors.get(slot.pick ?? room.currentPickIndex + 1) ?? null,
  })
}

function autoDraftToEndImpl(state: LeagueState, ctx: EngineContext): LeagueState {
  const s = state.draftRoom ? state : startDraftImpl(state, ctx)
  return advanceImpl(s, ctx, { auto: true })
}

/** `userPick` widens the contract's 2-arg signature with the optional EngineContext (see the header). */
export const draft: DraftModule & { userPick: typeof userPickImpl } = {
  ...draftStub,
  buildDraftOrder: (state: LeagueState, season: Season, ctx: EngineContext): DraftPick[] =>
    buildOrder(state, season, ctx),
  loadProspects: loadClass,
  startDraft: startDraftImpl,
  aiPick: aiPickImpl,
  userPick: userPickImpl,
  advance: advanceImpl,
  autoDraftToEnd: autoDraftToEndImpl,
  runUdfa: (state: LeagueState, ctx: EngineContext, userSignings: PlayerId[]): LeagueState =>
    runUdfaPhase(state, ctx, userSignings),
  teamNeeds: (state: LeagueState, teamId: TeamId): NeedProfile => needProfile(state, teamId),
  offersForCurrentPick: offersFor,
  room: (state: LeagueState): DraftRoomState | null => state.draftRoom,
}

export { draftConstants }
