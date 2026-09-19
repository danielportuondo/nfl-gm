/**
 * Procedural draft-class generator (HANDOFF §6.7, §6.2 pick→outcome tables). Post-history only: real
 * seasons use the real class from the chunk (draft-ai's `loadProspects`), never this.
 *
 * The draft season for a generated class is `state.season` — lifecycle has no opinion on which
 * in-game phase mapped to it; that convention lives in `draft.buildDraftOrder`/`loadProspects` (3A).
 */
import {
  POSITIONS,
  type CurvesFile,
  type GeneratedClass,
  type LeagueState,
  type PlayerId,
  type Position,
  type Prospect,
  type Rng,
  type ScoutingView,
  type Season,
  type TrueTrajectory,
} from '@contracts/index'
import {
  BUST_MAX_CAREER_YEARS,
  BUST_PERCENTILE_CAP,
  CLASS_SIZE_JITTER,
  DRAFT_SLOT_NOISE_SCALE,
  OUTCOME_YEAR_NOISE_SD,
  ROOKIE_AGE_MAX,
  ROOKIE_AGE_MIN,
  ROOKIE_CONFIDENCE_DRAFTED,
  ROOKIE_CONFIDENCE_UDFA,
  UDFA_POT_NOISE_SD,
  UDFA_POT_QUANTILE_LEVELS,
} from './constants'
import {
  bucketForPick,
  clampRating,
  findOutcomeTable,
  interpolateAtLevel,
  interpolateSlotGrade,
  outcomeValueAt,
} from './curves'
import { generateName } from './names'

function sampleCount(rng: Rng, base: number, label: string): number {
  return Math.max(1, base + rng.fork(label).int(-CLASS_SIZE_JITTER, CLASS_SIZE_JITTER))
}

function samplePosition(rng: Rng, curves: CurvesFile, id: string): Position {
  const total = POSITIONS.reduce((sum, p) => sum + (curves.positionMix[p] ?? 0), 0) || 1
  let u = rng.fork(`${id}:pos`).next() * total
  for (const p of POSITIONS) {
    u -= curves.positionMix[p] ?? 0
    if (u <= 0) return p
  }
  return POSITIONS[POSITIONS.length - 1]!
}

function sampleTrajectory(
  curves: CurvesFile,
  pos: Position,
  bucket: string,
  draftSeason: Season,
  rng: Rng,
  id: string,
): TrueTrajectory {
  const table = findOutcomeTable(curves, bucket, pos)
  if (!table) return { bySeason: {}, retiresAfter: draftSeason - 1 }
  const bust = rng.fork(`${id}:bust`).chance(table.bustRate)
  const u = bust ? rng.fork(`${id}:pct`).next() * BUST_PERCENTILE_CAP : rng.fork(`${id}:pct`).next()
  const maxYears = Math.max(...table.years)
  const careerYears = bust
    ? Math.min(maxYears, rng.fork(`${id}:bustYears`).int(1, BUST_MAX_CAREER_YEARS))
    : maxYears
  const bySeason: Record<string, number> = {}
  for (const yearIdx of table.years) {
    if (yearIdx > careerYears) continue
    const base = outcomeValueAt(table, yearIdx, u)
    const noise = rng.fork(`${id}:year:${yearIdx}`).normal(0, OUTCOME_YEAR_NOISE_SD)
    bySeason[String(draftSeason + yearIdx - 1)] = clampRating(base + noise)
  }
  return { bySeason, retiresAfter: bust ? draftSeason + careerYears - 1 : null }
}

function draftedConsensus(curves: CurvesFile, pick: number, rng: Rng, id: string): ScoutingView {
  const slot = interpolateSlotGrade(curves, pick)
  const ovr = clampRating(
    slot.ovr + rng.fork(`${id}:ovrNoise`).normal(0, slot.sd * DRAFT_SLOT_NOISE_SCALE),
  )
  // Independent noise on ovr and pot could invert them; a prospect's ceiling is never below his floor.
  const pot = clampRating(
    Math.max(
      ovr,
      slot.pot + rng.fork(`${id}:potNoise`).normal(0, slot.sd * DRAFT_SLOT_NOISE_SCALE),
    ),
  )
  return { ovr, pot, confidence: ROOKIE_CONFIDENCE_DRAFTED }
}

function udfaConsensus(curves: CurvesFile, rng: Rng, id: string): ScoutingView {
  const ovr = clampRating(
    rng.fork(`${id}:ovrNoise`).normal(curves.udfaGrade.ovrMean, curves.udfaGrade.ovrSd),
  )
  const u = rng.fork(`${id}:potPct`).next()
  const potBase = interpolateAtLevel(UDFA_POT_QUANTILE_LEVELS, curves.udfaGrade.potQuantiles, u)
  const pot = clampRating(
    Math.max(ovr, potBase + rng.fork(`${id}:potNoise`).normal(0, UDFA_POT_NOISE_SD)),
  )
  return { ovr, pot, confidence: ROOKIE_CONFIDENCE_UDFA }
}

function buildProspect(
  curves: CurvesFile,
  rng: Rng,
  id: PlayerId,
  season: Season,
  pick: number | null,
): { prospect: Prospect; truth: TrueTrajectory } {
  const pos = samplePosition(rng, curves, id)
  const age = rng.fork(`${id}:age`).int(ROOKIE_AGE_MIN, ROOKIE_AGE_MAX)
  const scouting =
    pick != null ? draftedConsensus(curves, pick, rng, id) : udfaConsensus(curves, rng, id)
  const bucket = pick != null ? bucketForPick(pick) : 'UDFA'
  const truth = sampleTrajectory(curves, pos, bucket, season, rng, id)
  const prospect: Prospect = {
    id,
    name: generateName(curves, rng, id),
    pos,
    birthYear: season - age,
    heightIn: rng.fork(`${id}:height`).int(68, 80),
    weightLb: rng.fork(`${id}:weight`).int(175, 330),
    draft: null,
    real: false,
    rookieSeason: season,
    scouting,
  }
  return { prospect, truth }
}

export function generateDraftClass(
  state: LeagueState,
  curves: CurvesFile,
  rng: Rng,
): GeneratedClass {
  const season = state.season
  const draftedCount = sampleCount(rng, curves.classSize.drafted, 'draftedCount')
  const udfaCount = sampleCount(rng, curves.classSize.udfa, 'udfaCount')

  const prospects: Prospect[] = []
  const truth: LeagueState['truth'] = {}
  let n = 0
  const nextId = (): PlayerId => `gen-${state.seed}-${season}-${String(++n).padStart(4, '0')}`

  for (let pick = 1; pick <= draftedCount; pick++) {
    const id = nextId()
    const built = buildProspect(curves, rng, id, season, pick)
    prospects.push(built.prospect)
    truth[id] = built.truth
  }
  for (let i = 0; i < udfaCount; i++) {
    const id = nextId()
    const built = buildProspect(curves, rng, id, season, null)
    prospects.push(built.prospect)
    truth[id] = built.truth
  }

  const order = [...prospects]
    .sort(
      (a, b) =>
        b.scouting.pot - a.scouting.pot ||
        b.scouting.ovr - a.scouting.ovr ||
        a.id.localeCompare(b.id),
    )
    .map((p) => p.id)

  return { prospects, truth, order, draftedCount }
}
