/**
 * Box scores (HANDOFF §6.3). Team totals are derived from the final score, then handed to players by
 * usage weights from position, true value and noise. Every allocation sums exactly to the team total:
 * receiving yards equal passing yards, receptions equal completions, targets equal attempts.
 */
import type {
  BoxScore,
  LeagueState,
  PlayerGameLine,
  PlayerId,
  Position,
  Rng,
  TeamId,
} from '@contracts/index'
import { POSITIONS } from '@contracts/index'
import { boxConstants as B } from './constants'
import { pickDecomposition } from './points'
import { trueValue } from './strength'

/** Largest-remainder split of `total` across `weights`. Sums exactly; never negative. */
export function apportion(total: number, weights: readonly number[]): number[] {
  const n = weights.length
  const out = new Array<number>(n).fill(0)
  if (n === 0 || total <= 0) return out
  let sum = 0
  for (const w of weights) sum += Math.max(0, w)
  if (sum <= 0) {
    out[0] = total
    return out
  }
  const order: number[] = []
  const frac: number[] = []
  let used = 0
  for (let i = 0; i < n; i++) {
    const exact = (total * Math.max(0, weights[i]!)) / sum
    const floor = Math.floor(exact)
    out[i] = floor
    used += floor
    order.push(i)
    frac.push(exact - floor)
  }
  order.sort((a, b) => frac[b]! - frac[a]! || a - b)
  for (let i = 0; used < total; i++, used++) out[order[i % n]!]! += 1
  return out
}

/** Move counts down to their caps, spilling the excess onto entries with room. */
function capAllocation(values: number[], caps: readonly number[]): number[] {
  const out = [...values]
  for (let i = 0; i < out.length; i++) {
    let excess = out[i]! - caps[i]!
    if (excess <= 0) continue
    out[i] = caps[i]!
    for (let j = 0; j < out.length && excess > 0; j++) {
      if (j === i) continue
      const room = caps[j]! - out[j]!
      if (room <= 0) continue
      const move = Math.min(room, excess)
      out[j]! += move
      excess -= move
    }
  }
  return out
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Index drawn in proportion to `weights` (need not sum to 1). */
function pickWeightedIndex(weights: readonly number[], rng: Rng): number {
  let sum = 0
  for (const w of weights) sum += Math.max(0, w)
  let r = rng.next() * sum
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]!)
    if (r <= 0 && weights[i]! > 0) return i
  }
  return weights.length - 1
}

function pickIndex(dist: readonly number[], rng: Rng): number {
  let r = rng.next()
  for (let i = 0; i < dist.length; i++) {
    r -= dist[i]!
    if (r <= 0) return i
  }
  return dist.length - 1
}

export interface OffenseTotals {
  passAtt: number
  passCmp: number
  passYds: number
  passTd: number
  passInt: number
  rushAtt: number
  rushYds: number
  rushTd: number
  fgm: number
  fga: number
  xpm: number
  xpa: number
  punts: number
  puntYds: number
  twoPt: number
  safeties: number
  defTd: number
  retTd: number
}

export function offenseTotals(points: number, rng: Rng): OffenseTotals {
  const d = pickDecomposition(points, rng)

  const yards = clamp(
    Math.round(rng.normal(B.yardsBase + B.yardsPerPoint * points, B.yardsSd)),
    B.yardsMin,
    B.yardsMax,
  )
  const passShare = clamp(
    rng.normal(B.passShareMean, B.passShareSd),
    B.passShareMin,
    B.passShareMax,
  )
  const passYds = Math.round(yards * passShare)
  const rushYds = yards - passYds

  const ypa = clamp(rng.normal(B.ypaMean, B.ypaSd), B.ypaMin, B.ypaMax)
  const passAtt = clamp(Math.round(passYds / ypa), B.passAttMin, B.passAttMax)
  const cmpPct = clamp(rng.normal(B.cmpMean, B.cmpSd), B.cmpMin, B.cmpMax)
  const passCmp = clamp(Math.round(passAtt * cmpPct), 1, passAtt)

  const ypc = clamp(rng.normal(B.ypcMean, B.ypcSd), B.ypcMin, B.ypcMax)
  const rushAtt = clamp(Math.round(rushYds / ypc), B.rushAttMin, B.rushAttMax)

  let passTd = 0
  let defTd = 0
  let retTd = 0
  for (let i = 0; i < d.td; i++) {
    if (rng.chance(B.nonOffenseTdShare)) {
      if (rng.chance(B.defShareOfNonOffenseTd)) defTd++
      else retTd++
    } else if (rng.chance(B.passTdShare)) passTd++
  }
  passTd = Math.min(passTd, passCmp)
  const rushTd = d.td - defTd - retTd - passTd

  const passInt = Math.min(pickIndex(B.intDist, rng), Math.max(0, passAtt - passCmp))

  let fga = d.fg
  for (const p of B.fgMissP) if (rng.chance(p)) fga += 1
  const xpa = d.td - d.twoPt
  const xpm = Math.max(0, xpa - d.missedXp)

  const punts = clamp(
    Math.round(rng.normal(B.puntsBase - points * B.puntsPerPoint, B.puntsSd)),
    1,
    10,
  )
  const puntYds = punts * Math.round(clamp(rng.normal(B.puntYdsMean, B.puntYdsSd), 30, 60))

  return {
    passAtt,
    passCmp,
    passYds,
    passTd,
    passInt,
    rushAtt,
    rushYds: Math.max(0, rushYds),
    rushTd: Math.max(0, rushTd),
    fgm: d.fg,
    fga,
    xpm,
    xpa,
    punts,
    puntYds,
    twoPt: d.twoPt,
    safeties: d.safety,
    defTd,
    retTd,
  }
}

interface Usage {
  id: PlayerId
  weight: number
}

/** One usage weight per player: positional baseline × true-value tilt × log-normal noise. */
function usage(
  state: LeagueState,
  ids: readonly PlayerId[],
  baseline: readonly number[],
  rng: Rng,
): Usage[] {
  const n = Math.min(ids.length, baseline.length)
  if (n === 0) return []
  let sum = 0
  const values: number[] = []
  for (let i = 0; i < n; i++) {
    const v = trueValue(state, ids[i]!)
    values.push(v)
    sum += v
  }
  const mean = sum / n
  const out: Usage[] = []
  for (let i = 0; i < n; i++) {
    const w =
      baseline[i]! *
      Math.exp(B.valueTilt * (values[i]! - mean)) *
      Math.exp(rng.normal(0, B.usageNoiseSd))
    out.push({ id: ids[i]!, weight: Math.max(1e-6, w) })
  }
  return out
}

const ones = (n: number) => new Array<number>(n).fill(1)

type ScoringKey = 'twoPt' | 'defTd' | 'retTd' | 'safeties'

/**
 * Hands `count` scores to players drawn by usage weight, so the box adds up to the final score.
 * `fallback` takes them when the team has nobody in the candidate pool (a depleted roster).
 */
function creditScores(
  lines: Map<PlayerId, PlayerGameLine>,
  teamId: TeamId,
  key: ScoringKey,
  count: number,
  candidates: readonly Usage[],
  fallback: PlayerId | undefined,
  rng: Rng,
): void {
  const weights = candidates.map((c) => c.weight)
  for (let i = 0; i < count; i++) {
    const id = candidates.length > 0 ? candidates[pickWeightedIndex(weights, rng)]!.id : fallback
    if (id === undefined) return
    const line = lineFor(lines, teamId, id)
    line[key] = (line[key] ?? 0) + 1
  }
}

function firstPlayer(byPos: Record<Position, PlayerId[]>): PlayerId | undefined {
  for (const pos of POSITIONS) if (byPos[pos][0] !== undefined) return byPos[pos][0]
  return undefined
}

function lineFor(
  lines: Map<PlayerId, PlayerGameLine>,
  teamId: TeamId,
  id: PlayerId,
): PlayerGameLine {
  let line = lines.get(id)
  if (!line) {
    line = { playerId: id, teamId }
    lines.set(id, line)
  }
  return line
}

export interface TeamBoxInput {
  teamId: TeamId
  byPos: Record<Position, PlayerId[]>
  totals: OffenseTotals
  /** Interceptions this defense takes away, i.e. the opponent's passInt. */
  takeaways: number
}

export function teamLines(state: LeagueState, input: TeamBoxInput, rng: Rng): PlayerGameLine[] {
  const { teamId, byPos, totals } = input
  const lines = new Map<PlayerId, PlayerGameLine>()
  const qb = byPos.QB[0]

  if (qb !== undefined && totals.passAtt > 0) {
    const line = lineFor(lines, teamId, qb)
    line.passAtt = totals.passAtt
    line.passCmp = totals.passCmp
    line.passYds = totals.passYds
    line.passTd = totals.passTd
    line.passInt = totals.passInt
  }

  const rushers: Usage[] = [
    ...(qb !== undefined ? usage(state, [qb], [B.rushWeights.QB], rng) : []),
    ...usage(state, byPos.RB, B.rushWeights.RB, rng),
    ...usage(state, byPos.WR, [B.rushWeights.WR], rng),
  ]
  if (rushers.length > 0 && totals.rushAtt > 0) {
    const att = apportion(
      totals.rushAtt,
      rushers.map((r) => r.weight),
    )
    const yds = apportion(
      totals.rushYds,
      att.map((a) => a * Math.exp(rng.normal(0, B.usageNoiseSd))),
    )
    const tds = capAllocation(apportion(totals.rushTd, att), att)
    rushers.forEach((r, i) => {
      if (att[i]! === 0 && yds[i]! === 0) return
      const line = lineFor(lines, teamId, r.id)
      line.rushAtt = (line.rushAtt ?? 0) + att[i]!
      line.rushYds = (line.rushYds ?? 0) + yds[i]!
      if (tds[i]! > 0) line.rushTd = (line.rushTd ?? 0) + tds[i]!
    })
  }

  const receivers: Usage[] =
    qb === undefined
      ? []
      : [
          ...usage(state, byPos.WR, B.recWeights.WR, rng),
          ...usage(state, byPos.TE, B.recWeights.TE, rng),
          ...usage(state, byPos.RB, B.recWeights.RB, rng),
        ]
  if (receivers.length > 0 && totals.passAtt > 0) {
    const targets = apportion(
      totals.passAtt,
      receivers.map((r) => r.weight),
    )
    const rec = capAllocation(apportion(totals.passCmp, targets), targets)
    const recYds = apportion(
      totals.passYds,
      rec.map((r) => r * Math.exp(rng.normal(0, B.usageNoiseSd))),
    )
    const recTd = capAllocation(apportion(totals.passTd, rec), rec)
    receivers.forEach((r, i) => {
      if (targets[i]! === 0 && recYds[i]! === 0) return
      const line = lineFor(lines, teamId, r.id)
      line.targets = (line.targets ?? 0) + targets[i]!
      line.rec = (line.rec ?? 0) + rec[i]!
      line.recYds = (line.recYds ?? 0) + recYds[i]!
      if (recTd[i]! > 0) line.recTd = (line.recTd ?? 0) + recTd[i]!
    })
  }

  const fallback = firstPlayer(byPos)
  creditScores(lines, teamId, 'twoPt', totals.twoPt, [...rushers, ...receivers], fallback, rng)

  const defenders: Usage[] = []
  const tackleW: number[] = []
  const sackW: number[] = []
  const intW: number[] = []
  const pdW: number[] = []
  const ffW: number[] = []
  const defTdW: number[] = []
  const safetyW: number[] = []
  for (const group of ['DL', 'LB', 'CB', 'S'] as const) {
    for (const p of usage(state, byPos[group], ones(B.defenders[group]), rng)) {
      defenders.push(p)
      tackleW.push(B.tackleWeights[group] * p.weight)
      sackW.push(B.sackWeights[group] * p.weight)
      intW.push(B.intWeights[group] * p.weight)
      pdW.push(B.pdWeights[group] * p.weight)
      ffW.push(B.ffWeights[group] * p.weight)
      defTdW.push(B.defTdWeights[group] * p.weight)
      safetyW.push(B.safetyWeights[group] * p.weight)
    }
  }
  const weighted = (w: readonly number[]): Usage[] =>
    defenders.map((d, i) => ({ id: d.id, weight: w[i]! }))
  creditScores(lines, teamId, 'defTd', totals.defTd, weighted(defTdW), fallback, rng)
  creditScores(lines, teamId, 'safeties', totals.safeties, weighted(safetyW), fallback, rng)

  const returners: Usage[] = [
    ...usage(state, byPos.WR, B.returnWeights.WR, rng),
    ...usage(state, byPos.RB, B.returnWeights.RB, rng),
    ...usage(state, byPos.CB, B.returnWeights.CB, rng),
  ]
  creditScores(lines, teamId, 'retTd', totals.retTd, returners, fallback, rng)
  if (defenders.length > 0) {
    const tackles = apportion(
      clamp(Math.round(rng.normal(B.tacklesMean, B.tacklesSd)), 35, 90),
      tackleW,
    )
    const sacks = apportion(
      clamp(Math.round(rng.normal(B.sacksMean, B.sacksSd)), 0, B.sacksMax),
      sackW,
    )
    const ints = apportion(input.takeaways, intW)
    const pds = apportion(clamp(Math.round(rng.normal(B.pdMean, B.pdSd)), 0, B.pdMax), pdW)
    const ffs = apportion(pickIndex(B.ffDist, rng), ffW)
    defenders.forEach((d, i) => {
      const line = lineFor(lines, teamId, d.id)
      if (tackles[i]! > 0) line.tackles = (line.tackles ?? 0) + tackles[i]!
      if (sacks[i]! > 0) line.sacks = (line.sacks ?? 0) + sacks[i]!
      if (ints[i]! > 0) line.ints = (line.ints ?? 0) + ints[i]!
      if (pds[i]! > 0) line.passesDefended = (line.passesDefended ?? 0) + pds[i]!
      if (ffs[i]! > 0) line.forcedFumbles = (line.forcedFumbles ?? 0) + ffs[i]!
    })
  }

  // With no kicker dressed the punter kicks, so the extra points and field goals still reach the box.
  const kicker = byPos.K[0] ?? byPos.P[0] ?? fallback
  if (kicker !== undefined && totals.fga + totals.xpa > 0) {
    const line = lineFor(lines, teamId, kicker)
    line.fgm = totals.fgm
    line.fga = totals.fga
    line.xpm = totals.xpm
    line.xpa = totals.xpa
  }
  const punter = byPos.P[0] ?? byPos.K[0]
  if (punter !== undefined && totals.punts > 0) {
    const line = lineFor(lines, teamId, punter)
    line.punts = totals.punts
    line.puntYds = totals.puntYds
  }

  return [...lines.values()].filter((line) => Object.keys(line).length > 2)
}

export function buildBoxScore(
  state: LeagueState,
  home: TeamBoxInput,
  away: TeamBoxInput,
  rng: Rng,
): BoxScore {
  return { home: teamLines(state, home, rng), away: teamLines(state, away, rng) }
}
