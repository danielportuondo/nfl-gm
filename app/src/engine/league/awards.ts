/**
 * engine/league/awards — end-of-season honors (docs/HANDOFF.md §6.3).
 * Everything here derives from regular-season box scores (state.results[].box), team records, and
 * consensus (state.scouting / league.autoDepthChart) only. NEVER reads state.truth or trajectories.
 */
import {
  POSITIONS,
  STARTER_TEMPLATE,
  type Award,
  type AwardId,
  type EngineContext,
  type LeagueState,
  type Player,
  type PlayerGameLine,
  type PlayerId,
  type Position,
  type TeamId,
  type TeamRecord,
} from '@contracts/index'
import {
  COY_PROJECTION,
  DEFENSE_BENCHMARK,
  DEFENSE_SCORE_WEIGHTS,
  DPOY_POSITION_WEIGHT,
  DROY_POSITION_WEIGHT,
  MVP_POSITION_WEIGHT,
  MVP_TEAM_SUCCESS,
  NOTE_MIN_SECONDARY_YARDS,
  OFFENSE_BENCHMARK,
  OFFENSE_SCORE_WEIGHTS,
  OPOY_POSITION_WEIGHT,
  OROY_POSITION_WEIGHT,
} from './constants'

const ZERO_RECORD: TeamRecord = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }

// -------------------------------------------------------------------------------------------
// Shared formatting
// -------------------------------------------------------------------------------------------

function formatNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)
}

function formatRecord(record: TeamRecord): string {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`
}

function winPct(record: TeamRecord): number {
  const games = record.wins + record.losses + record.ties
  if (games === 0) return 0
  return (record.wins + 0.5 * record.ties) / games
}

function recordOf(state: LeagueState, teamId: TeamId): TeamRecord {
  return state.teams[teamId]?.record ?? ZERO_RECORD
}

// -------------------------------------------------------------------------------------------
// Per-player season totals from this season's regular-season box scores
// -------------------------------------------------------------------------------------------

type OffenseTotals = {
  passYds: number
  passTd: number
  passInt: number
  rushYds: number
  rushTd: number
  rec: number
  recYds: number
  recTd: number
}

type DefenseTotals = {
  sacks: number
  ints: number
  forcedFumbles: number
  passesDefended: number
  tackles: number
  defTd: number
}

const zeroOffense = (): OffenseTotals => ({
  passYds: 0,
  passTd: 0,
  passInt: 0,
  rushYds: 0,
  rushTd: 0,
  rec: 0,
  recYds: 0,
  recTd: 0,
})

const zeroDefense = (): DefenseTotals => ({
  sacks: 0,
  ints: 0,
  forcedFumbles: 0,
  passesDefended: 0,
  tackles: 0,
  defTd: 0,
})

const OFFENSE_KEYS: (keyof PlayerGameLine)[] = [
  'passYds',
  'passTd',
  'passInt',
  'rushYds',
  'rushTd',
  'rec',
  'recYds',
  'recTd',
]

const DEFENSE_KEYS: (keyof PlayerGameLine)[] = [
  'sacks',
  'ints',
  'forcedFumbles',
  'passesDefended',
  'tackles',
  'defTd',
]

/** The team a player's award-season stats are attributed to: most lines, ties broken alphabetically. */
function dominantTeam(counts: Map<TeamId, number>): TeamId {
  let best: TeamId | undefined
  let bestCount = -1
  for (const teamId of [...counts.keys()].sort()) {
    const count = counts.get(teamId)!
    if (count > bestCount) {
      bestCount = count
      best = teamId
    }
  }
  return best!
}

function collectSeasonTotals(state: LeagueState): {
  teamOf: Map<PlayerId, TeamId>
  offense: Map<PlayerId, OffenseTotals>
  defense: Map<PlayerId, DefenseTotals>
} {
  const regularGameIds = new Set(
    state.schedule.filter((g) => g.season === state.season && g.type === 'REG').map((g) => g.id),
  )
  const teamCounts = new Map<PlayerId, Map<TeamId, number>>()
  const offense = new Map<PlayerId, OffenseTotals>()
  const defense = new Map<PlayerId, DefenseTotals>()

  for (const result of state.results) {
    if (!regularGameIds.has(result.gameId) || !result.box) continue
    for (const line of [...result.box.home, ...result.box.away]) {
      const counts = teamCounts.get(line.playerId) ?? new Map<TeamId, number>()
      counts.set(line.teamId, (counts.get(line.teamId) ?? 0) + 1)
      teamCounts.set(line.playerId, counts)

      if (OFFENSE_KEYS.some((k) => line[k] !== undefined)) {
        const t = offense.get(line.playerId) ?? zeroOffense()
        t.passYds += line.passYds ?? 0
        t.passTd += line.passTd ?? 0
        t.passInt += line.passInt ?? 0
        t.rushYds += line.rushYds ?? 0
        t.rushTd += line.rushTd ?? 0
        t.rec += line.rec ?? 0
        t.recYds += line.recYds ?? 0
        t.recTd += line.recTd ?? 0
        offense.set(line.playerId, t)
      }

      if (DEFENSE_KEYS.some((k) => line[k] !== undefined)) {
        const t = defense.get(line.playerId) ?? zeroDefense()
        t.sacks += line.sacks ?? 0
        t.ints += line.ints ?? 0
        t.forcedFumbles += line.forcedFumbles ?? 0
        t.passesDefended += line.passesDefended ?? 0
        t.tackles += line.tackles ?? 0
        t.defTd += line.defTd ?? 0
        defense.set(line.playerId, t)
      }
    }
  }

  const teamOf = new Map<PlayerId, TeamId>()
  for (const [id, counts] of teamCounts) teamOf.set(id, dominantTeam(counts))
  return { teamOf, offense, defense }
}

function offenseScore(t: OffenseTotals): number {
  const w = OFFENSE_SCORE_WEIGHTS
  return (
    t.passYds * w.passYd +
    t.passTd * w.passTd +
    t.passInt * w.passInt +
    t.rushYds * w.rushYd +
    t.rushTd * w.rushTd +
    t.rec * w.rec +
    t.recYds * w.recYd +
    t.recTd * w.recTd
  )
}

function defenseScore(t: DefenseTotals): number {
  const w = DEFENSE_SCORE_WEIGHTS
  return (
    t.sacks * w.sacks +
    t.ints * w.ints +
    t.forcedFumbles * w.forcedFumbles +
    t.passesDefended * w.passesDefended +
    t.tackles * w.tackles +
    t.defTd * w.defTd
  )
}

/** Yards fragments always say what the yards are; the TD fragment is omitted rather than "0 TD". A
 * ball carrier shows rushing and receiving separately once the smaller part is worth showing. */
export function offenseNote(pos: Position, t: OffenseTotals): string {
  const parts: string[] = []
  let td = t.passTd + t.rushTd + t.recTd
  if (pos === 'QB') {
    parts.push(`${formatNumber(t.passYds)} pass yds`)
    td = t.passTd
  } else {
    const rush = t.rushYds
    const rec = t.recYds
    const showRush = rush >= NOTE_MIN_SECONDARY_YARDS || rush >= rec
    const showRec = rec >= NOTE_MIN_SECONDARY_YARDS || rec > rush
    if (showRush && showRec) {
      parts.push(`${formatNumber(rush)} rush, ${formatNumber(rec)} rec yds`)
    } else if (showRush) {
      parts.push(`${formatNumber(rush)} rush yds`)
    } else {
      parts.push(`${formatNumber(rec)} rec yds`)
    }
  }
  if (td > 0) parts.push(`${td} TD`)
  return parts.join(', ')
}

/** Only the non-zero counting stats among sacks/INT/PD/forced fumbles are shown, in that order; a
 * defender with none of those (e.g. a coverage corner with zero sacks) falls back to tackles. */
export function defenseNote(t: DefenseTotals): string {
  const parts: string[] = []
  if (t.sacks > 0) parts.push(`${formatNumber(t.sacks)} sacks`)
  if (t.ints > 0) parts.push(`${t.ints} INT`)
  if (t.passesDefended > 0) parts.push(`${t.passesDefended} PD`)
  if (t.forcedFumbles > 0) parts.push(`${t.forcedFumbles} FF`)
  return parts.length > 0 ? parts.join(', ') : `${formatNumber(t.tackles)} tackles`
}

// -------------------------------------------------------------------------------------------
// Generic tie-break ranking: score desc, then the candidate's team wins desc, then id asc.
// -------------------------------------------------------------------------------------------

function rank<C>(
  candidates: C[],
  score: (c: C) => number,
  teamWins: (c: C) => number,
  id: (c: C) => string,
): C[] {
  return [...candidates].sort((a, b) => {
    const s = score(b) - score(a)
    if (s !== 0) return s
    const w = teamWins(b) - teamWins(a)
    if (w !== 0) return w
    return id(a).localeCompare(id(b))
  })
}

// -------------------------------------------------------------------------------------------
// Major awards
// -------------------------------------------------------------------------------------------

interface Candidate<T> {
  id: PlayerId
  player: Player
  teamId: TeamId
  totals: T
  /** Raw production score; only comparable within a position. */
  raw: number
  /** raw / the position's benchmark: "how many typical top performers", comparable across positions. */
  adjusted: number
}

type OffenseCandidate = Candidate<OffenseTotals>
type DefenseCandidate = Candidate<DefenseTotals>

interface BenchmarkRule {
  depth: number
  floor: number
}

/** Mean raw score of the top `depth` at the position, never below the rule's floor. */
function benchmark(raws: number[], rule: BenchmarkRule): number {
  const top = [...raws].sort((a, b) => b - a).slice(0, rule.depth)
  const mean = top.length > 0 ? top.reduce((a, b) => a + b, 0) / top.length : 0
  return Math.max(mean, rule.floor)
}

/** Candidates at the positions in `rules` only, each scored against their own position's benchmark. */
function buildCandidates<T>(
  state: LeagueState,
  totals: Map<PlayerId, T>,
  teamOf: Map<PlayerId, TeamId>,
  score: (t: T) => number,
  rules: Partial<Record<Position, BenchmarkRule>>,
): Candidate<T>[] {
  const scored: { id: PlayerId; player: Player; teamId: TeamId; totals: T; raw: number }[] = []
  for (const id of [...totals.keys()].sort()) {
    const player = state.players[id]
    const teamId = teamOf.get(id)
    if (!player || !teamId || !rules[player.pos]) continue // skip missing records and off-award positions
    const t = totals.get(id)!
    scored.push({ id, player, teamId, totals: t, raw: score(t) })
  }
  const benchmarks = new Map<Position, number>()
  for (const pos of POSITIONS) {
    const rule = rules[pos]
    if (!rule) continue
    benchmarks.set(
      pos,
      benchmark(
        scored.filter((c) => c.player.pos === pos).map((c) => c.raw),
        rule,
      ),
    )
  }
  return scored.map((c) => ({ ...c, adjusted: c.raw / benchmarks.get(c.player.pos)! }))
}

function playerAward(
  id: AwardId,
  name: string,
  note: string,
  c: OffenseCandidate | DefenseCandidate,
): Award {
  return {
    id,
    name,
    playerId: c.id,
    playerName: c.player.name,
    pos: c.player.pos,
    teamId: c.teamId,
    note,
  }
}

/** Best-available starters' mean consensus ovr, standing in for expected-team-strength. */
function starterMeanOvr(state: LeagueState, teamId: TeamId, ctx: EngineContext): number {
  const chart = ctx.modules.league.autoDepthChart(state, teamId)
  const starterIds: PlayerId[] = []
  for (const pos of POSITIONS) {
    const ids = chart[pos] ?? []
    starterIds.push(...ids.slice(0, STARTER_TEMPLATE[pos] ?? 0))
  }
  const ovrs = starterIds
    .map((id) => state.scouting[id]?.ovr)
    .filter((v): v is number => v !== undefined)
  return ovrs.length > 0 ? ovrs.reduce((a, b) => a + b, 0) / ovrs.length : 0
}

function coyAward(state: LeagueState, ctx: EngineContext): Award | null {
  const teamIds = Object.keys(state.teams).sort()
  if (teamIds.length === 0) return null
  const ranked = teamIds
    .map((teamId) => ({ teamId, mean: starterMeanOvr(state, teamId, ctx) }))
    .sort((a, b) => (b.mean !== a.mean ? b.mean - a.mean : a.teamId.localeCompare(b.teamId)))

  let best: { teamId: TeamId; diff: number; wins: number; projected: number } | null = null
  ranked.forEach((r, i) => {
    const rankNo = i + 1
    const pct =
      COY_PROJECTION.topPct - COY_PROJECTION.spread * ((rankNo - 1) / COY_PROJECTION.rankDenom)
    const record = recordOf(state, r.teamId)
    const games = record.wins + record.losses + record.ties
    const projected = pct * games
    const diff = record.wins - projected
    const better =
      !best ||
      diff > best.diff ||
      (diff === best.diff && record.wins > best.wins) ||
      (diff === best.diff && record.wins === best.wins && r.teamId.localeCompare(best.teamId) < 0)
    if (better) best = { teamId: r.teamId, diff, wins: record.wins, projected }
  })
  if (!best) return null
  const winner = best as { teamId: TeamId; diff: number; wins: number; projected: number }
  const record = recordOf(state, winner.teamId)
  return {
    id: 'COY',
    name: 'Coach of the year',
    teamId: winner.teamId,
    note: `${formatRecord(record)}, projected ${Math.round(winner.projected)} wins`,
  }
}

const weightOf = (weights: Partial<Record<Position, number>>, pos: Position): number =>
  weights[pos] ?? 0

/** Team factor for MVP: a winning team lifts a candidate, a losing one holds him back. */
function teamSuccess(record: TeamRecord): number {
  const { weight, floor } = MVP_TEAM_SUCCESS
  return Math.max(floor, 1 + weight * (winPct(record) - 0.5))
}

/** The six major, consensus/box-score-derived awards, in MVP/OPOY/DPOY/OROY/DROY/COY order. */
function majorAwards(state: LeagueState, ctx: EngineContext): Award[] {
  const { teamOf, offense, defense } = collectSeasonTotals(state)
  const offenseCandidates = buildCandidates(state, offense, teamOf, offenseScore, OFFENSE_BENCHMARK)
  const defenseCandidates = buildCandidates(state, defense, teamOf, defenseScore, DEFENSE_BENCHMARK)
  const teamWins = (c: { teamId: TeamId }): number => recordOf(state, c.teamId).wins
  const byWeight =
    (weights: Partial<Record<Position, number>>) =>
    (c: Candidate<unknown>): number =>
      c.adjusted * weightOf(weights, c.player.pos)

  const awards: Award[] = []

  const mvpRanked = rank(
    offenseCandidates,
    (c) => byWeight(MVP_POSITION_WEIGHT)(c) * teamSuccess(recordOf(state, c.teamId)),
    teamWins,
    (c) => c.id,
  )
  const mvp = mvpRanked[0]
  if (mvp) {
    const note = `${offenseNote(mvp.player.pos, mvp.totals)}, ${formatRecord(recordOf(state, mvp.teamId))}`
    awards.push(playerAward('MVP', 'Most valuable player', note, mvp))
  }

  const opoyRanked = rank(
    offenseCandidates.filter((c) => c.id !== mvp?.id),
    byWeight(OPOY_POSITION_WEIGHT),
    teamWins,
    (c) => c.id,
  )
  const opoy = opoyRanked[0]
  if (opoy) {
    awards.push(
      playerAward(
        'OPOY',
        'Offensive player of the year',
        offenseNote(opoy.player.pos, opoy.totals),
        opoy,
      ),
    )
  }

  const dpoyRanked = rank(defenseCandidates, byWeight(DPOY_POSITION_WEIGHT), teamWins, (c) => c.id)
  const dpoy = dpoyRanked[0]
  if (dpoy) {
    awards.push(playerAward('DPOY', 'Defensive player of the year', defenseNote(dpoy.totals), dpoy))
  }

  const rookies = <T>(cs: Candidate<T>[]): Candidate<T>[] =>
    cs.filter((c) => c.player.rookieSeason === state.season && c.raw > 0)

  const oroyRanked = rank(
    rookies(offenseCandidates),
    byWeight(OROY_POSITION_WEIGHT),
    teamWins,
    (c) => c.id,
  )
  const oroy = oroyRanked[0]
  if (oroy) {
    awards.push(
      playerAward(
        'OROY',
        'Offensive rookie of the year',
        offenseNote(oroy.player.pos, oroy.totals),
        oroy,
      ),
    )
  }

  const droyRanked = rank(
    rookies(defenseCandidates),
    byWeight(DROY_POSITION_WEIGHT),
    teamWins,
    (c) => c.id,
  )
  const droy = droyRanked[0]
  if (droy) {
    awards.push(playerAward('DROY', 'Defensive rookie of the year', defenseNote(droy.totals), droy))
  }

  const coy = coyAward(state, ctx)
  if (coy) awards.push(coy)

  return awards
}

// -------------------------------------------------------------------------------------------
// Statistical leaders (unchanged behaviour, moved from engine/league/index.ts)
// -------------------------------------------------------------------------------------------

type StatTotals = {
  passYds: number
  rushYds: number
  recYds: number
  sacks: number
  ints: number
  td: number
}

/** Statistical leaders from the season's regular-season box scores — visible stats only, never truth. */
function statLeaders(state: LeagueState): Award[] {
  const regular = new Set(
    state.schedule.filter((g) => g.season === state.season && g.type === 'REG').map((g) => g.id),
  )
  const totals = new Map<PlayerId, StatTotals>()
  for (const result of state.results) {
    if (!regular.has(result.gameId) || !result.box) continue
    for (const line of [...result.box.home, ...result.box.away]) {
      const t = totals.get(line.playerId) ?? {
        passYds: 0,
        rushYds: 0,
        recYds: 0,
        sacks: 0,
        ints: 0,
        td: 0,
      }
      t.passYds += line.passYds ?? 0
      t.rushYds += line.rushYds ?? 0
      t.recYds += line.recYds ?? 0
      t.sacks += line.sacks ?? 0
      t.ints += line.ints ?? 0
      t.td += (line.passTd ?? 0) + (line.rushTd ?? 0) + (line.recTd ?? 0)
      totals.set(line.playerId, t)
    }
  }
  const teamOf = new Map<PlayerId, TeamId>()
  for (const teamId of Object.keys(state.teams).sort()) {
    for (const slot of state.teams[teamId]!.roster) teamOf.set(slot.playerId, teamId)
  }
  const leader = (name: string, key: keyof StatTotals, unit: string): Award | null => {
    let best: { id: PlayerId; value: number } | null = null
    for (const [id, t] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (t[key] > 0 && (best === null || t[key] > best.value)) best = { id, value: t[key] }
    }
    if (!best) return null
    const shown = Number.isInteger(best.value)
      ? best.value.toLocaleString('en-US')
      : best.value.toFixed(1)
    return { name, playerId: best.id, teamId: teamOf.get(best.id), note: `${shown} ${unit}` }
  }
  return [
    leader('Passing leader', 'passYds', 'yards'),
    leader('Rushing leader', 'rushYds', 'yards'),
    leader('Receiving leader', 'recYds', 'yards'),
    leader('Touchdowns leader', 'td', 'touchdowns'),
    leader('Sack leader', 'sacks', 'sacks'),
    leader('Interceptions leader', 'ints', 'interceptions'),
  ].filter((a): a is Award => a !== null)
}

/** All season awards: the six majors (when they exist) followed by the six stat leaders. */
export function seasonAwards(state: LeagueState, ctx: EngineContext): Award[] {
  return [...majorAwards(state, ctx), ...statLeaders(state)]
}
