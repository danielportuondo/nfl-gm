import { useMemo, useState } from 'react'
import type { DraftPick, DraftRoomState, LeagueState, StaticData, TeamId } from '@contracts/index'
import { PositionBadge, Table, type Column } from '@ui/primitives'
import { formatRating, type RowTone } from '@ui/primitives/Table'
import { BustSprite, TeamScope } from '@ui/sprites'
import { teamAbbr } from '../shared/teamLabel'

export interface PickBoardProps {
  state: LeagueState
  data: StaticData
  room: DraftRoomState
  userTeam: TeamId
}

interface PickRow {
  pick: DraftPick
  index: number
}

const FALLBACK_COLORS = { primary: '#1F4334', secondary: '#F3ECD2' }

/** League-wide pick board for the Draft Room's Pick board tab (docs/DESIGN.md §5.3). */
export function PickBoard({ state, data, room, userTeam }: PickBoardProps) {
  const rounds = useMemo(
    () => Array.from(new Set(room.order.map((p) => p.round))).sort((a, b) => a - b),
    [room.order],
  )
  const complete = room.status === 'COMPLETE'
  const currentPick: DraftPick | undefined = room.order[room.currentPickIndex]
  const defaultRound = complete
    ? (rounds[rounds.length - 1] ?? 1)
    : (currentPick?.round ?? rounds[0] ?? 1)

  // The board follows the clock into a new round unless the user has picked one themselves; a
  // round change from the clock clears that choice so it goes back to following along. Adjusting
  // state during render (rather than in an effect) avoids an extra render pass on every change.
  const [roundOverride, setRoundOverride] = useState<number | null>(null)
  const [trackedDefaultRound, setTrackedDefaultRound] = useState(defaultRound)
  if (defaultRound !== trackedDefaultRound) {
    setTrackedDefaultRound(defaultRound)
    setRoundOverride(null)
  }

  const selectedRound = roundOverride ?? defaultRound

  const isOnClockRow = (index: number): boolean =>
    !complete && room.status === 'ON_CLOCK' && index === room.currentPickIndex

  const rowTone = ({ pick, index }: PickRow): RowTone | undefined => {
    if (isOnClockRow(index)) return 'attention'
    if (pick.owner === userTeam) return 'yours'
    return undefined
  }

  const rows: PickRow[] = useMemo(
    () =>
      room.order
        .map((pick, index) => ({ pick, index }))
        .filter(({ pick }) => pick.round === selectedRound),
    [room.order, selectedRound],
  )

  const columns: Column<PickRow>[] = [
    {
      key: 'overall',
      header: '#',
      numeric: true,
      sortValue: ({ pick, index }) => pick.pick ?? index + 1,
      render: ({ pick, index }) => pick.pick ?? index + 1,
    },
    {
      key: 'team',
      header: 'Team',
      render: ({ pick, index }) => {
        const isYours = pick.owner === userTeam
        return (
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{teamAbbr(data, pick.owner, pick.season)}</span>
            {pick.owner !== pick.originalTeam && (
              <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
                from {teamAbbr(data, pick.originalTeam, pick.season)}
              </span>
            )}
            {isOnClockRow(index) && (
              <span
                style={{
                  color: 'var(--accent)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-1)',
                }}
              >
                On the clock
              </span>
            )}
            {isYours && <span className="gg-vh">Your pick</span>}
          </span>
        )
      },
    },
    {
      key: 'player',
      header: 'Player',
      render: ({ pick }) => {
        const player = pick.playerId ? state.players[pick.playerId] : null
        const scouting = pick.playerId ? state.scouting[pick.playerId] : null
        if (!player || !scouting) return '—'
        return (
          <TeamScope colors={data.teams[pick.owner]?.colors ?? FALLBACK_COLORS}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <BustSprite pos={player.pos} size={2} status={{ rookie: true }} />
              {player.name}
              <PositionBadge pos={player.pos} />
              <span className="gg-rating">
                {formatRating(scouting.ovr)}/{formatRating(scouting.pot)}
              </span>
            </span>
          </TeamScope>
        )
      },
    },
  ]

  return (
    <div>
      <div
        role="group"
        aria-label="Filter by round"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {rounds.map((r) => (
          <button
            key={r}
            type="button"
            className="gg-button gg-button--secondary"
            aria-pressed={selectedRound === r}
            aria-label={`Round ${r}`}
            onClick={() => setRoundOverride(r)}
            style={selectedRound === r ? { boxShadow: 'var(--shadow-press)' } : undefined}
          >
            R{r}
          </button>
        ))}
      </div>
      <Table
        columns={columns}
        rows={rows}
        rowKey={({ pick, index }) => `${pick.season}-${pick.round}-${pick.originalTeam}-${index}`}
        caption={`Pick board, round ${selectedRound}`}
        dense
        rowTone={rowTone}
      />
    </div>
  )
}
