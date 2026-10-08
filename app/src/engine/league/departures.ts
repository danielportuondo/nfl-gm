/**
 * The user's players who are gone when the camp roll retires them. The roll takes everyone whose last
 * real game is behind them, retired or just unsigned, so the log says "left the league" and nothing
 * more specific than that.
 */
import type { LeagueState, PlayerId, Transaction } from '@contracts/index'

type LeftLeague = Extract<Transaction, { kind: 'LEFT_LEAGUE' }>

/**
 * `rolled` is the league just before the retirements (contracts rolled, user roster intact); `after`
 * has them applied. `at` is the league as the roll began: entries carry its season and phase, so they
 * read as part of the next league year like every other offseason move.
 */
export function withDepartures(
  at: LeagueState,
  rolled: LeagueState,
  after: LeagueState,
  retired: readonly PlayerId[],
): LeagueState {
  const gone = new Set(retired)
  const left = (rolled.teams[rolled.userTeam]?.roster ?? [])
    .map((slot) => slot.playerId)
    .filter((id) => gone.has(id))
  if (left.length === 0) return after
  const entries = left.map((playerId): LeftLeague => ({
    kind: 'LEFT_LEAGUE',
    season: at.season,
    phase: at.phase,
    week: at.week,
    ovrAtMove: at.scouting[playerId] ? { [playerId]: at.scouting[playerId].ovr } : {},
    playerId,
  }))
  return { ...after, transactions: [...after.transactions, ...entries] }
}
