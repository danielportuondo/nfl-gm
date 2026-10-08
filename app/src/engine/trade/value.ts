/**
 * Consensus-only asset valuation (§6.5). Nothing here may read `state.truth` or `ctx.trajectories`:
 * the trade AI knows exactly what the world knows, which is the whole point of the hindsight model.
 *
 * Every lookup that depends only on a `LeagueState` is memoized on the state object itself, so the
 * functions stay pure and deterministic while `generateAiOffers` can value thousands of assets.
 */
import {
  isOpeningOffseason,
  POSITIONS,
  STARTER_TEMPLATE,
  type DraftPick,
  type EngineContext,
  type LeagueState,
  type NeedProfile,
  type PickRef,
  type PlayerId,
  type Position,
  type Contract,
  type RosterSlot,
  type ScoutingView,
  type TeamId,
} from '@contracts/index'
import {
  controlConstants,
  dropConstants,
  needConstants,
  pickConstants,
  rookieConstants,
  tradeConstants,
  valueConstants,
} from './constants'

const rosterIndexCache = new WeakMap<object, Map<PlayerId, RosterSlot>>()
const startOvrCache = new WeakMap<object, Map<PlayerId, number>>()
const orderRankCache = new WeakMap<object, Map<TeamId, number>>()
const needsCache = new WeakMap<object, Map<TeamId, NeedProfile>>()
/** Keyed on the state object, so a module-level cache stays pure: a new state is a new entry. */
const valueCache = new WeakMap<object, Map<string, number>>()

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

const OFFSEASON_PHASES: readonly string[] = [
  'OFFSEASON_RESIGN',
  'DRAFT',
  'UDFA',
  'FREE_AGENCY',
  'TRAINING_CAMP',
]

export function isOffseasonPhase(phase: string): boolean {
  return OFFSEASON_PHASES.includes(phase)
}

/** The season a trade is for: the one being played, or in the offseason the one coming up. */
export function leagueYear(state: LeagueState): number {
  return isOffseasonPhase(state.phase) ? state.season + 1 : state.season
}

/** Age in the league year, so a 39-year-old in the offseason is valued at the 40 he will play at. */
export function ageOf(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  return ctx.modules.lifecycle.age(state, playerId, leagueYear(state))
}

/**
 * Seasons the holder actually gets out of `contract` from now on. `fa.seasonsLeft` knows the expiry
 * rule: a deal signed in an offseason phase plays all its years, an older one has already used the
 * season just played until the camp rollover. In season that count includes the current season, of
 * which only the unplayed share is left.
 */
export function controlSeasons(state: LeagueState, contract: Contract, ctx: EngineContext): number {
  const left = ctx.modules.fa.seasonsLeft(state, contract)
  if (isOffseasonPhase(state.phase) || state.phase === 'PRESEASON') return left
  const ahead = left - 1
  if (state.phase === 'PLAYOFFS') return ahead + controlConstants.playoffShare
  const played = Math.max(0, state.week - 1) / controlConstants.regularSeasonWeeks
  return ahead + Math.max(controlConstants.playoffShare, 1 - played)
}

/** Share of full value that `seasons` of control carry: 1 from the third season on. */
export function controlFactor(seasons: number): number {
  return controlConstants.seasonWeights.reduce(
    (total, weight, i) => total + weight * Math.min(1, Math.max(0, seasons - i)),
    0,
  )
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
  // Before the first season there is no in-season drop to detect, and the chunk for `season`
  // (startSeason − 1) may not exist at all for a 2010 start.
  if (!isOpeningOffseason(state)) {
    const chunk = ctx.seasonData(state.season)
    for (const p of chunk?.players.players ?? []) map.set(p.id, p.scouting.ovr)
  }
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

/** What one starting slot is worth with a player of consensus `ovr` in it: talent only, no age or contract. */
export function slotTalent(pos: Position, ovr: number): number {
  return ratingCurve(ovr) * valueConstants.posMultiplier[pos]
}

function ageMultiplier(pos: Position, age: number): number {
  const past = Math.max(0, age - valueConstants.peakAge[pos])
  const rate =
    valueConstants.declinePerYearPastPeakByPos[pos] ?? valueConstants.declinePerYearPastPeak
  return Math.max(valueConstants.declineFloor, 1 - rate * past)
}

/** Salary cost at full control; `controlFactor` scales it with the talent it pays for. */
function contractCost(apy: number, seasons: number, cap: number): number {
  if (cap <= 0) return 0
  const capPct = (apy / cap) * 100
  const years = Math.min(Math.max(1, seasons), valueConstants.costMaxYears)
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
 * Talent and cost of a player from consensus alone, over the seasons of control the holder gets.
 * `asView` values the same player under a different consensus (the season-start re-valuation)
 * without cloning the league. `fullCost` is the buying AI's read: salary is charged in full, so an
 * albatross is worth less than nothing to take on. Without it (what the player is worth on the
 * market, and to a seller) cost takes at most `maxCostShareOfTalent` and the floor is "worthless" —
 * uncapped, a starter on a market deal fell to the floor and the AI dealt him for a body.
 */
export function playerValueImpl(
  state: LeagueState,
  playerId: PlayerId,
  ctx: EngineContext,
  asView?: ScoutingView,
  fullCost = false,
): number {
  if (asView) return computePlayerValue(state, playerId, ctx, asView, fullCost)
  let cache = valueCache.get(state)
  if (!cache) {
    cache = new Map()
    valueCache.set(state, cache)
  }
  const key = fullCost ? `${playerId}:full` : playerId
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const value = computePlayerValue(state, playerId, ctx, undefined, fullCost)
  cache.set(key, value)
  return value
}

function computePlayerValue(
  state: LeagueState,
  playerId: PlayerId,
  ctx: EngineContext,
  asView: ScoutingView | undefined,
  fullCost: boolean,
): number {
  const player = state.players[playerId]
  const view = asView ?? state.scouting[playerId]
  if (!player || !view) return 0
  const slot = rosterIndex(state).get(playerId)
  const health = injuryMultiplier(slot?.injured?.weeksOut ?? 0)
  const healthy = talentOf(state, playerId, view, ctx) * health
  const anchor = rookieSlotAnchor(state, playerId) * health
  const cap = capFor(state, ctx)
  const contract = slot?.contract
  const seasons = contract ? controlSeasons(state, contract, ctx) : 1
  const cost = contract ? contractCost(contract.apy, seasons, cap) : 0
  const controlled =
    controlFactor(seasons) * (healthy - (fullCost ? cost : cappedCost(cost, healthy)))
  const value = controlled + reSigningRights(state, playerId, healthy, ctx)
  if (fullCost) return anchor > 0 ? Math.max(anchor, value) : value
  return Math.max(valueConstants.minPlayerValue, value, anchor)
}

function talentOf(
  state: LeagueState,
  playerId: PlayerId,
  view: ScoutingView,
  ctx: EngineContext,
): number {
  const pos = state.players[playerId]!.pos
  const age = ageOf(state, playerId, ctx)
  const effectiveOvr = view.ovr + Math.max(0, view.pot - view.ovr) * potShare(age)
  return ratingCurve(effectiveOvr) * ageMultiplier(pos, age) * valueConstants.posMultiplier[pos]
}

function cappedCost(cost: number, talent: number): number {
  return Math.min(cost, valueConstants.maxCostShareOfTalent * talent)
}

/**
 * A player whose deal runs out at the next re-sign window his team will see (an expiring player in
 * season, or during OFFSEASON_RESIGN) can be re-signed: the rights are worth a share of what he is
 * worth on the market deal the fa module would write for him.
 */
function reSigningRights(
  state: LeagueState,
  playerId: PlayerId,
  talent: number,
  ctx: EngineContext,
): number {
  const contract = rosterIndex(state).get(playerId)?.contract
  if (!contract || isOpeningOffseason(state)) return 0
  if (isOffseasonPhase(state.phase)) {
    if (state.phase !== 'OFFSEASON_RESIGN' || !ctx.modules.fa.isExpiringDeal(state, contract))
      return 0
  } else if (contract.years !== 1) return 0
  const market = ctx.modules.fa.synthesizeContract(state, playerId, leagueYear(state), ctx)
  // Signed in the re-sign window, the new deal is stamped for next season and plays all its years.
  const seasons = market.years
  if (seasons <= 0) return 0
  const cost = contractCost(market.apy, seasons, capFor(state, ctx))
  const value = controlFactor(seasons) * (talent - cappedCost(cost, talent))
  return controlConstants.rightsShare * Math.max(0, value)
}

/**
 * The floor a recent draftee's draft slot puts under his value (0 for anyone else). The slot is
 * public knowledge, so this stays consensus-only. Draft-year convention: the draft held during
 * season S is the S+1 class, so a player drafted this offseason is in year 0.
 */
export function rookieSlotAnchor(state: LeagueState, playerId: PlayerId): number {
  const draft = state.players[playerId]?.draft
  if (!draft) return 0
  const decay = rookieConstants.decayByYear[state.season + 1 - draft.season] ?? 0
  if (decay <= 0) return 0
  const slotValue = chartPoints(draft.pick) * (pickConstants.scalePerThousand / 1000)
  return slotValue * rookieConstants.slotShare * decay
}

/**
 * Each position's highest-consensus player on `teamId` (ties to the lower id). AI-initiated deals never
 * send these: trade value nets out salary, so ranking a room by value would call an expensive starter
 * surplus and deal him for a backup.
 */
export function topByOvrAtPosition(state: LeagueState, teamId: TeamId): Set<PlayerId> {
  const best = new Map<Position, { id: PlayerId; ovr: number }>()
  for (const slot of state.teams[teamId]?.roster ?? []) {
    const pos = state.players[slot.playerId]?.pos
    if (!pos) continue
    const ovr = state.scouting[slot.playerId]?.ovr ?? 0
    const held = best.get(pos)
    if (!held || ovr > held.ovr || (ovr === held.ovr && slot.playerId < held.id))
      best.set(pos, { id: slot.playerId, ovr })
  }
  return new Set([...best.values()].map((entry) => entry.id))
}

/** How far consensus ovr has fallen since season start (0 when unknown or risen). */
export function consensusDrop(state: LeagueState, playerId: PlayerId, ctx: EngineContext): number {
  const start = seasonStartOvr(state, ctx).get(playerId)
  const now = state.scouting[playerId]?.ovr
  if (start === undefined || now === undefined) return 0
  return Math.max(0, start - now)
}

/**
 * Value of a player the AI would be ACQUIRING, salary charged in full. Injuries are already priced by `playerValue`; a
 * sharp in-season consensus drop takes an extra haircut on top, because the AI treats a cratering
 * player as likelier to keep cratering than consensus admits.
 */
export function incomingValue(
  state: LeagueState,
  playerId: PlayerId,
  ctx: EngineContext,
  fullCost = true,
): number {
  const base = playerValueImpl(state, playerId, ctx, undefined, fullCost)
  if (base <= 0 || consensusDrop(state, playerId, ctx) < dropConstants.sharpDropPoints) return base
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

/** A pick in `round` of the coming draft at `teamId`'s projected slot, undiscounted. */
export function projectedRoundValue(state: LeagueState, teamId: TeamId, round: number): number {
  return (
    chartPoints(projectedOverall(state, teamId, round)) * (pickConstants.scalePerThousand / 1000)
  )
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
