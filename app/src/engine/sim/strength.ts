/**
 * Team strength from the depth chart using TRUE current-season values (HANDOFF §6.3).
 *
 * Sim is one of the two places allowed to read `state.truth`: games are decided by who players really
 * are, not by what scouts believe. A missing truth entry falls back to consensus and is counted —
 * on real data that counter must stay at 0.
 */
import type { LeagueState, PlayerId, Position, TeamId, TeamStrength } from '@contracts/index'
import { POSITIONS } from '@contracts/index'
import { simConstants, strengthConstants } from './constants'

const { replacementValue, slotDecay, starters, benchDepth, wrShareOfWrte, ratingMin, ratingMax } =
  strengthConstants

let truthFallbacks = 0

/** How often a true current-season value was missing and consensus was used instead. */
export function truthFallbackCount(): number {
  return truthFallbacks
}

export function resetTruthFallbackCount(): void {
  truthFallbacks = 0
}

export function trueValue(state: LeagueState, playerId: PlayerId): number {
  const truth = state.truth[playerId]?.bySeason[String(state.season)]
  if (truth !== undefined) return truth
  truthFallbacks++
  return state.scouting[playerId]?.ovr ?? replacementValue
}

const emptyByPos = (): Record<Position, PlayerId[]> =>
  Object.fromEntries(POSITIONS.map((p) => [p, [] as PlayerId[]])) as Record<Position, PlayerId[]>

/**
 * Healthy players per position in depth-chart order. Anyone on the roster the chart forgot is appended
 * by true value, so a missing or stale chart degrades gracefully instead of fielding nobody.
 */
export function availableByPosition(
  state: LeagueState,
  teamId: TeamId,
): Record<Position, PlayerId[]> {
  const byPos = emptyByPos()
  const team = state.teams[teamId]
  if (!team) return byPos

  const healthy = new Set<PlayerId>()
  const rosterByPos = emptyByPos()
  for (const slot of team.roster) {
    if (slot.injured && slot.injured.weeksOut > 0) continue
    const pos = state.players[slot.playerId]?.pos
    if (!pos) continue
    healthy.add(slot.playerId)
    rosterByPos[pos].push(slot.playerId)
  }

  for (const pos of POSITIONS) {
    const listed = new Set<PlayerId>()
    const ordered: PlayerId[] = []
    for (const id of team.depthChart[pos] ?? []) {
      if (!healthy.has(id) || listed.has(id) || state.players[id]?.pos !== pos) continue
      listed.add(id)
      ordered.push(id)
    }
    const missing = rosterByPos[pos].filter((id) => !listed.has(id))
    missing.sort((a, b) => trueValue(state, b) - trueValue(state, a) || (a < b ? -1 : 1))
    byPos[pos] = ordered.concat(missing)
  }
  return byPos
}

function valuesAt(state: LeagueState, ids: readonly PlayerId[], count: number, from = 0): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const id = ids[from + i]
    out.push(id === undefined ? replacementValue : trueValue(state, id))
  }
  return out
}

/** Starters weighted by slot, blended with the reserves behind them. */
function groupRating(state: LeagueState, ids: readonly PlayerId[], pos: Position): number {
  const slots = starters[pos]
  const starterValues = valuesAt(state, ids, slots)
  let num = 0
  let den = 0
  for (let i = 0; i < slots; i++) {
    const w = Math.pow(slotDecay, i)
    num += w * starterValues[i]!
    den += w
  }
  const starterRating = num / den
  const bench = valuesAt(state, ids, benchDepth, slots)
  const benchRating = bench.reduce((a, b) => a + b, 0) / benchDepth
  return (1 - simConstants.benchFactor) * starterRating + simConstants.benchFactor * benchRating
}

const clampRating = (x: number) => Math.min(ratingMax, Math.max(ratingMin, x))

export function strengthFrom(
  state: LeagueState,
  byPos: Record<Position, PlayerId[]>,
): TeamStrength {
  const rating = (pos: Position) => groupRating(state, byPos[pos], pos)

  const { offenseWeights: ow, defenseWeights: dw, stWeight } = simConstants
  const wrte = wrShareOfWrte * rating('WR') + (1 - wrShareOfWrte) * rating('TE')
  const off = ow.QB * rating('QB') + ow.OL * rating('OL') + ow.WRTE * wrte + ow.RB * rating('RB')
  const def =
    dw.DL * rating('DL') + dw.LB * rating('LB') + dw.CB * rating('CB') + dw.S * rating('S')
  const st = 0.5 * rating('K') + 0.5 * rating('P')
  const overall = (1 - stWeight) * ((off + def) / 2) + stWeight * st

  return {
    off: clampRating(off),
    def: clampRating(def),
    st: clampRating(st),
    overall: clampRating(overall),
  }
}

export function computeTeamStrength(state: LeagueState, teamId: TeamId): TeamStrength {
  return strengthFrom(state, availableByPosition(state, teamId))
}
