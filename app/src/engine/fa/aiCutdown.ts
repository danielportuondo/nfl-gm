/**
 * AI roster cutdown (fa.runAiCutdowns). Consensus value, contracts and the real opening-day roster only
 * — no truth. A player is only cut ahead of a better one at his position when he costs at least as much
 * cap. Size cuts take the lowest consensus ovr; cap cuts take backups before starters, then the most net
 * savings (apy minus the dead money the release books) per rating point. Players on the real opening-day
 * roster get a small ovr edge so cutdowns keep history anchoring. Position minimums, a lone K/P and
 * first-year round 1-3 rookies are protected until nothing else is left, because the roster and cap
 * limits are hard gates.
 */
import {
  ROSTER_TEMPLATE_53,
  STARTER_TEMPLATE,
  type Contract,
  type EngineContext,
  type LeagueState,
  type PlayerId,
  type Position,
  type RosterSlot,
  type Season,
  type TeamId,
} from '@contracts/index'
import { faConstants } from './constants'
import { capFor, deadChargeFor, payroll, releaseFrom } from './internal'

export interface AiCutdownDeps {
  rookieContract: (
    pick: { round: number; pick: number } | null,
    season: Season,
    ctx: EngineContext,
  ) => Contract
  synthesizeContract: (
    state: LeagueState,
    playerId: PlayerId,
    season: Season,
    ctx: EngineContext,
  ) => Contract
  freeAgentPool: (state: LeagueState) => PlayerId[]
  /** Real opening-day roster of `teamId` (in-history seasons), used only to break ties. */
  realRoster: (state: LeagueState, ctx: EngineContext, teamId: TeamId) => Set<PlayerId> | null
}

/** 0: all protections · 1: drop rookie protection · 2: only keep a starter-template body per position. */
type Relax = 0 | 1 | 2
const RELAX_LEVELS: readonly Relax[] = [0, 1, 2]

const posOf = (s: LeagueState, id: PlayerId): Position | undefined => s.players[id]?.pos
const ovrOf = (s: LeagueState, id: PlayerId): number => s.scouting[id]?.ovr ?? 40
const roster = (s: LeagueState, t: TeamId): RosterSlot[] => s.teams[t]?.roster ?? []
const netSavings = (slot: RosterSlot): number => slot.contract.apy - deadChargeFor(slot.contract)

function countByPos(s: LeagueState, slots: readonly RosterSlot[]): Map<Position, number> {
  const counts = new Map<Position, number>()
  for (const slot of slots) {
    const pos = posOf(s, slot.playerId)
    if (pos) counts.set(pos, (counts.get(pos) ?? 0) + 1)
  }
  return counts
}

function isProtectedRookie(s: LeagueState, id: PlayerId): boolean {
  const p = s.players[id]
  return (
    !!p?.draft &&
    p.draft.round <= faConstants.protectedRookieMaxRound &&
    p.rookieSeason === s.season
  )
}

function floorFor(pos: Position, relax: Relax): number {
  return relax >= 2 ? (STARTER_TEMPLATE[pos] ?? 1) : (faConstants.positionMinimums[pos] ?? 0)
}

function cuttableSlots(s: LeagueState, teamId: TeamId, relax: Relax): RosterSlot[] {
  const slots = roster(s, teamId)
  const counts = countByPos(s, slots)
  return slots.filter((slot) => {
    const pos = posOf(s, slot.playerId)
    if (!pos) return false
    if (relax === 0 && isProtectedRookie(s, slot.playerId)) return false
    return (counts.get(pos) ?? 0) > floorFor(pos, relax)
  })
}

function byOvrThenRealThenId(s: LeagueState, keep: Set<PlayerId> | null) {
  return (a: RosterSlot, b: RosterSlot): number =>
    ovrOf(s, a.playerId) - ovrOf(s, b.playerId) ||
    (keep?.has(a.playerId) ? 1 : 0) - (keep?.has(b.playerId) ? 1 : 0) ||
    a.playerId.localeCompare(b.playerId)
}

/** Consensus ovr plus the anchoring bonus for players on the team's real opening-day roster. */
function retentionOvr(s: LeagueState, slot: RosterSlot, keep: Set<PlayerId> | null): number {
  return ovrOf(s, slot.playerId) + (keep?.has(slot.playerId) ? faConstants.realRosterOvrBonus : 0)
}

/**
 * Drops a player when a worse player at his position costs at least as much cap and is just as cuttable:
 * keeping the better one is free, so the worse one goes first.
 */
function nonDominated(s: LeagueState, cands: readonly RosterSlot[]): RosterSlot[] {
  return cands.filter(
    (c) =>
      !cands.some(
        (k) =>
          posOf(s, k.playerId) === posOf(s, c.playerId) &&
          ovrOf(s, k.playerId) < ovrOf(s, c.playerId) &&
          k.contract.apy >= c.contract.apy,
      ),
  )
}

/** The next player to cut to reach the size limit: lowest consensus ovr among the non-dominated. */
function pickSizeCut(
  s: LeagueState,
  teamId: TeamId,
  keep: Set<PlayerId> | null,
): PlayerId | undefined {
  for (const relax of RELAX_LEVELS) {
    const cands = cuttableSlots(s, teamId, relax)
    if (cands.length === 0) continue
    const ordered = nonDominated(s, cands).sort(
      (a, b) =>
        retentionOvr(s, a, keep) - retentionOvr(s, b, keep) || a.playerId.localeCompare(b.playerId),
    )
    return ordered[0]?.playerId
  }
  return undefined
}

/**
 * The next player to cut for cap room: backups before starters, then the most net savings (apy minus the
 * dead money the release books) per rating point above 40. A player is passed over when a worse player at
 * his position costs at least as much cap and can be cut instead.
 */
function pickCapCut(
  s: LeagueState,
  teamId: TeamId,
  keep: Set<PlayerId> | null,
  minNetSavings: number,
): PlayerId | undefined {
  for (const relax of [0, 1] as const) {
    const cands = cuttableSlots(s, teamId, relax).filter((slot) => netSavings(slot) > minNetSavings)
    if (cands.length === 0) continue
    const slots = roster(s, teamId)
    const isStarter = (slot: RosterSlot): boolean => {
      const pos = posOf(s, slot.playerId)!
      const better = slots.filter(
        (o) => posOf(s, o.playerId) === pos && ovrOf(s, o.playerId) > ovrOf(s, slot.playerId),
      ).length
      return better < (STARTER_TEMPLATE[pos] ?? 1)
    }
    const pool = nonDominated(s, cands)
    const ratio = (slot: RosterSlot): number =>
      netSavings(slot) / Math.max(1, ovrOf(s, slot.playerId) - 40)
    const ranked = [...pool].sort(
      (a, b) =>
        (isStarter(a) ? 1 : 0) - (isStarter(b) ? 1 : 0) ||
        (keep?.has(a.playerId) ? 1 : 0) - (keep?.has(b.playerId) ? 1 : 0) ||
        ratio(b) - ratio(a) ||
        byOvrThenRealThenId(s, keep)(a, b),
    )
    if (ranked[0]) return ranked[0].playerId
  }
  return undefined
}

function release(s: LeagueState, teamId: TeamId, id: PlayerId, ctx: EngineContext): LeagueState {
  return releaseFrom(s, teamId, id, ctx, { diverge: false })
}

function signSlot(s: LeagueState, teamId: TeamId, slot: RosterSlot): LeagueState {
  const team = s.teams[teamId]!
  return {
    ...s,
    teams: { ...s.teams, [teamId]: { ...team, roster: [...team.roster, slot] } },
    freeAgents: s.freeAgents.filter((id) => id !== slot.playerId),
  }
}

/**
 * Round 1-3 rookies the history snap left unsigned (real opening-day data lists them on no team: injured
 * reserve, NFI) go back to their drafting team on the slot-scale deal, so a cutdown never strands a
 * premium pick. Players the user touched stay where the game put them.
 */
function reclaimEarlyRookies(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  deps: AiCutdownDeps,
): LeagueState {
  // Only the opening cutdown: the snap is what strands them. Later runs would re-sign a rookie the
  // cutdown just released and book his guarantee as dead money again, every week.
  if (s.phase !== 'PRESEASON') return s
  let out = s
  for (const id of s.freeAgents) {
    const p = s.players[id]
    if (!p?.draft || p.draft.team !== teamId) continue
    // A second K or P is trimmed straight away, so a first-round specialist would only cost dead money.
    if ((p.pos === 'K' || p.pos === 'P') && countByPos(out, roster(out, teamId)).get(p.pos))
      continue
    if (p.draft.round > faConstants.protectedRookieMaxRound || p.rookieSeason !== s.season) continue
    if (s.divergence.has(id)) continue
    const contract = deps.rookieContract(
      { round: p.draft.round, pick: p.draft.pick },
      s.season,
      ctx,
    )
    out = signSlot(out, teamId, { playerId: id, teamId, contract })
  }
  return out
}

function trimSpecialists(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  keep: Set<PlayerId> | null,
): LeagueState {
  let out = s
  for (const pos of ['K', 'P'] as const) {
    for (let guard = 0; guard < 4; guard++) {
      const slots = roster(out, teamId).filter((slot) => posOf(out, slot.playerId) === pos)
      if (slots.length <= 1) break
      const worst = [...slots].sort(byOvrThenRealThenId(out, keep))[0]!
      out = release(out, teamId, worst.playerId, ctx)
    }
  }
  return out
}

function bodyPosition(s: LeagueState, teamId: TeamId): Position | undefined {
  const counts = countByPos(s, roster(s, teamId))
  const needs = (Object.keys(ROSTER_TEMPLATE_53) as Position[])
    .map((pos) => ({ pos, deficit: (ROSTER_TEMPLATE_53[pos] ?? 0) - (counts.get(pos) ?? 0) }))
    .filter((n) => n.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.pos.localeCompare(b.pos))
  return needs[0]?.pos
}

/** Over the cap at the roster floor: swap the priciest cuttable veteran for a league-minimum body. */
function swapForCapRoom(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  deps: AiCutdownDeps,
  keep: Set<PlayerId> | null,
): LeagueState {
  let out = s
  const cap = capFor(out.season, ctx)
  const minBody = deps.rookieContract(null, out.season, ctx)
  for (let guard = 0; guard < 60 && payroll(out, teamId) > cap; guard++) {
    const cutId = pickCapCut(out, teamId, keep, minBody.apy)
    if (cutId === undefined) break
    out = release(out, teamId, cutId, ctx)
    const wanted = bodyPosition(out, teamId)
    const pool = deps.freeAgentPool(out).filter((id) => id !== cutId && out.players[id])
    const body = pool.find((id) => posOf(out, id) === wanted) ?? pool[0]
    if (body === undefined) continue
    out = signSlot(out, teamId, { playerId: body, teamId, contract: minBody })
  }
  return out
}

/**
 * Signs the best candidate whose market deal fits under the cap; failing that the best candidate on a
 * league-minimum deal when there is room for one (or `force`, below the 46-man floor, where the cap swap
 * in runAiCutdowns makes room afterwards). Returns undefined when nobody can be signed.
 */
function signAffordable(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  deps: AiCutdownDeps,
  candidates: readonly PlayerId[],
  force: boolean,
): LeagueState | undefined {
  const first = candidates[0]
  if (first === undefined) return undefined
  const room = capFor(s.season, ctx) - payroll(s, teamId)
  for (const id of candidates) {
    const market = deps.synthesizeContract(s, id, s.season, ctx)
    if (market.apy <= room) return signSlot(s, teamId, { playerId: id, teamId, contract: market })
  }
  const minBody = deps.rookieContract(null, s.season, ctx)
  if (!force && minBody.apy > room) return undefined
  return signSlot(s, teamId, { playerId: first, teamId, contract: minBody })
}

/**
 * A team below a position minimum (the snap, a trade or a release do not know about depth) signs the
 * best free agent it can afford there, shedding its weakest surplus player when the roster is full.
 */
function fillPositionGaps(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  deps: AiCutdownDeps,
  keep: Set<PlayerId> | null,
  avoid: ReadonlySet<PlayerId>,
): LeagueState {
  const { max } = faConstants.gameRoster
  let out = s
  const positions = (Object.keys(faConstants.positionMinimums) as Position[]).sort()
  for (const pos of positions) {
    for (let guard = 0; guard < 6; guard++) {
      const have = countByPos(out, roster(out, teamId)).get(pos) ?? 0
      if (have >= faConstants.positionMinimums[pos]) break
      const candidates = deps
        .freeAgentPool(out)
        .filter((id) => posOf(out, id) === pos && !avoid.has(id))
      let working = out
      if (roster(working, teamId).length >= max) {
        const shed = pickSizeCut(working, teamId, keep)
        if (shed === undefined || posOf(working, shed) === pos) break
        working = release(working, teamId, shed, ctx)
      }
      const signed = signAffordable(working, teamId, ctx, deps, candidates, false)
      if (!signed) break
      out = signed
    }
  }
  return out
}

/**
 * Tops a short roster back up to 53 (a trade or release left it thin): free agents at positions below
 * the 53-man template first, best consensus first, within the cap. Never adds a second K or P.
 */
function fillToSize(
  s: LeagueState,
  teamId: TeamId,
  ctx: EngineContext,
  deps: AiCutdownDeps,
  avoid: ReadonlySet<PlayerId>,
): LeagueState {
  const { min, max } = faConstants.gameRoster
  let out = s
  for (let guard = 0; guard < 60 && roster(out, teamId).length < max; guard++) {
    const counts = countByPos(out, roster(out, teamId))
    const open = deps
      .freeAgentPool(out)
      .filter((id) => !avoid.has(id) && posOf(out, id) !== undefined)
      .filter((id) => {
        const pos = posOf(out, id)!
        return !((pos === 'K' || pos === 'P') && (counts.get(pos) ?? 0) >= 1)
      })
    const needed = open.filter((id) => {
      const pos = posOf(out, id)!
      return (counts.get(pos) ?? 0) < (ROSTER_TEMPLATE_53[pos] ?? 0)
    })
    const signed = signAffordable(
      out,
      teamId,
      ctx,
      deps,
      needed.length ? needed : open,
      roster(out, teamId).length < min,
    )
    if (!signed) break
    out = signed
  }
  return out
}

export function runAiCutdownsImpl(
  state: LeagueState,
  ctx: EngineContext,
  deps: AiCutdownDeps,
): LeagueState {
  let s = state
  const { min, max } = faConstants.gameRoster
  for (const teamId of Object.keys(s.teams).sort()) {
    if (!s.teams[teamId] || s.teams[teamId]!.userControlled) continue
    const keep = deps.realRoster(s, ctx, teamId)
    const startIds = roster(s, teamId).map((r) => r.playerId)
    s = reclaimEarlyRookies(s, teamId, ctx, deps)
    s = trimSpecialists(s, teamId, ctx, keep)

    for (let guard = 0; guard < 200 && roster(s, teamId).length > max; guard++) {
      const cutId = pickSizeCut(s, teamId, keep)
      if (cutId === undefined) break
      s = release(s, teamId, cutId, ctx)
    }

    const cap = capFor(s.season, ctx)
    for (
      let guard = 0;
      guard < 200 && payroll(s, teamId) > cap && roster(s, teamId).length > min;
      guard++
    ) {
      const cutId = pickCapCut(s, teamId, keep, 0)
      if (cutId === undefined) break
      s = release(s, teamId, cutId, ctx)
    }

    const onRoster = new Set(roster(s, teamId).map((r) => r.playerId))
    const released = new Set(startIds.filter((id) => !onRoster.has(id)))
    s = swapForCapRoom(s, teamId, ctx, deps, keep)
    s = fillPositionGaps(s, teamId, ctx, deps, keep, released)
    s = fillToSize(s, teamId, ctx, deps, released)
  }
  return s
}
