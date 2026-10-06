/**
 * Per-player season stat lines from public box scores (state.results[].box). Pure and truth-free:
 * nothing here may touch state.truth (docs/HANDOFF.md §3).
 */
import type {
  Game,
  GameResult,
  LeagueState,
  PlayerGameLine,
  PlayerId,
  Position,
  TeamId,
} from '@contracts/index'

type CountingKey = Exclude<keyof PlayerGameLine, 'playerId' | 'teamId'>

const COUNTING_KEYS: readonly CountingKey[] = [
  'passAtt',
  'passCmp',
  'passYds',
  'passTd',
  'passInt',
  'rushAtt',
  'rushYds',
  'rushTd',
  'targets',
  'rec',
  'recYds',
  'recTd',
  'tackles',
  'sacks',
  'ints',
  'forcedFumbles',
  'passesDefended',
  'fgm',
  'fga',
  'xpm',
  'xpa',
  'punts',
  'puntYds',
  'twoPt',
  'defTd',
  'retTd',
  'safeties',
]

export type StatTotals = Record<CountingKey, number> & {
  /** Box-score appearances: the sim only writes a line when the player recorded something. */
  games: number
  /** Team games inside an injury window in which the player has no line. */
  gamesMissed: number
}

export interface SeasonStatLine {
  season: number
  /** Teams the player logged a line for, in the order he first appeared. */
  teams: TeamId[]
  regular: StatTotals | null
  playoffs: StatTotals | null
}

function emptyTotals(): StatTotals {
  const totals = { games: 0, gamesMissed: 0 } as StatTotals
  for (const key of COUNTING_KEYS) totals[key] = 0
  return totals
}

interface SeasonAcc {
  teams: TeamId[]
  regular: StatTotals | null
  playoffs: StatTotals | null
}

const totalsOf = (acc: SeasonAcc, game: Game): StatTotals => {
  const slot = game.type === 'REG' ? 'regular' : 'playoffs'
  return (acc[slot] ??= emptyTotals())
}

function lineFor(result: GameResult, playerId: PlayerId): PlayerGameLine | undefined {
  return (
    result.box?.home.find((l) => l.playerId === playerId) ??
    result.box?.away.find((l) => l.playerId === playerId)
  )
}

/** Games a team played in `season` during weeks (week, week + weeksOut], that the player skipped. */
function missedGames(
  game: Game,
  weeksOut: number,
  teamId: TeamId,
  gamesBySeason: Map<number, Game[]>,
  simmed: Set<string>,
  appearedIn: Set<string>,
): Game[] {
  const firstMissed = game.week + 1
  const lastMissed = game.week + weeksOut
  return (gamesBySeason.get(game.season) ?? []).filter(
    (g) =>
      (g.home === teamId || g.away === teamId) &&
      g.week >= firstMissed &&
      g.week <= lastMissed &&
      simmed.has(g.id) &&
      !appearedIn.has(g.id),
  )
}

/**
 * One row per season in which the player has a box-score line, oldest first. Lines are summed
 * across teams, so a mid-season trade keeps one season total. Regular season and playoffs are
 * separate totals; `null` means no line in that part of the season.
 */
export function playerSeasonStats(
  state: Pick<LeagueState, 'schedule' | 'results'>,
  playerId: PlayerId,
): SeasonStatLine[] {
  const gamesById = new Map<string, Game>()
  const gamesBySeason = new Map<number, Game[]>()
  for (const g of state.schedule) {
    gamesById.set(g.id, g)
    const list = gamesBySeason.get(g.season) ?? []
    list.push(g)
    gamesBySeason.set(g.season, list)
  }
  const simmedIds = new Set(state.results.map((r) => r.gameId))
  const appearedIn = new Set<string>()

  const seasons = new Map<number, SeasonAcc>()
  const accFor = (season: number): SeasonAcc => {
    let acc = seasons.get(season)
    if (!acc) {
      acc = { teams: [], regular: null, playoffs: null }
      seasons.set(season, acc)
    }
    return acc
  }
  const injuryWindows: { game: Game; weeksOut: number; teamId: TeamId }[] = []

  for (const result of state.results) {
    const game = gamesById.get(result.gameId)
    if (!game) continue
    for (const injury of result.injuries) {
      if (injury.playerId === playerId) {
        injuryWindows.push({ game, weeksOut: injury.weeksOut, teamId: injury.teamId })
      }
    }
    const line = lineFor(result, playerId)
    if (!line) continue
    const acc = accFor(game.season)
    if (!acc.teams.includes(line.teamId)) acc.teams.push(line.teamId)
    const totals = totalsOf(acc, game)
    appearedIn.add(game.id)
    totals.games += 1
    for (const key of COUNTING_KEYS) totals[key] += line[key] ?? 0
  }

  const missedIds = new Set<string>()
  for (const { game, weeksOut, teamId } of injuryWindows) {
    const acc = seasons.get(game.season)
    if (!acc) continue
    for (const missed of missedGames(
      game,
      weeksOut,
      teamId,
      gamesBySeason,
      simmedIds,
      appearedIn,
    )) {
      const totals = missed.type === 'REG' ? acc.regular : acc.playoffs
      if (!totals || missedIds.has(missed.id)) continue
      missedIds.add(missed.id)
      totals.gamesMissed += 1
    }
  }

  return [...seasons.keys()]
    .sort((a, b) => a - b)
    .map((season) => {
      const acc = seasons.get(season)!
      return {
        season,
        teams: acc.teams,
        regular: acc.regular,
        playoffs: acc.playoffs,
      }
    })
}

/** The newest season row that has a regular-season line; null when there is none. */
export function latestRegularSeason(rows: readonly SeasonStatLine[]): SeasonStatLine | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]!.regular) return rows[i]!
  }
  return null
}

export interface StatColumn {
  key: string
  header: string
  /** Spelled out for screen readers and the headline tiles. */
  label: string
  value: (totals: StatTotals) => string
}

const count = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)

const simple = (key: CountingKey, header: string, label = header): StatColumn => ({
  key,
  header,
  label,
  value: (t) => count(t[key]),
})

const ratio = (
  made: CountingKey,
  tried: CountingKey,
  header: string,
  label: string,
): StatColumn => ({
  key: `${made}/${tried}`,
  header,
  label,
  value: (t) => `${count(t[made])}/${count(t[tried])}`,
})

const PASSER: StatColumn[] = [
  ratio('passCmp', 'passAtt', 'Cmp/Att', 'Comp/att'),
  simple('passYds', 'Pass yds', 'Passing yards'),
  simple('passTd', 'TD', 'Passing TD'),
  simple('passInt', 'INT', 'Interceptions thrown'),
  simple('rushYds', 'Rush yds', 'Rushing yards'),
  simple('rushTd', 'Rush TD', 'Rushing TD'),
]

const RUNNER: StatColumn[] = [
  simple('rushAtt', 'Att', 'Carries'),
  simple('rushYds', 'Rush yds', 'Rushing yards'),
  simple('rushTd', 'Rush TD', 'Rushing TD'),
  simple('rec', 'Rec', 'Catches'),
  simple('recYds', 'Rec yds', 'Receiving yards'),
  simple('recTd', 'Rec TD', 'Receiving TD'),
]

const RECEIVER: StatColumn[] = [
  simple('rec', 'Rec', 'Catches'),
  simple('targets', 'Tgt', 'Targets'),
  simple('recYds', 'Rec yds', 'Receiving yards'),
  simple('recTd', 'Rec TD', 'Receiving TD'),
]

const DEFENDER: StatColumn[] = [
  simple('tackles', 'Tackles'),
  simple('sacks', 'Sacks'),
  simple('ints', 'INT', 'Interceptions'),
  simple('passesDefended', 'PD', 'Passes defended'),
  simple('forcedFumbles', 'FF', 'Forced fumbles'),
]

const KICKER: StatColumn[] = [
  ratio('fgm', 'fga', 'FG', 'Field goals'),
  ratio('xpm', 'xpa', 'XP', 'Extra points'),
]

const PUNTER: StatColumn[] = [
  simple('punts', 'Punts'),
  simple('puntYds', 'Punt yds', 'Punt yards'),
  {
    key: 'puntAvg',
    header: 'Avg',
    label: 'Yards per punt',
    value: (t) => (t.punts > 0 ? (t.puntYds / t.punts).toFixed(1) : '0.0'),
  },
]

const COLUMNS_BY_POSITION: Record<Position, StatColumn[]> = {
  QB: PASSER,
  RB: RUNNER,
  WR: RECEIVER,
  TE: RECEIVER,
  OL: [],
  DL: DEFENDER,
  LB: DEFENDER,
  CB: DEFENDER,
  S: DEFENDER,
  K: KICKER,
  P: PUNTER,
}

const HEADLINE_BY_POSITION: Record<Position, readonly string[]> = {
  QB: ['passCmp/passAtt', 'passYds', 'passTd', 'passInt', 'rushYds'],
  RB: ['rushYds', 'rushTd', 'rec', 'recYds'],
  WR: ['rec', 'recYds', 'recTd'],
  TE: ['rec', 'recYds', 'recTd'],
  OL: [],
  DL: ['tackles', 'sacks', 'ints', 'passesDefended'],
  LB: ['tackles', 'sacks', 'ints', 'passesDefended'],
  CB: ['tackles', 'sacks', 'ints', 'passesDefended'],
  S: ['tackles', 'sacks', 'ints', 'passesDefended'],
  K: ['fgm/fga', 'xpm/xpa'],
  P: ['punts', 'puntAvg'],
}

/** Position-appropriate stat columns (box lines carry no stats for offensive linemen). */
export function statColumnsFor(pos: Position): StatColumn[] {
  return COLUMNS_BY_POSITION[pos]
}

/** Keys of the columns shown as headline tiles for the current season. */
export function headlineKeysFor(pos: Position): readonly string[] {
  return HEADLINE_BY_POSITION[pos]
}
