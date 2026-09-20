import { useMemo, useState } from 'react'
import {
  POSITIONS,
  type LeagueState,
  type NeedProfile,
  type PlayerId,
  type Position,
  type StaticData,
  type TeamId,
  type TradeEvaluation,
  type TradeProposal,
  type TradeSide,
} from '@contracts/index'
import {
  Button,
  OfferCard,
  Panel,
  PositionBadge,
  Table,
  type Column,
  type SortState,
} from '@ui/primitives'
import { BustSprite, TeamScope } from '@ui/sprites'
import { describePick } from '../shared/pickLabel'

export interface DraftRoomProps {
  state: LeagueState
  data: StaticData
  busy?: boolean
  onStartDraft: () => void
  onMakePick: (playerId: PlayerId) => void
  onAutoPick: () => void
  onSimToMyPick: () => void
  onFinishDraft: () => void
  onRespondToOffer: (proposal: TradeProposal, accept: boolean) => void
  onEvaluate: (proposal: TradeProposal) => TradeEvaluation
  onTeamNeeds: (teamId: TeamId) => NeedProfile | null
}

interface ProspectRow {
  id: PlayerId
  name: string
  pos: Position
  age: number
  ovr: number
  pot: number
  need: boolean
}

const FILTERS: Array<Position | 'ALL'> = ['ALL', ...POSITIONS]

function teamAbbr(data: StaticData, id: TeamId): string {
  return data.teams[id]?.abbr ?? id
}

function describeSide(state: LeagueState, data: StaticData, side: TradeSide): string {
  const parts: string[] = []
  for (const id of side.players) {
    const p = state.players[id]
    if (p) parts.push(p.name)
  }
  for (const pick of side.picks) {
    parts.push(describePick(data, pick))
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing'
}

/** The showcase screen (docs/DESIGN.md §5.3, §11): board, on-the-clock hero, offers, pick log. */
export function DraftRoom({
  state,
  data,
  busy,
  onStartDraft,
  onMakePick,
  onAutoPick,
  onSimToMyPick,
  onFinishDraft,
  onRespondToOffer,
  onEvaluate,
  onTeamNeeds,
}: DraftRoomProps) {
  const [filter, setFilter] = useState<Position | 'ALL'>('ALL')
  const [selected, setSelected] = useState<PlayerId | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'pot', dir: 'desc' })
  const room = state.draftRoom
  const teamInfo = data.teams[state.userTeam]

  const needs = onTeamNeeds(state.userTeam)
  const needTop = new Set(needs?.top ?? [])

  const rows: ProspectRow[] = useMemo(() => {
    if (!room) return []
    return room.available
      .map((id) => {
        const player = state.players[id]
        const scouting = state.scouting[id]
        if (!player || !scouting) return null
        return {
          id,
          name: player.name,
          pos: player.pos,
          age: state.season - player.birthYear,
          ovr: scouting.ovr,
          pot: scouting.pot,
          need: needTop.has(player.pos),
        }
      })
      .filter((r): r is ProspectRow => r !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, state.players, state.scouting, state.season])

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.pos === filter)

  const currentPick = room ? room.order[room.currentPickIndex] : undefined
  const onClock = Boolean(
    room && room.status === 'ON_CLOCK' && currentPick?.owner === state.userTeam,
  )
  const complete = room?.status === 'COMPLETE'

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const withValues = filtered.map((r) => {
      const value =
        sort.key === 'name'
          ? r.name
          : sort.key === 'age'
            ? r.age
            : sort.key === 'ovr'
              ? r.ovr
              : sort.key === 'pot'
                ? r.pot
                : 0
      return { r, value }
    })
    withValues.sort((a, b) => (a.value < b.value ? -1 * dir : a.value > b.value ? 1 * dir : 0))
    return withValues.map((w) => w.r)
  }, [filtered, sort])

  const yourPicks = room
    ? state.picks
        .filter((p) => p.season === room.season && p.owner === state.userTeam)
        .sort((a, b) => a.round - b.round)
    : []
  const selectedName = selected ? state.players[selected]?.name : undefined

  const columns: Column<ProspectRow>[] = [
    {
      key: 'name',
      header: 'Prospect',
      frozen: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <BustSprite pos={r.pos} size={2} status={{ rookie: true }} />
          {r.name}
          <PositionBadge pos={r.pos} />
          {r.need && (
            <span
              className="gg-badge"
              style={{
                background: 'transparent',
                color: 'var(--accent)',
                border: '2px solid var(--accent)',
              }}
            >
              Need
            </span>
          )}
        </span>
      ),
    },
    { key: 'age', header: 'Age', numeric: true, sortValue: (r) => r.age, render: (r) => r.age },
    {
      key: 'ovr',
      header: 'Ovr',
      numeric: true,
      rating: true,
      sortValue: (r) => r.ovr,
      render: (r) => r.ovr,
    },
    {
      key: 'pot',
      header: 'Pot',
      numeric: true,
      rating: true,
      sortValue: (r) => r.pot,
      render: (r) => r.pot,
    },
    ...(onClock
      ? [
          {
            key: 'draft',
            header: '',
            render: (r: ProspectRow) => (
              <Button
                type="button"
                variant="primary"
                busy={busy}
                busyLabel="…"
                aria-label={`Draft ${r.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onMakePick(r.id)
                }}
              >
                Draft
              </Button>
            ),
          } satisfies Column<ProspectRow>,
        ]
      : []),
  ]

  if (!room) {
    return (
      <div className="gg-col-12">
        <Panel title="Draft room" revealIndex={0}>
          <p style={{ margin: '0 0 var(--sp-4)', color: 'var(--text-2)' }}>
            The draft hasn't started yet.
          </p>
          <Button
            type="button"
            variant="primary"
            busy={busy}
            busyLabel="Starting…"
            onClick={onStartDraft}
          >
            Start draft
          </Button>
        </Panel>
      </div>
    )
  }

  return (
    <TeamScope
      colors={teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' }}
      as="div"
      style={{ display: 'contents' }}
    >
      <div className="gg-col-8">
        {onClock && (
          <Panel variant="attention" revealIndex={0} className="gg-yardlines">
            <div
              key={room.currentPickIndex}
              className="gg-clock-pulse"
              style={{ textAlign: 'center' }}
            >
              <p
                style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fd-5)',
                  letterSpacing: 'var(--ls-display)',
                  lineHeight: 'var(--lh-display)',
                }}
              >
                ON THE CLOCK
              </p>
              <p style={{ margin: 'var(--sp-2) 0 0', color: 'var(--text-2)' }}>
                Round {currentPick?.round}, pick {currentPick?.pick ?? room.currentPickIndex + 1}
              </p>
              <p style={{ margin: 'var(--sp-2) 0 0' }}>
                Pick a prospect below, then make the pick.
              </p>
            </div>
          </Panel>
        )}

        {complete && (
          <Panel variant="attention" revealIndex={0}>
            <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fd-3)' }}>
              Draft complete
            </p>
          </Panel>
        )}

        {!onClock && !complete && currentPick && (
          <Panel revealIndex={0}>
            <p style={{ margin: 0 }}>
              On the clock: {teamAbbr(data, currentPick.owner)} — round {currentPick.round}, pick{' '}
              {currentPick.pick ?? room.currentPickIndex + 1}
            </p>
          </Panel>
        )}

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Draft board" variant="sunken" revealIndex={1}>
          <div
            role="group"
            aria-label="Filter by position"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
              marginBottom: 'var(--sp-3)',
            }}
          >
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="gg-button gg-button--secondary"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                style={filter === f ? { boxShadow: 'var(--shadow-press)' } : undefined}
              >
                {f}
              </button>
            ))}
          </div>
          <Table
            columns={columns}
            rows={sorted}
            rowKey={(r) => r.id}
            caption="Available prospects"
            dense
            selectedRowKey={selected}
            onRowClick={(r) => setSelected(r.id)}
            sort={sort}
            onSortChange={(key) =>
              setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
            }
          />
        </Panel>

        <div style={{ height: 'var(--sp-4)' }} />

        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' }}
        >
          <Button
            type="button"
            variant="primary"
            busy={busy}
            busyLabel="Working…"
            disabled={!onClock || !selected}
            onClick={() => selected && onMakePick(selected)}
          >
            {selectedName ? `Make pick: ${selectedName}` : 'Make pick'}
          </Button>
          {onClock && !selected && (
            <span style={{ color: 'var(--text-2)' }}>
              Select a prospect above to make your pick.
            </span>
          )}
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            busyLabel="Working…"
            disabled={complete}
            onClick={onAutoPick}
          >
            Auto pick
          </Button>
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            busyLabel="Working…"
            disabled={complete}
            onClick={onSimToMyPick}
          >
            Sim to my pick
          </Button>
          <Button
            type="button"
            variant="ghost"
            busy={busy}
            busyLabel="Working…"
            disabled={complete}
            onClick={onFinishDraft}
          >
            Finish draft
          </Button>
        </div>

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Pick log" variant="sunken" revealIndex={2}>
          {room.log.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No picks yet.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {[...room.log].reverse().map((entry) => (
                <li key={entry.pick}>
                  Pick {entry.pick} ({teamAbbr(data, entry.team)}):{' '}
                  {state.players[entry.playerId]?.name ?? entry.playerId}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="Your picks" revealIndex={3}>
          {yourPicks.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No picks remaining.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {yourPicks.map((p, i) => (
                <li key={`${p.season}-${p.round}-${p.originalTeam}-${p.pick ?? i}`}>
                  Round {p.round}
                  {p.pick ? ` (pick ${p.pick})` : ''}
                  {p.playerId ? ` — ${state.players[p.playerId]?.name ?? p.playerId}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Incoming offers" revealIndex={4}>
          {room.pendingOffers.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>
              No offers yet. Teams call when your pick lines up with their biggest need.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {room.pendingOffers.map((proposal, i) => (
                <OfferCard
                  key={proposal.id}
                  title={`${teamAbbr(data, proposal.offer.teamId)} offers`}
                  youGet={describeSide(state, data, proposal.offer)}
                  youGive={describeSide(state, data, proposal.request)}
                  evaluation={onEvaluate(proposal)}
                  busy={busy}
                  revealIndex={i}
                  onAccept={() => onRespondToOffer(proposal, true)}
                  onDecline={() => onRespondToOffer(proposal, false)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </TeamScope>
  )
}
