/**
 * Just-signed trade lock (2018 playthrough: the user signed stars at the ask on 1-year deals and flipped
 * them the same day). A free agent the user signed cannot be traded until `offseasonUnlockWeek` of the
 * season he signed for, or `inSeasonLockWeeks` after an in-season signing. Derived from the user's
 * SIGN transactions — AI-only moves are never logged, so AI signings are not locked.
 */
import type { LeagueState, Phase, PlayerId } from '@contracts/index'
import { tradeLockConstants } from './constants'
import { isOffseasonPhase } from './value'

/** League year and regular-season week of a moment; the offseason and preseason count as week 0. */
function moment(season: number, phase: Phase, week: number): { year: number; week: number } {
  if (isOffseasonPhase(phase)) return { year: season + 1, week: 0 }
  if (phase === 'PRESEASON') return { year: season, week: 0 }
  return { year: season, week: Math.max(1, week) }
}

export function tradeLockReason(state: LeagueState, playerId: PlayerId): string | null {
  const onUserTeam = state.teams[state.userTeam]?.roster.some((r) => r.playerId === playerId)
  if (!onUserTeam) return null
  const signing = state.transactions.findLast((t) => t.kind === 'SIGN' && t.playerId === playerId)
  if (!signing) return null
  const signed = moment(signing.season, signing.phase, signing.week)
  const offseasonSigning = signed.week === 0
  const unlockWeek = offseasonSigning
    ? tradeLockConstants.offseasonUnlockWeek
    : signed.week + tradeLockConstants.inSeasonLockWeeks
  const now = moment(state.season, state.phase, state.week)
  if (now.year !== signed.year || now.week >= unlockWeek) return null
  const name = state.players[playerId]?.name ?? playerId
  return offseasonSigning
    ? `${name} signed this offseason — can't be traded until week ${unlockWeek}`
    : `${name} signed in week ${signed.week} — can't be traded until week ${unlockWeek}`
}
