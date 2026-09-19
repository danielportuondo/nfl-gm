/**
 * Consensus-only asset valuation (§6.5). Nothing here may read `state.truth` or `ctx.trajectories`:
 * the trade AI knows exactly what the world knows, which is the whole point of the hindsight model.
 *
 * Every lookup that depends only on a `LeagueState` is memoized on the state object itself, so the
 * functions stay pure and deterministic while `generateAiOffers` can value thousands of assets.
 */
import {
  POSITIONS,
  STARTER_TEMPLATE,
  type DraftPick,
  type EngineContext,
  type LeagueState,
  type NeedProfile,
  type PickRef,
  type PlayerId,
  type Position,
  type RosterSlot,
  type ScoutingView,
  type TeamId,
} from '@contracts/index'
import {
  dropConstants,
  needConstants,
  pickConstants,
  tradeConstants,
  valueConstants,
} from './constants'

const rosterIndexCache = new WeakMap<object, Map<PlayerId, RosterSlot>>()
const startOvrCache = new WeakMap<object, Map<PlayerId, number>>()
const orderRankCache = new WeakMap<object, Map<TeamId, number>>()
const needsCache = new WeakMap<object, Map<TeamId, NeedProfile>>()

/** Every rostered player's slot (contract + injury), keyed by player id. */
export function rosterIndex(state: LeagueState): Map<PlayerId, RosterSlot> {
  const cached = rosterIndexCache.get(state)
  if (cached) return cached
  const index = new Map<PlayerId, RosterSlot>()
  for (const teamId of Object.keys(state.teams).sort()) {
    for (const slot of state.teams[teamId]?.roster ?? []) index.set(slot.playerId, slot)
  }
  rosterIndexCache.set(state, index)
  return index
}

export function capFor(state: LeagueState, ctx: EngineContext): number {
  return ctx.modules.fa.capFor(state.season, ctx)
}

export function ageOf(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  return ctx.modules.lifecycle.age(state, playerId)
}

/**
 * Consensus ovr at the start of this season, from the season chunk. This is a CONSENSUS snapshot
 * (`players.json.scouting`), not truth — it is what the world believed in week 0. Empty when the
 * chunk is unavailable (procedural era), in which case sharp-drop re-valuation simply does not fire.
 */
export function seasonStartOvr(state: LeagueState, ctx: EngineContext): Map<PlayerId, number> {
  const cached = startOvrCache.get(state)
  if (cached) return cached
  const map = new Map<PlayerId, number>()
  const chunk = ctx.seasonData(state.season)
  for (const p of chunk?.players.players ?? []) map.set(p.id, p.scouting.ovr)
  startOvrCache.set(state, map)
  return map
}

function potShare(age: number): number {
  const { potShareMax, potShareYoungAge, potShareFlatAge } = valueConstants
  if (age <= potShareYoungAge) return potShareMax
  if (age >= potShareFlatAge) return 0
  return potShareMax * ((potShareFlatAge - age) / (potShareFlatAge - potShareYoungAge))
}

function ratingCurve(effectiveOvr: number): number {
  const { ovrFloor, ovrSpan, ovrExp, ovrPeakValue } = valueConstants
  const x = Math.max(0, effectiveOvr - ovrFloor) / ovrSpan
  return Math.pow(x, ovrExp) * ovrPeakValue
}

function ageMultiplier(pos: Position, age: number): number {
  const past = Math.max(0, age - valueConstants.peakAge[pos])
  return Math.max(valueConstants.declineFloor, 1 - valueConstants.declinePerYearPastPeak * past)
}

function contractCost(slot: RosterSlot | undefined, cap: number): number {
  if (!slot || cap <= 0) return 0
  const capPct = (slot.contract.apy / cap) * 100
  const years = Math.min(slot.contract.years, valueConstants.costMaxYears)
  return valueConstants.costPerCapPct * capPct * (1 + valueConstants.costExtraPerYear * (years - 1))
}

export function injuryWeeks(state: LeagueState, playerId: PlayerId): number {
  return rosterIndex(state).get(playerId)?.injured?.weeksOut ?? 0
}

function injuryMultiplier(weeks: number): number {
  if (weeks <= 0) return 1
  const { injuryDiscountPerWeek, injuryDiscountMax } = valueConstants
  return 1 - Math.min(injuryDiscountMax, injuryDiscountPerWeek * weeks)
}

/**
 * Talent-and-cost value of a player from consensus alone. `asView` values the same player under a
 * different consensus (used for the season-start re-valuation) without cloning the league.
 */
export function playerValueImpl(
  state: LeagueState,
  playerId: PlayerId,
  ctx: EngineContext,
  asView?: ScoutingView,
): number {
  const player = state.players[playerId]
  const view = asView ?? state.scouting[playerId]
  if (!player || !view) return 0
  const age = ageOf(state, playerId, ctx)
  const effectiveOvr = view.ovr + Math.max(0, view.pot - view.ovr) * potShare(age)
  const talent =
    ratingCurve(effectiveOvr) *
    ageMultiplier(player.pos, age) *
    valueConstants.posMultiplier[player.pos]
  const slot = rosterIndex(state).get(playerId)
  const value =
    talent * injuryMultiplier(slot?.injured?.weeksOut ?? 0) - contractCost(slot, capFor(state, ctx))
  return Math.max(valueConstants.minPlayerValue, value)
}

/** How far consensus ovr has fallen since season start (0 when unknown or risen). */
export function consensusDrop(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const start = seasonStartOvr(state, ctx).get(playerId)
  const now = state.scouting[playerId]?.ovr
  if (start === undefined || now === undefined) return 0
  return Math.max(0, start - now)
}

/**
 * Value of a player the AI would be ACQUIRING. Injuries are already priced by `playerValue`; a
 * sharp in-season consensus drop takes an extra haircut on top, because the AI treats a cratering
 * player as likelier to keep cratering than consensus admits.
 */
export function incomingValue(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const base = playerValueImpl(state, playerId, ctx)
  if (consensusDrop(state, playerId, ctx) < dropConstants.sharpDropPoints) return base
  return base * (1 - dropConstants.buyExtraDiscount)
}

/**
 * Value of a player the AI would be GIVING UP. A sharp drop does not make the AI panic-sell: it
 * still wants most of the season-start price, which closes the buy-the-dip exploit.
 */
export function outgoingValue(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const base = playerValueImpl(state, playerId, ctx)
  const view = state.scouting[playerId]
  const start = seasonStartOvr(state, ctx).get(playerId)
  if (!view || start === undefined || start - view.ovr < dropConstants.sharpDropPoints) return base
  const atStart = playerValueImpl(state, playerId, ctx, { ...view, ovr: start })
  return Math.max(base, atStart * dropConstants.sellFloorPct)
}

// --- picks ------------------------------------------------------------------------------------

export function refOf(pick: DraftPick): PickRef {
  return {
    season: pick.season,
    round: pick.round,
    originalTeam: pick.originalTeam,
    pick: pick.pick,
  }
}

export function refKey(ref: PickRef): string {
  return `${ref.season}-${ref.round}-${ref.originalTeam}-${ref.pick ?? '?'}`
}

/** Pick numbers only disambiguate when both sides know them (future seasons carry null). */
export function matchesRef(
  ref: PickRef,
  pick: Pick<DraftPick, 'season' | 'round' | 'originalTeam' | 'pick'>,
): boolean {
  return (
    pick.season === ref.season &&
    pick.round === ref.round &&
    pick.originalTeam === ref.originalTeam &&
    (ref.pick == null || pick.pick == null || ref.pick === pick.pick)
  )
}

export function findPick(state: LeagueState, ref: PickRef): DraftPick | undefined {
  return state.picks.find((p) => matchesRef(ref, p))
}

/** Rich Hill chart points for an overall pick number, log-linear between anchors. */
export function chartPoints(overall: number): number {
  const { chart, tailDecayPerPick, minChartPoints } = pickConstants
  const first = chart[0]
  const last = chart[chart.length - 1]!
  if (overall <= first.pick) return first.points
  if (overall >= last.pick)
    return Math.max(minChartPoints, last.points * Math.pow(tailDecayPerPick, overall - last.pick))
  for (let i = 1; i < chart.length; i++) {
    const hi = chart[i]!
    if (overall > hi.pick) continue
    const lo = chart[i - 1]!
    const t = (overall - lo.pick) / (hi.pick - lo.pick)
    return Math.exp(Math.log(lo.points) + t * (Math.log(hi.points) - Math.log(lo.points)))
  }
  return last.points
}

/** Mean consensus ovr of a team's template starters — the strength signal the trade AI is allowed. */
export function starterConsensus(state: LeagueState, teamId: TeamId): number {
  const team = state.teams[teamId]
  if (!team) return pickConstants.replacementOvr
  let total = 0
  let slots = 0
  for (const pos of POSITIONS) {
    const want = STARTER_TEMPLATE[pos] ?? 0
    const ovrs = team.roster
      .filter((r) => state.players[r.playerId]?.pos === pos)
      .map((r) => state.scouting[r.playerId]?.ovr ?? pickConstants.replacementOvr)
      .sort((a, b) => b - a)
    for (let i = 0; i < want; i++) {
      total += ovrs[i] ?? pickConstants.replacementOvr
      slots += 1
    }
  }
  return slots === 0 ? pickConstants.replacementOvr : total / slots
}

function strengthScore(state: LeagueState, teamId: TeamId): number {
  const consensus = starterConsensus(state, teamId)
  const record = state.teams[teamId]?.record
  const games = record ? record.wins + record.losses + record.ties : 0
  if (!record || games === 0) return consensus
  const winPct = (record.wins + record.ties * 0.5) / games
  const ramp = Math.min(1, games / pickConstants.recordRampGames)
  return consensus + pickConstants.recordWeight * (winPct - 0.5) * ramp
}

/** 1 = projected to pick first (weakest team). Consensus + on-field record only, never truth. */
export function projectedOrderRank(state: LeagueState, teamId: TeamId): number {
  let ranks = orderRankCache.get(state)
  if (!ranks) {
    const ids = Object.keys(state.teams).sort()
    const scored = ids.map((id) => ({ id, score: strengthScore(state, id) }))
    scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    ranks = new Map(scored.map((entry, i) => [entry.id, i + 1]))
    orderRankCache.set(state, ranks)
  }
  return ranks.get(teamId) ?? Math.ceil(Object.keys(state.teams).length / 2)
}

function projectedOverall(state: LeagueState, originalTeam: TeamId, round: number): number {
  return (round - 1) * pickConstants.picksPerRound + projectedOrderRank(state, originalTeam)
}

/**
 * Chart value, discounted 0.85 per year out. Draft-year convention (§ DECISIONS Phase 2): the draft
 * held during season S is the S+1 class, so an S+1 pick is this year's and costs no discount.
 * An unsettled slot (`pick: null`) is projected from the ORIGINAL team's strength — that is whose
 * season decides where the pick lands, whoever ends up owning it.
 */
export function pickValueImpl(state: LeagueState, ref: PickRef, _ctx: EngineContext): number {
  const pick = findPick(state, ref)
  if (pick?.playerId) return 0
  const overall = pick?.pick ?? projectedOverall(state, ref.originalTeam, ref.round)
  const yearsOut = Math.max(0, ref.season - (state.season + 1))
  const discount = Math.pow(tradeConstants.futurePickDiscount, yearsOut)
  return chartPoints(overall) * (pickConstants.scalePerThousand / 1000) * discount
}

// --- needs ------------------------------------------------------------------------------------

function fallbackNeeds(state: LeagueState, teamId: TeamId): NeedProfile {
  const team = state.teams[teamId]
  const byPos = {} as Record<Position, number>
  const surplus = {} as Record<Position, number>
  for (const pos of POSITIONS) {
    const want = STARTER_TEMPLATE[pos] ?? 0
    const ovrs = (team?.roster ?? [])
      .filter((r) => state.players[r.playerId]?.pos === pos)
      .map((r) => state.scouting[r.playerId]?.ovr ?? pickConstants.replacementOvr)
      .sort((a, b) => b - a)
    let deficit = 0
    for (let i = 0; i < want; i++)
      deficit += Math.max(
        0,
        needConstants.starterTarget - (ovrs[i] ?? pickConstants.replacementOvr),
      )
    byPos[pos] = want === 0 ? 0 : deficit / want
    surplus[pos] = ovrs.filter((o) => o >= needConstants.starterTarget).length - want
  }
  const top = POSITIONS.filter((pos) => byPos[pos] > 0)
    .sort((a, b) => byPos[b] - byPos[a] || a.localeCompare(b))
    .slice(0, needConstants.topNeeds)
  const saturated = POSITIONS.filter((pos) => surplus[pos] >= needConstants.saturatedSurplus)
  return { byPos, top: [...top], saturated: [...saturated] }
}

/** draft.teamNeeds; a team it reports as perfectly balanced falls back to the local consensus read. */
export function needsFor(state: LeagueState, teamId: TeamId, ctx: EngineContext): NeedProfile {
  let cache = needsCache.get(state)
  if (!cache) {
    cache = new Map<TeamId, NeedProfile>()
    needsCache.set(state, cache)
  }
  const hit = cache.get(teamId)
  if (hit) return hit
  let profile = ctx.modules.draft.teamNeeds(state, teamId)
  if (!profile.top.length && !profile.saturated.length) profile = fallbackNeeds(state, teamId)
  cache.set(teamId, profile)
  return profile
}
