/**
 * engine/lifecycle — season progression, retirement, injuries, procedural draft classes (HANDOFF §6.7).
 * Owned by lifecycle (3D). One of two engine folders allowed to read `state.truth`/`ctx.trajectories`
 * (the other is engine/sim). Real players inside real data get their trueValue from the trajectory
 * table, exactly, with no smoothing; everyone else ages along the fitted curves with seeded noise.
 */
import {
  isInHistory,
  lifecycleStub,
  type CompactTrajectory, type CurvesFile, type EngineContext, type InjuryEvent, type LeagueState,
  type LifecycleModule, type Player, type PlayerId, type Rng, type Season, type TeamState,
} from '@contracts/index'
import {
  CONFIDENCE_BASE, CONFIDENCE_MAX, CONFIDENCE_PER_SEASON, PEDIGREE_BASELINE_PICK, PEDIGREE_BUMP_MAX,
  PEDIGREE_BUMP_SCALE, RETIREMENT_VALUE_BASELINE, VETERAN_OVR_NOISE_BASE_SD, VETERAN_OVR_NOISE_MIN_SD,
} from './constants'
import { ageDelta, agingSd, clampRating, interpolateSlotGrade, projectedCeiling, retireProbability } from './curves'
import { generateDraftClass as generateDraftClassImpl } from './draftClass'

// -------------------------------------------------------------------------------------------
// progressSeason
// -------------------------------------------------------------------------------------------

function exactTrajectoryValue(compact: CompactTrajectory, season: Season): number | null {
  const idx = season - compact.start
  if (idx < 0 || idx >= compact.values.length) return null
  return compact.values[idx] ?? null
}

/** Most recent true value strictly before `beforeSeason` (gaps in bySeason are skipped). */
function lastKnownValue(bySeason: Record<string, number>, beforeSeason: Season): number | undefined {
  let bestSeason = -Infinity
  let bestValue: number | undefined
  for (const key of Object.keys(bySeason)) {
    const s = Number(key)
    if (s < beforeSeason && s > bestSeason) {
      bestSeason = s
      bestValue = bySeason[key]
    }
  }
  return bestValue
}

function progressSeason(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState {
  const season = state.season
  const curves = ctx.data.curves
  let truth = state.truth
  let changed = false
  for (const id of Object.keys(state.players).sort()) {
    const player = state.players[id]!
    const current = truth[id]
    if (!current) continue
    if (current.retiresAfter != null && season > current.retiresAfter) continue
    if (String(season) in current.bySeason) continue // already set (e.g. a rookie just loaded this season)

    let value: number | null = null
    if (player.real) {
      const compact = ctx.trajectories[id]
      value = compact ? exactTrajectoryValue(compact, season) : null
    }
    if (value == null) {
      const prev = lastKnownValue(current.bySeason, season)
      if (prev == null) continue // no baseline to age from
      const age = season - player.birthYear
      const delta = ageDelta(curves, player.pos, age)
      const sd = agingSd(curves, player.pos)
      const noise = rng.fork(id).normal(0, sd)
      value = clampRating(prev + delta + noise)
    }
    truth = { ...truth, [id]: { ...current, bySeason: { ...current.bySeason, [String(season)]: value } } }
    changed = true
  }
  return changed ? { ...state, truth } : state
}

// -------------------------------------------------------------------------------------------
// retirements
// -------------------------------------------------------------------------------------------

function retirements(state: LeagueState, ctx: EngineContext, rng: Rng): { state: LeagueState; retired: PlayerId[] } {
  const season = state.season
  const curves = ctx.data.curves
  const activeIds = new Set<PlayerId>()
  for (const team of Object.values(state.teams)) for (const slot of team.roster) activeIds.add(slot.playerId)
  for (const id of state.freeAgents) activeIds.add(id)

  const retired: PlayerId[] = []
  let truth = state.truth
  for (const id of [...activeIds].sort()) {
    const player = state.players[id]
    const traj = truth[id]
    if (!player || !traj) continue

    // Hard fact: real players (or already-decided procedural players) retire after this season.
    // Otherwise, logistic in age and value (HANDOFF §6.7).
    const retire =
      traj.retiresAfter != null
        ? season > traj.retiresAfter
        : rng
            .fork(id)
            .chance(
              retireProbability(
                curves,
                player.pos,
                season - player.birthYear,
                traj.bySeason[String(season)] ?? traj.bySeason[String(season - 1)] ?? RETIREMENT_VALUE_BASELINE,
              ),
            )

    if (retire) {
      retired.push(id)
      const bySeason = { ...traj.bySeason }
      delete bySeason[String(season)] // projected but never played
      const retiresAfter = traj.retiresAfter ?? season - 1
      truth = { ...truth, [id]: { bySeason, retiresAfter } }
    }
  }

  if (retired.length === 0) return { state, retired: [] }
  const retiredSet = new Set(retired)
  const teams = Object.fromEntries(
    Object.entries(state.teams).map(([teamId, team]) => [
      teamId,
      { ...team, roster: team.roster.filter((slot) => !retiredSet.has(slot.playerId)) },
    ]),
  )
  const freeAgents = state.freeAgents.filter((id) => !retiredSet.has(id))
  return { state: { ...state, teams, freeAgents, truth }, retired }
}

// -------------------------------------------------------------------------------------------
// refreshScouting
// -------------------------------------------------------------------------------------------

function pedigreeBump(curves: CurvesFile, player: Player): number {
  if (!player.draft) return 0
  const slot = interpolateSlotGrade(curves, player.draft.pick)
  const baseline = interpolateSlotGrade(curves, PEDIGREE_BASELINE_PICK)
  return Math.min(PEDIGREE_BUMP_MAX, Math.max(0, (slot.pot - baseline.pot) * PEDIGREE_BUMP_SCALE))
}

function refreshScouting(state: LeagueState, ctx: EngineContext): LeagueState {
  const season = state.season
  const curves = ctx.data.curves
  const inHistory = isInHistory(ctx, season)
  const chunk = inHistory ? ctx.seasonData(season) : undefined
  const chunkPlayers = chunk ? new Map(chunk.players.players.map((p) => [p.id, p])) : null

  let scouting = state.scouting
  let changed = false
  for (const id of Object.keys(state.players).sort()) {
    const player = state.players[id]!
    if (player.rookieSeason >= season) continue // rookies keep their pre-draft view

    const chunkPlayer = chunkPlayers?.get(id)
    if (chunkPlayer) {
      scouting = { ...scouting, [id]: chunkPlayer.scouting }
      changed = true
      continue
    }

    const traj = state.truth[id]
    const priorValue = traj?.bySeason[String(season - 1)]
    if (priorValue == null) continue // nothing completed to report on yet

    const yearsIn = Math.max(0, season - player.rookieSeason)
    const noiseSd = Math.max(VETERAN_OVR_NOISE_MIN_SD, VETERAN_OVR_NOISE_BASE_SD / Math.sqrt(1 + yearsIn))
    const ovrRng = ctx.modules.rng.fromSeed(state.seed, season, 'scouting', id)
    const ovr = clampRating(priorValue + ovrRng.normal(0, noiseSd))
    const ceiling = projectedCeiling(curves, player.pos, season - player.birthYear, ovr)
    const pot = clampRating(Math.max(ovr, ceiling + pedigreeBump(curves, player)))
    const confidence = Math.min(CONFIDENCE_MAX, CONFIDENCE_BASE + yearsIn * CONFIDENCE_PER_SEASON)

    scouting = { ...scouting, [id]: { ovr, pot, confidence } }
    changed = true
  }
  return changed ? { ...state, scouting } : state
}

// -------------------------------------------------------------------------------------------
// Injuries (applyInjuryEvents preserved from the Phase 2 scaffold; tickInjuries extended with
// the permanent-loss roll — the only place lifecycle edits truth mid-season).
// -------------------------------------------------------------------------------------------

function applyInjuryEvents(state: LeagueState, events: InjuryEvent[]): LeagueState {
  if (events.length === 0) return state
  const byTeam = new Map<string, InjuryEvent[]>()
  for (const e of events) byTeam.set(e.teamId, [...(byTeam.get(e.teamId) ?? []), e])
  let teams = state.teams
  for (const [teamId, teamEvents] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teams[teamId]
    if (!team) continue
    const byPlayer = new Map(teamEvents.map((e) => [e.playerId, e]))
    const roster = team.roster.map((slot) => {
      const hit = byPlayer.get(slot.playerId)
      if (!hit) return slot
      // A player hurt again while already out serves the longer of the two absences.
      const weeksOut = Math.max(hit.weeksOut, slot.injured?.weeksOut ?? 0)
      return { ...slot, injured: { weeksOut, kind: hit.kind, season: state.season, week: state.week } }
    })
    teams = { ...teams, [teamId]: { ...team, roster } }
  }
  return { ...state, teams }
}

function tickInjuries(state: LeagueState, ctx: EngineContext, rng: Rng): LeagueState {
  const model = ctx.data.injuryModel.permanentLoss
  let changed = false
  let truth = state.truth
  const teams: Record<string, TeamState> = {}
  for (const teamId of Object.keys(state.teams).sort()) {
    const team = state.teams[teamId]!
    let teamChanged = false
    const roster = team.roster.map((slot) => {
      if (!slot.injured) return slot
      teamChanged = true
      const weeksOut = slot.injured.weeksOut - 1
      if (weeksOut <= 0) {
        // The injury clears this week. If it was long (elapsed >= minWeeks; a season boundary in
        // between counts as long — no weekly ticks run over the offseason), roll for permanent loss.
        const elapsed = slot.injured.season === state.season ? state.week - slot.injured.week + 1 : Infinity
        if (elapsed >= model.minWeeks && rng.fork(slot.playerId).chance(model.p)) {
          const traj = truth[slot.playerId]
          const key = String(state.season)
          const currentValue = traj?.bySeason[key]
          if (traj && currentValue != null) {
            const [lo, hi] = model.lossRange
            const loss = rng.fork(`${slot.playerId}:loss`).int(Math.round(lo), Math.round(hi))
            truth = { ...truth, [slot.playerId]: { ...traj, bySeason: { ...traj.bySeason, [key]: clampRating(currentValue - loss) } } }
          }
        }
        const healthy = { ...slot }
        delete healthy.injured
        return healthy
      }
      return { ...slot, injured: { ...slot.injured, weeksOut } }
    })
    teams[teamId] = teamChanged ? { ...team, roster } : team
    changed ||= teamChanged
  }
  if (!changed) return state
  return { ...state, teams, truth }
}

// -------------------------------------------------------------------------------------------

export const lifecycle: LifecycleModule = {
  ...lifecycleStub,
  progressSeason,
  retirements,
  refreshScouting,
  applyInjuryEvents,
  tickInjuries,
  generateDraftClass: (state, ctx, rng) => generateDraftClassImpl(state, ctx.data.curves, rng),
  age: (state, playerId, season) => {
    const player = state.players[playerId]
    if (!player) throw new Error(`lifecycle.age: unknown player "${playerId}"`)
    return (season ?? state.season) - player.birthYear
  },
}
