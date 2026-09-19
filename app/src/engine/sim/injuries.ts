/**
 * Per-game injury sampling (HANDOFF §6.3). One roll per dressed player per game against the fitted
 * position rate; duration and kind come straight from the empirical distributions in the data file.
 */
import type {
  EngineContext,
  InjuryEvent,
  LeagueState,
  PlayerId,
  Position,
  Rng,
  TeamId,
} from '@contracts/index'
import { POSITIONS } from '@contracts/index'
import { injuryConstants } from './constants'

function pickWeighted<T>(items: readonly { p: number }[], rng: Rng, map: (i: number) => T): T {
  let sum = 0
  for (const item of items) sum += Math.max(0, item.p)
  if (sum <= 0) return map(0)
  let r = rng.next() * sum
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, items[i]!.p)
    if (r <= 0) return map(i)
  }
  return map(items.length - 1)
}

/** Dressed players, depth-chart order, capped at the active roster size. */
export function activePlayers(
  byPos: Record<Position, PlayerId[]>,
): { id: PlayerId; pos: Position }[] {
  const active: { id: PlayerId; pos: Position }[] = []
  let depth = 0
  // Round-robin down the chart so the dressed squad is spread across positions, not all of one group.
  for (let more = true; more && active.length < injuryConstants.activePerGame; depth++) {
    more = false
    for (const pos of POSITIONS) {
      const id = byPos[pos][depth]
      if (id === undefined) continue
      more = true
      if (active.length >= injuryConstants.activePerGame) break
      active.push({ id, pos })
    }
  }
  return active
}

export function sampleInjuries(
  state: LeagueState,
  ctx: EngineContext,
  teamId: TeamId,
  byPos: Record<Position, PlayerId[]>,
  rng: Rng,
): InjuryEvent[] {
  if (!state.settings.injuries) return []
  const model = ctx.data.injuryModel
  const events: InjuryEvent[] = []
  for (const { id, pos } of activePlayers(byPos)) {
    const rate = (model.ratePerPlayerGame[pos] ?? 0) * injuryConstants.rateScale
    if (!rng.chance(rate)) continue
    const weeksOut = pickWeighted(model.duration, rng, (i) => model.duration[i]?.weeks ?? 1)
    const kind = pickWeighted(model.kinds, rng, (i) => model.kinds[i]?.kind ?? 'undisclosed')
    events.push({
      playerId: id,
      teamId,
      weeksOut: Math.min(injuryConstants.maxWeeksOut, Math.max(1, weeksOut)),
      kind,
    })
  }
  return events
}
