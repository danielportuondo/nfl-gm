/**
 * Schema-valid fake league for engine and UI work before real data exists (docs/HANDOFF.md §7 Phase 0 #5).
 * Deterministic from `seed`. 32 teams × 53 players + ~60 free agents; `mockBundle` adds a matching
 * StaticData + one SeasonData chunk (with a 224-pick draft class) + trajectories, i.e. a MemoryBundle.
 *
 * Nothing here is real: names are generated, ratings are random, `real: false` everywhere.
 */
import {
  ATTRIBUTION, DIVISIONS, POSITIONS, ROSTER_TEMPLATE_53, STARTER_TEMPLATE, TEAM_IDS, leagueFormat,
  type CapFile, type CurvesFile, type DepthChart, type DraftPick, type Game, type GameSettings,
  type InjuryModelFile, type LeagueState, type Manifest, type MemoryBundle, type Player, type PlayerId,
  type Position, type Prospect, type RosterSlot, type ScoutingView, type SeasonData, type SeasonPlayer,
  type StaticData, type TeamId, type TeamInfo, type TeamState, type TrajectoryTable, type TrueTrajectory,
  SAVE_SCHEMA_VERSION,
} from '@contracts/index'

// --- tiny self-contained PRNG (the real engine/rng is 1C's; fixtures must not depend on it) --------
function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h ^= h >>> 16
  return h >>> 0
}
class Prng {
  private a: number
  constructor(seed: string) { this.a = hashSeed(seed) }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  int(min: number, max: number): number { return min + Math.floor(this.next() * (max - min + 1)) }
  normal(mean = 0, sd = 1): number {
    const u = 1 - this.next(), v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  pick<T>(xs: readonly T[]): T { return xs[this.int(0, xs.length - 1)]! }
}

const clampRating = (x: number) => Math.round(Math.min(99, Math.max(40, x)))

const FIRST = ['Avery','Blake','Cameron','Dakota','Ellis','Finley','Gray','Harper','Indigo','Jules','Kai','Lane','Marlow','Noel','Oakley','Parker','Quinn','Reese','Sage','Tatum','Uriel','Vale','Wren','Xavi','Yael','Zion','Arden','Bryn','Cody','Dell','Emery','Flynn','Grier','Hollis','Ira','Jett','Kit','Linden','Merritt','Nico','Ozzie','Perry','Ramsey','Shiloh','Toby','Vaughn','Wiley','Yancy','Zeke','Bo','Cruz','Dex','Ford','Hale','Jory','Knox','Lux','Mace','Nash','Otis','Pax','Rio','Sol','Tex']
const LAST = ['Abernathy','Bostwick','Calloway','Dunmore','Eastwood','Fairbanks','Galloway','Hartwell','Ingram','Jessup','Kendrick','Lockhart','Marchetti','Norwood','Oakes','Pemberton','Quintrell','Rutherford','Stroud','Thackery','Underhill','Vandermeer','Whitlock','Yarrow','Zeller','Ashby','Brantley','Cordova','Delgado','Everly','Fontaine','Granger','Holloway','Iverson','Jankowski','Keating','Lindqvist','Montague','Navarro','Okafor','Prescott','Rasmussen','Sandoval','Tremblay','Ulrich','Villanueva','Westbrook','Yoshida','Zapata','Beaumont','Castellano','Drummond','Ellison','Farrow','Goodwin','Hathaway','Kingsley','Lowell','Mercer','Nakamura','Osborne','Pruitt','Rowan','Sheffield']

const CAP_BY_SEASON: Record<string, number> = {
  '2010': 123.0, '2011': 120.375, '2012': 120.6, '2013': 123.0, '2014': 133.0, '2015': 143.28, '2016': 155.27,
  '2017': 167.0, '2018': 177.2, '2019': 188.2, '2020': 198.2, '2021': 182.5, '2022': 208.2, '2023': 224.8,
  '2024': 255.4, '2025': 279.2,
}

const PEAK_AGE: Record<Position, number> = { QB: 31, RB: 25, WR: 27, TE: 28, OL: 29, DL: 27, LB: 27, CB: 26, S: 27, K: 33, P: 33 }

export interface MockOptions {
  seed?: string
  season?: number
  userTeam?: TeamId
  horizonSeasons?: number
  settings?: Partial<GameSettings>
  /** Extra unsigned players in the FA pool. */
  freeAgents?: number
}

interface Built {
  players: Record<PlayerId, Player>
  scouting: Record<PlayerId, ScoutingView>
  truth: Record<PlayerId, TrueTrajectory>
  teams: Record<TeamId, TeamState>
  freeAgents: PlayerId[]
  prospects: Prospect[]
}

function makePlayer(rng: Prng, id: string, pos: Position, season: number, ageRange: [number, number], draftedP: number): { player: Player; scouting: ScoutingView; truth: TrueTrajectory } {
  const age = rng.int(ageRange[0], ageRange[1])
  const birthYear = season - age
  const rookieSeason = birthYear + rng.int(21, 23)
  const drafted = rng.next() < draftedP
  const round = drafted ? Math.min(7, Math.max(1, Math.ceil(-Math.log(1 - rng.next()) * 2.2))) : 0
  const draft = drafted
    ? { season: rookieSeason, round, pick: (round - 1) * 32 + rng.int(1, 32), team: rng.pick(TEAM_IDS) }
    : null
  const base = clampRating(rng.normal(64, 11) + (drafted ? (8 - round) * 1.2 : -3))
  const yearsIn = Math.max(0, season - rookieSeason)
  const confidence = Math.min(0.95, 0.3 + yearsIn * 0.12)
  const peak = PEAK_AGE[pos]
  const pot = clampRating(Math.max(base, base + Math.max(0, peak - age) * 2.2 + rng.normal(0, 2)))
  const bySeason: Record<string, number> = {}
  let v = clampRating(base + rng.normal(0, 4))
  const lastSeason = season + rng.int(0, 6)
  for (let s = season; s <= lastSeason; s++) {
    bySeason[String(s)] = v
    const a = s - birthYear
    v = clampRating(v + (a < peak ? 2 : a < peak + 3 ? 0 : -3) + rng.normal(0, 3))
  }
  return {
    player: { id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, pos, birthYear, college: 'Mock State', heightIn: rng.int(68, 80), weightLb: rng.int(175, 330), draft, real: false, rookieSeason },
    scouting: { ovr: base, pot, confidence },
    truth: { bySeason, retiresAfter: lastSeason },
  }
}

function contractFor(rng: Prng, sc: ScoutingView, p: Player, season: number, cap: number) {
  const pct = Math.max(0.003, Math.pow(Math.max(0, sc.ovr - 55) / 44, 2.4) * 0.16)
  const rookie = p.draft !== null && season - p.rookieSeason < 4
  return {
    years: rookie ? Math.max(1, 4 - (season - p.rookieSeason)) : rng.int(1, 4),
    apy: Math.round(pct * cap * 100) / 100,
    guaranteedPct: rookie ? 1 : Math.round(rng.next() * 60) / 100,
    signedSeason: rookie ? p.rookieSeason : season - rng.int(0, 2),
    rookie,
  }
}

function buildDepthChart(roster: RosterSlot[], scouting: Record<PlayerId, ScoutingView>, players: Record<PlayerId, Player>): DepthChart {
  const chart: DepthChart = {}
  for (const pos of POSITIONS) {
    const ids = roster.map((r) => r.playerId).filter((id) => players[id]!.pos === pos)
    ids.sort((a, b) => scouting[b]!.ovr - scouting[a]!.ovr)
    chart[pos] = ids
  }
  return chart
}

function build(rng: Prng, season: number, userTeam: TeamId, faCount: number): Built {
  const players: Record<PlayerId, Player> = {}
  const scouting: Record<PlayerId, ScoutingView> = {}
  const truth: Record<PlayerId, TrueTrajectory> = {}
  const teams: Record<TeamId, TeamState> = {}
  const cap = CAP_BY_SEASON[String(season)] ?? 200
  let n = 0
  const add = (pos: Position, ageRange: [number, number], draftedP: number) => {
    const id = `mock-${String(++n).padStart(5, '0')}`
    const built = makePlayer(rng, id, pos, season, ageRange, draftedP)
    players[id] = built.player
    scouting[id] = built.scouting
    truth[id] = built.truth
    return built
  }
  for (const teamId of TEAM_IDS) {
    const roster: RosterSlot[] = []
    for (const pos of POSITIONS) {
      for (let i = 0; i < ROSTER_TEMPLATE_53[pos]!; i++) {
        const b = add(pos, [22, 34], 0.72)
        roster.push({ playerId: b.player.id, teamId, contract: contractFor(rng, b.scouting, b.player, season, cap) })
      }
    }
    teams[teamId] = {
      id: teamId, roster, depthChart: buildDepthChart(roster, scouting, players),
      record: { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      deadMoney: 0, tradeAnnoyance: 0, userControlled: teamId === userTeam,
    }
  }
  const freeAgents: PlayerId[] = []
  for (let i = 0; i < faCount; i++) freeAgents.push(add(rng.pick(POSITIONS), [24, 35], 0.5).player.id)

  const prospects: Prospect[] = []
  const classSize = 224 + 60
  for (let i = 0; i < classSize; i++) {
    const pos = rng.pick(POSITIONS.filter((p) => p !== 'K' && p !== 'P' || rng.next() < 0.15))
    const id = `mock-p-${season}-${String(i + 1).padStart(3, '0')}`
    const age = rng.int(21, 23)
    const slot = i + 1
    const ovr = clampRating(72 - Math.log(slot + 1) * 5.5 + rng.normal(0, 2.5))
    const pot = clampRating(ovr + rng.int(6, 18))
    prospects.push({
      id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, pos, birthYear: season - age, college: 'Mock Tech',
      heightIn: rng.int(68, 80), weightLb: rng.int(175, 330), draft: null, real: false, rookieSeason: season,
      scouting: { ovr, pot, confidence: 0.25 },
    })
    const bySeason: Record<string, number> = {}
    let v = clampRating(ovr + rng.normal(0, 6))
    for (let s = season; s <= season + rng.int(1, 8); s++) { bySeason[String(s)] = v; v = clampRating(v + rng.normal(1.5, 3)) }
    truth[id] = { bySeason, retiresAfter: null }
  }
  return { players, scouting, truth, teams, freeAgents, prospects }
}

function roundRobin(teams: readonly TeamId[], season: number, weeks: number): Game[] {
  const n = teams.length
  const ids = [...teams]
  const games: Game[] = []
  for (let w = 1; w <= weeks; w++) {
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i]!, b = ids[n - 1 - i]!
      const [home, away] = (w + i) % 2 === 0 ? [a, b] : [b, a]
      games.push({ id: `${season}-REG-${w}-${away}@${home}`, season, week: w, type: 'REG', home, away })
    }
    ids.splice(1, 0, ids.pop()!)
  }
  return games
}

function buildPicks(season: number): DraftPick[] {
  const picks: DraftPick[] = []
  for (const s of [season, season + 1]) {
    for (let round = 1; round <= 7; round++) {
      TEAM_IDS.forEach((teamId, i) => {
        picks.push({ season: s, round, pick: s === season ? (round - 1) * 32 + i + 1 : null, originalTeam: teamId, owner: teamId, playerId: null })
      })
    }
  }
  return picks
}

const DEFAULT_SETTINGS: GameSettings = { tradeStrictness: 'balanced', aiOfferFrequency: 'normal', injuries: true }

/** A full in-memory LeagueState at PRESEASON of `season`. */
export function mockLeague(opts: MockOptions = {}): LeagueState {
  const seed = opts.seed ?? 'mock-seed'
  const season = opts.season ?? 2015
  const userTeam = opts.userTeam ?? 'IND'
  const horizon = opts.horizonSeasons ?? 3
  const rng = new Prng(`${seed}:league:${season}`)
  const built = build(rng, season, userTeam, opts.freeAgents ?? 60)
  const fmt = leagueFormat(season)
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed, season, week: 0, phase: 'PRESEASON', userTeam,
    horizonEnd: season + horizon - 1, startSeason: season,
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    teams: built.teams, players: built.players, scouting: built.scouting, truth: built.truth,
    picks: buildPicks(season),
    schedule: roundRobin(TEAM_IDS, season, fmt.regularSeasonGames),
    results: [], history: [],
    divergence: new Set<PlayerId>(),
    freeAgents: built.freeAgents,
    draftRoom: null, snapLog: [],
    outcome: 'IN_PROGRESS',
    savedAt: '1970-01-01T00:00:00.000Z',
  }
}

const hex = (rng: Prng) => '#' + [0, 0, 0].map(() => rng.int(0x20, 0xdf).toString(16).padStart(2, '0')).join('')

export function mockStatic(seed = 'mock-seed', latestRealSeason = 2015): StaticData {
  const rng = new Prng(`${seed}:static`)
  const teams: Record<TeamId, TeamInfo> = {}
  for (const id of TEAM_IDS) {
    const d = DIVISIONS[id]
    teams[id] = { id, city: `${id} City`, name: `${id} Mocks`, abbr: id, conf: d.conf, div: d.div, colors: { primary: hex(rng), secondary: hex(rng) }, aliases: [id] }
  }
  const manifest: Manifest = { schemaVersion: 1, generatedAt: '1970-01-01T00:00:00.000Z', attribution: ATTRIBUTION, seasons: [latestRealSeason], latestRealSeason }
  const cap: CapFile = { attribution: ATTRIBUTION, bySeason: CAP_BY_SEASON, growthAfterData: 0.06 }
  const ages = Array.from({ length: 20 }, (_, i) => 21 + i)
  const curves: CurvesFile = {
    attribution: ATTRIBUTION,
    fitSeasons: [2010, 2023],
    aging: POSITIONS.map((pos) => ({ pos, byAge: Object.fromEntries(ages.map((a) => [String(a), a < PEAK_AGE[pos] ? 2 : a < PEAK_AGE[pos] + 3 ? 0 : -3])), sd: 3 })),
    slotGrade: [1, 5, 10, 20, 32, 48, 64, 100, 150, 200, 260].map((pick) => ({ pick, ovr: clampRating(74 - Math.log(pick + 1) * 5.5), pot: clampRating(88 - Math.log(pick + 1) * 5), sd: 4 })),
    udfaGrade: { ovrMean: 47, ovrSd: 3, potQuantiles: [50, 54, 58, 64, 72] },
    outcomes: [[1, 10], [11, 32], [33, 64], [65, 105], [106, 160], [161, 260], [0, 0]].map(([lo, hi]) => ({
      bucket: hi === 0 ? 'UDFA' : `${lo}-${hi}`, pickMin: lo!, pickMax: hi!, pos: 'ALL' as const,
      years: [1, 2, 3, 4, 5, 6, 7, 8], quantiles: [0.1, 0.25, 0.5, 0.75, 0.9],
      values: Array.from({ length: 8 }, (_, y) => [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => clampRating(48 + (hi === 0 ? 0 : 22 - Math.log(lo! + 1) * 4) + y * 1.5 + (q - 0.5) * 24))),
      bustRate: hi === 0 ? 0.7 : Math.min(0.6, 0.1 + Math.log(lo! + 1) * 0.08),
    })),
    retirement: POSITIONS.map((pos) => ({ pos, byAge: Object.fromEntries(Array.from({ length: 20 }, (_, i) => 22 + i).map((a) => [String(a), Math.min(0.95, Math.max(0.005, Math.exp((a - (pos === 'RB' ? 31 : 35)) * 0.6) * 0.3))])), valueSlope: -0.08 })),
    positionMix: { QB: 0.05, RB: 0.09, WR: 0.14, TE: 0.06, OL: 0.17, DL: 0.14, LB: 0.12, CB: 0.12, S: 0.08, K: 0.015, P: 0.015 },
    classSize: { drafted: 224, udfa: 200 },
    names: { first: FIRST, last: LAST },
  }
  const injuryModel: InjuryModelFile = {
    attribution: ATTRIBUTION, fitSeasons: [2012, 2023],
    ratePerPlayerGame: { QB: 0.006, RB: 0.014, WR: 0.011, TE: 0.011, OL: 0.009, DL: 0.009, LB: 0.011, CB: 0.011, S: 0.01, K: 0.001, P: 0.001 },
    duration: [{ weeks: 1, p: 0.35 }, { weeks: 2, p: 0.25 }, { weeks: 3, p: 0.12 }, { weeks: 4, p: 0.08 }, { weeks: 6, p: 0.07 }, { weeks: 8, p: 0.05 }, { weeks: 12, p: 0.04 }, { weeks: 17, p: 0.04 }],
    kinds: [{ kind: 'hamstring', p: 0.2 }, { kind: 'ankle', p: 0.2 }, { kind: 'knee', p: 0.2 }, { kind: 'shoulder', p: 0.15 }, { kind: 'concussion', p: 0.15 }, { kind: 'foot', p: 0.1 }],
    permanentLoss: { minWeeks: 8, p: 0.3, lossRange: [1, 3] },
  }
  return { manifest, teams, cap, curves, injuryModel }
}

/** StaticData + one season chunk + trajectories: everything league.newGame needs, as a MemoryBundle. */
export function mockBundle(opts: MockOptions = {}): MemoryBundle {
  const seed = opts.seed ?? 'mock-seed'
  const season = opts.season ?? 2015
  const userTeam = opts.userTeam ?? 'IND'
  const rng = new Prng(`${seed}:league:${season}`)
  const built = build(rng, season, userTeam, opts.freeAgents ?? 60)
  const fmt = leagueFormat(season)
  const teamOf: Record<PlayerId, TeamId> = {}
  for (const t of Object.values(built.teams)) for (const r of t.roster) teamOf[r.playerId] = t.id

  const players: SeasonPlayer[] = Object.values(built.players).map((p) => ({
    ...p, scouting: built.scouting[p.id]!, trueValue: built.truth[p.id]!.bySeason[String(season)]!, team: teamOf[p.id] ?? null,
  }))
  const rosters = Object.fromEntries(Object.values(built.teams).map((t) => [t.id, t.roster.map((r, i) => ({ playerId: r.playerId, apy: r.contract.apy, years: r.contract.years, depth: i + 1 }))]))
  const order = Array.from({ length: 224 }, (_, i) => ({ round: Math.floor(i / 32) + 1, pick: i + 1, team: TEAM_IDS[i % 32]!, originalTeam: TEAM_IDS[i % 32]!, playerId: built.prospects[i]!.id }))
  const seasonData: SeasonData = {
    players: { attribution: ATTRIBUTION, season, players },
    rosters: { attribution: ATTRIBUTION, season, rosters },
    draft: { attribution: ATTRIBUTION, season, order, prospects: built.prospects, udfa: built.prospects.slice(224).map((p) => p.id) },
    schedule: { attribution: ATTRIBUTION, season, weeks: fmt.regularSeasonGames + 1, playoffFormat: { teams: fmt.playoffTeams, byesPerConf: fmt.byesPerConf, regularSeasonGames: fmt.regularSeasonGames }, games: roundRobin(TEAM_IDS, season, fmt.regularSeasonGames) },
  }
  const trajectories: TrajectoryTable = {}
  for (const [id, t] of Object.entries(built.truth)) {
    const seasons = Object.keys(t.bySeason).map(Number).sort((a, b) => a - b)
    const start = seasons[0]!
    const end = seasons[seasons.length - 1]!
    trajectories[id] = { start, values: Array.from({ length: end - start + 1 }, (_, i) => t.bySeason[String(start + i)] ?? null), retiresAfter: t.retiresAfter }
  }
  return { static: mockStatic(seed, season), seasons: { [season]: seasonData }, trajectories }
}

export const MOCK_CAP_BY_SEASON = CAP_BY_SEASON
export const MOCK_STARTER_TEMPLATE = STARTER_TEMPLATE
