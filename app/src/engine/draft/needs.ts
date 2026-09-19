/**
 * Positional need from CONSENSUS only (§6.4). Never touches state.truth.
 *
 * A position has a hole when the starters the STARTER_TEMPLATE asks for are missing or weak, and is
 * "saturated" when the team already carries clear depth of startable quality there. Saturation is
 * what stops the AI from taking the historical pick at a position it has no business adding to.
 */
import {
  POSITIONS,
  STARTER_TEMPLATE,
  type LeagueState,
  type NeedProfile,
  type Position,
  type TeamId,
} from '@contracts/index'
import { draftConstants, type DraftConstants } from './constants'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

const startersFor = (pos: Position): number => STARTER_TEMPLATE[pos] ?? 1

function satExtra(pos: Position, c: DraftConstants): number {
  return Math.max(c.satExtraMin, Math.ceil(startersFor(pos) * c.satExtraFraction))
}

/** Consensus ovr of each player at `pos` on the roster, best first. */
function ovrsAt(state: LeagueState, teamId: TeamId, pos: Position): number[] {
  const roster = state.teams[teamId]?.roster ?? []
  const ovrs: number[] = []
  for (const slot of roster) {
    if (state.players[slot.playerId]?.pos !== pos) continue
    ovrs.push(state.scouting[slot.playerId]?.ovr ?? draftConstants.replacementOvr)
  }
  return ovrs.sort((a, b) => b - a)
}

/** Mean consensus ovr of the starting group, empty slots counted at replacement level. */
function starterQuality(ovrs: number[], starters: number, c: DraftConstants): number {
  let total = 0
  for (let i = 0; i < starters; i++) total += ovrs[i] ?? c.replacementOvr
  return total / starters
}

export function needProfile(
  state: LeagueState,
  teamId: TeamId,
  c: DraftConstants = draftConstants,
): NeedProfile {
  if (!state.teams[teamId]) throw new Error(`draft.teamNeeds: unknown team "${teamId}"`)

  const byPos = {} as Record<Position, number>
  const saturated: Position[] = []

  for (const pos of POSITIONS) {
    const ovrs = ovrsAt(state, teamId, pos)
    const starters = startersFor(pos)
    const quality = starterQuality(ovrs, starters, c)
    const qualityHole = clamp01((c.starterBar - quality) / c.starterSpan)
    const missingBodies = Math.max(0, starters - ovrs.length) / starters
    byPos[pos] = clamp01(c.qualityWeight * qualityHole + c.bodyWeight * missingBodies)
    if (ovrs.length >= starters + satExtra(pos, c) && quality >= c.satQuality) saturated.push(pos)
  }

  const satSet = new Set(saturated)
  const top = POSITIONS.filter((pos) => !satSet.has(pos) && byPos[pos] >= c.topMin)
    .sort(
      (a, b) => byPos[b] * c.posImportance[b] - byPos[a] * c.posImportance[a] || a.localeCompare(b),
    )
    .slice(0, c.topCount)

  return { byPos, top, saturated }
}

/** Multiplier applied to consensus pot in the need-aware fallback. */
export function needWeight(
  needs: NeedProfile,
  pos: Position,
  c: DraftConstants = draftConstants,
): number {
  const saturated = needs.saturated.includes(pos) ? c.satPenalty : 1
  return (1 + c.needScale * needs.byPos[pos] * c.posImportance[pos]) * saturated
}
