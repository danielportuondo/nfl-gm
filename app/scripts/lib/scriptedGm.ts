/**
 * Scripted GM for the headless harness (HANDOFF §7 Phase 4 step 2): the simplest policy that keeps a
 * franchise legal for years — re-sign the good expiring players it can afford, draft best-available by
 * consensus, fill needs from the market, cut to 53 under the cap. It never trades and never reads truth.
 * Every move goes through the same module calls the store makes, so the harness exercises the user path.
 */
import {
  STARTER_TEMPLATE,
  type Contract,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Position,
  type RosterSlot,
  type TeamId,
} from '../../src/contracts/index'
import { faConstants } from '../../src/engine/fa/constants'

export interface OffseasonLog {
  resigned: PlayerId[]
  expired: PlayerId[]
  drafted: { round: number; pick: number; playerId: PlayerId }[]
  signed: PlayerId[]
  cut: PlayerId[]
  /** Free-agency funnel, for the report: pool size → offers made → accepted. */
  faPool: number
  faOffers: number
}

const policy = {
  resignMinOvr: 68,
  faMinOvr: 60,
  faRosterTarget: 62,
  faCapReserve: 0.02,
  cutSize: 53,
  cutMinSize: 46,
}

const ovrOf = (state: LeagueState, id: PlayerId): number => state.scouting[id]?.ovr ?? 40
const potOf = (state: LeagueState, id: PlayerId): number =>
  state.scouting[id]?.pot ?? ovrOf(state, id)
const posOf = (state: LeagueState, id: PlayerId): Position | undefined => state.players[id]?.pos
const roster = (state: LeagueState, teamId: TeamId): RosterSlot[] =>
  state.teams[teamId]?.roster ?? []

function veteranContract(state: LeagueState, playerId: PlayerId, apy: number): Contract {
  const age = state.season - (state.players[playerId]?.birthYear ?? state.season - 27)
  const years = age <= 26 ? 4 : age <= 30 ? 3 : 2
  return { years, apy, guaranteedPct: 0.5, signedSeason: state.season, rookie: false }
}

function positionCounts(state: LeagueState, teamId: TeamId): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const slot of roster(state, teamId)) {
    const pos = posOf(state, slot.playerId)
    if (pos) counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}

/** OFFSEASON_RESIGN: keep expiring starters at their ask while the cap allows; the rest walk. */
export function userResign(state: LeagueState, ctx: EngineContext, log: OffseasonLog): LeagueState {
  const { fa } = ctx.modules
  let s = state
  const expiring = roster(s, s.userTeam)
    .filter((slot) => slot.contract.years === 1)
    .map((slot) => slot.playerId)
    .sort((a, b) => ovrOf(s, b) - ovrOf(s, a) || a.localeCompare(b))
  for (const id of expiring) {
    if (ovrOf(s, id) < policy.resignMinOvr) {
      log.expired.push(id)
      continue
    }
    const ask = fa.resignAsk(s, id, ctx)
    const current = roster(s, s.userTeam).find((r) => r.playerId === id)!.contract.apy
    if (fa.capSpace(s, s.userTeam, ctx) + current - ask < 0) {
      log.expired.push(id)
      continue
    }
    s = fa.resign(s, id, veteranContract(s, id, ask), ctx)
    log.resigned.push(id)
  }
  return s
}

/** DRAFT: whenever the user is on the clock, take the best available by consensus potential. */
export function userDraft(state: LeagueState, ctx: EngineContext, log: OffseasonLog): LeagueState {
  const { draft } = ctx.modules
  let s = state
  for (let guard = 0; guard < 400; guard++) {
    const room = s.draftRoom
    if (!room || room.status === 'COMPLETE') return s
    const slot = room.order[room.currentPickIndex]
    if (!slot) return s
    if (slot.owner !== s.userTeam) {
      s = draft.advance(s, ctx)
      continue
    }
    const best = [...room.available].sort(
      (a, b) => potOf(s, b) - potOf(s, a) || ovrOf(s, b) - ovrOf(s, a) || a.localeCompare(b),
    )[0]
    if (!best) return draft.autoDraftToEnd(s, ctx)
    s = draft.userPick(s, best, ctx)
    const made = s.draftRoom!.log[s.draftRoom!.log.length - 1]!
    log.drafted.push({ round: made.round, pick: made.pick, playerId: best })
    s = draft.advance(s, ctx)
  }
  throw new Error('scriptedGm.userDraft: draft did not finish')
}

/** FREE_AGENCY: offer the ask to the best free agents at positions below the starter template, then depth. */
export function userFreeAgency(
  state: LeagueState,
  ctx: EngineContext,
  log: OffseasonLog,
): LeagueState {
  const { fa, rng } = ctx.modules
  let s = state
  const cap = fa.capFor(s.season, ctx)
  const rngRoot = rng.fromSeed(s.seed, s.season, 'scriptedGm', 'fa')
  const pool = fa.freeAgentPool(s)
  log.faPool = pool.length
  for (const id of pool) {
    const size = roster(s, s.userTeam).length
    if (size >= policy.faRosterTarget) break
    const pos = posOf(s, id)
    if (!pos) continue
    const counts = positionCounts(s, s.userTeam)
    const need = (counts[pos] ?? 0) < (STARTER_TEMPLATE[pos] ?? 0) + 1
    // Short of 53 anyone will do; beyond it only starters-template needs and real upgrades.
    if (size >= policy.cutSize && (!need || ovrOf(s, id) < policy.faMinOvr)) continue
    const ask = fa.resignAsk(s, id, ctx)
    if (fa.payroll(s, s.userTeam) + ask > cap * (1 - policy.faCapReserve)) continue
    log.faOffers++
    const result = fa.offer(s, s.userTeam, id, veteranContract(s, id, ask), ctx, rngRoot.fork(id))
    if (result.accepted) {
      s = result.state
      log.signed.push(id)
    }
  }
  return s
}

/** Players who can go without dropping a position below the starter template. */
function cutCandidates(state: LeagueState): RosterSlot[] {
  const counts = positionCounts(state, state.userTeam)
  return roster(state, state.userTeam).filter((slot) => {
    const pos = posOf(state, slot.playerId)
    return pos !== undefined && (counts[pos] ?? 0) > (STARTER_TEMPLATE[pos] ?? 0)
  })
}

/**
 * PRESEASON: down to 53 by consensus value, then under the cap by most net savings per rating point;
 * a roster left short by retirements (they land at the rollover, after free agency closed) signs the
 * best unsigned players it can afford back up to 53.
 */
export function userCutdowns(
  state: LeagueState,
  ctx: EngineContext,
  log: OffseasonLog,
): LeagueState {
  const { fa, league, rng } = ctx.modules
  let s = state
  const cap = fa.capFor(s.season, ctx)
  for (let guard = 0; guard < 200 && roster(s, s.userTeam).length > policy.cutSize; guard++) {
    const worst = cutCandidates(s).sort(
      (a, b) => ovrOf(s, a.playerId) - ovrOf(s, b.playerId) || a.playerId.localeCompare(b.playerId),
    )[0]
    if (!worst) break
    s = fa.release(s, s.userTeam, worst.playerId, ctx)
    log.cut.push(worst.playerId)
  }
  const netSavings = (slot: RosterSlot): number => {
    const c = slot.contract
    return c.apy - c.apy * c.years * c.guaranteedPct * faConstants.deadMoneyPct
  }
  const savingsPerPoint = (slot: RosterSlot): number =>
    netSavings(slot) / Math.max(1, ovrOf(s, slot.playerId) - 40)
  for (
    let guard = 0;
    guard < 200 &&
    fa.payroll(s, s.userTeam) > cap &&
    roster(s, s.userTeam).length > policy.cutMinSize;
    guard++
  ) {
    const worst = cutCandidates(s)
      .filter((slot) => netSavings(slot) > 0)
      .sort(
        (a, b) => savingsPerPoint(b) - savingsPerPoint(a) || a.playerId.localeCompare(b.playerId),
      )[0]
    if (!worst) break
    s = fa.release(s, s.userTeam, worst.playerId, ctx)
    log.cut.push(worst.playerId)
  }
  const fillRng = rng.fromSeed(s.seed, s.season, 'scriptedGm', 'preseasonFill')
  for (let guard = 0; guard < 200 && roster(s, s.userTeam).length < policy.cutSize; guard++) {
    let progressed = false
    for (const id of fa.freeAgentPool(s)) {
      if (roster(s, s.userTeam).length >= policy.cutSize) break
      if (!posOf(s, id)) continue
      const ask = fa.resignAsk(s, id, ctx)
      if (fa.payroll(s, s.userTeam) + ask > cap) continue
      log.faOffers++
      const result = fa.offer(
        s,
        s.userTeam,
        id,
        veteranContract(s, id, ask),
        ctx,
        fillRng.fork(`${guard}:${id}`),
      )
      if (result.accepted) {
        s = result.state
        log.signed.push(id)
        progressed = true
      }
    }
    if (roster(s, s.userTeam).length >= policy.cutSize || progressed) continue
    // Capped out and still short: shed the worst contract to make room for minimum-salary bodies.
    const shed = cutCandidates(s)
      .filter((slot) => netSavings(slot) > 0)
      .sort(
        (a, b) => savingsPerPoint(b) - savingsPerPoint(a) || a.playerId.localeCompare(b.playerId),
      )[0]
    if (!shed) break
    s = fa.release(s, s.userTeam, shed.playerId, ctx)
    log.cut.push(shed.playerId)
  }
  const team = s.teams[s.userTeam]!
  return {
    ...s,
    teams: {
      ...s.teams,
      [s.userTeam]: { ...team, depthChart: league.autoDepthChart(s, s.userTeam) },
    },
  }
}

export function emptyLog(): OffseasonLog {
  return { resigned: [], expired: [], drafted: [], signed: [], cut: [], faPool: 0, faOffers: 0 }
}
