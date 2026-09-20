/**
 * Reconstructs the postseason as a binary tree from a completed PlayoffBracket, purely from the
 * games and results already on record — no assumption about which reseeding rule produced them.
 * Every DIV game's two participants are matched back to either a bye seed or the WC game that fed
 * it; the same match is repeated for CONF and the Super Bowl. Never reads state.truth.
 */
import type { Conference, Game, GameResult, PlayoffBracket, TeamId } from '@contracts/index'

export interface BracketSlot {
  /** Best (lowest) seed reachable through this slot; used to keep seed 1 on top. */
  seed: number
  /** Team that emerges from this slot (the bye team, or the winner of `game`). */
  teamId: TeamId
  kind: 'bye' | 'game'
  game?: Game
  /** Two feeder slots for DIV/CONF/SB; empty for a wild-card-column leaf. */
  children: BracketSlot[]
}

export interface ConferenceBracket {
  /**
   * The 4 wild-card-column leaves, ordered by divisional pairing: the two feeders of the
   * better-seeded DIV game first (better seed of that pair first), then the two feeders of the
   * other DIV game. This follows reseeding as played, not raw seed order.
   */
  leaves: BracketSlot[]
  /** The 2 divisional games, in the same top-to-bottom order as `leaves`. */
  divs: BracketSlot[]
  conf: BracketSlot
}

export interface FullBracket {
  afc: ConferenceBracket
  nfc: ConferenceBracket
  superBowl: BracketSlot
}

export function winnerOf(game: Game, results: GameResult[]): TeamId {
  const result = results.find((r) => r.gameId === game.id)
  if (!result) return game.home
  return result.awayScore > result.homeScore ? game.away : game.home
}

function findGameByTeams(games: Game[], teamA: TeamId, teamB: TeamId): Game | undefined {
  return games.find(
    (g) => (g.home === teamA && g.away === teamB) || (g.home === teamB && g.away === teamA),
  )
}

function buildConferenceBracket(
  conf: Conference,
  bracket: PlayoffBracket,
  results: GameResult[],
): ConferenceBracket | null {
  const seeds = bracket.seeds.filter((s) => s.conf === conf)
  if (seeds.length === 0) return null
  const seedOf = (teamId: TeamId): number => seeds.find((s) => s.teamId === teamId)?.seed ?? 99
  const teamIds = new Set(seeds.map((s) => s.teamId))

  const wcGames = (bracket.rounds.find((r) => r.type === 'WC')?.games ?? []).filter(
    (g) => teamIds.has(g.home) && teamIds.has(g.away),
  )
  const byeTeamIds = [...teamIds].filter((t) => !wcGames.some((g) => g.home === t || g.away === t))

  const rawLeaves: BracketSlot[] = [
    ...byeTeamIds.map((teamId): BracketSlot => ({
      seed: seedOf(teamId),
      teamId,
      kind: 'bye',
      children: [],
    })),
    ...wcGames.map((game): BracketSlot => ({
      seed: Math.min(seedOf(game.home), seedOf(game.away)),
      teamId: winnerOf(game, results),
      kind: 'game',
      game,
      children: [],
    })),
  ]

  if (rawLeaves.length !== 4) return null

  // Divisional pairing follows reseeding as played, not raw seed adjacency (e.g. the 1 seed may
  // host the winner of the 3v6 game rather than 2v7). Match each DIV game back to the two leaves
  // whose emerging team it contains, then order the two pairs, and each pair's leaves, by seed.
  const leafByTeam = new Map(rawLeaves.map((l) => [l.teamId, l] as const))
  const divRound = bracket.rounds.find((r) => r.type === 'DIV')?.games ?? []
  const confDivGames = divRound.filter((g) => leafByTeam.has(g.home) && leafByTeam.has(g.away))
  if (confDivGames.length !== 2) return null

  const divPairs = confDivGames
    .map((game) => {
      const homeLeaf = leafByTeam.get(game.home)!
      const awayLeaf = leafByTeam.get(game.away)!
      const [first, second] =
        homeLeaf.seed <= awayLeaf.seed ? [homeLeaf, awayLeaf] : [awayLeaf, homeLeaf]
      return { game, first, second, seed: Math.min(homeLeaf.seed, awayLeaf.seed) }
    })
    .sort((a, b) => a.seed - b.seed)

  const leaves: BracketSlot[] = divPairs.flatMap((p) => [p.first, p.second])
  const divs: BracketSlot[] = divPairs.map((p) => ({
    seed: p.seed,
    teamId: winnerOf(p.game, results),
    kind: 'game',
    game: p.game,
    children: [p.first, p.second],
  }))

  const confRound = bracket.rounds.find((r) => r.type === 'CONF')?.games ?? []
  const confGame = findGameByTeams(confRound, divs[0]!.teamId, divs[1]!.teamId)
  if (!confGame) return null
  const confSlot: BracketSlot = {
    seed: Math.min(divs[0]!.seed, divs[1]!.seed),
    teamId: winnerOf(confGame, results),
    kind: 'game',
    game: confGame,
    children: divs,
  }

  return { leaves, divs, conf: confSlot }
}

/** Returns null when the bracket is incomplete (missing a round) — the caller falls back to text. */
export function buildBracketTree(
  bracket: PlayoffBracket,
  results: GameResult[],
): FullBracket | null {
  const afc = buildConferenceBracket('AFC', bracket, results)
  const nfc = buildConferenceBracket('NFC', bracket, results)
  if (!afc || !nfc) return null

  const sbRound = bracket.rounds.find((r) => r.type === 'SB')?.games ?? []
  const sbGame = findGameByTeams(sbRound, afc.conf.teamId, nfc.conf.teamId)
  if (!sbGame) return null

  const superBowl: BracketSlot = {
    seed: Math.min(afc.conf.seed, nfc.conf.seed),
    teamId: winnerOf(sbGame, results),
    kind: 'game',
    game: sbGame,
    children: [afc.conf, nfc.conf],
  }

  return { afc, nfc, superBowl }
}
