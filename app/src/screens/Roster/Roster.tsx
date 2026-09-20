import { useMemo, useState } from 'react'
import {
  POSITIONS,
  type CutdownPlan,
  type LeagueState,
  type PlayerId,
  type Position,
  type RosterSlot,
  type StaticData,
} from '@contracts/index'
import {
  Button,
  NamePlate,
  Panel,
  PositionBadge,
  StatusBadge,
  Table,
  type Column,
  type SortState,
} from '@ui/primitives'
import { BustSprite, TeamScope } from '@ui/sprites'
import { formatMoney } from '@screens/shared/formatMoney'
import { injuredWeeksLabel, isRookie } from '@screens/shared/playerStatus'

/** Phases in which the roster must be legal to sim (docs/DECISIONS.md 2026-09-20 cutdown helper). */
const CAP_GATED_PHASES = new Set<LeagueState['phase']>(['PRESEASON', 'REGULAR', 'PLAYOFFS'])

/** League roster limit shown/used when no size cuts are suggested to derive it from. */
const ROSTER_LIMIT_FALLBACK = 53

export interface RosterProps {
  state: LeagueState
  data: StaticData
  onSelectPlayer: (id: PlayerId) => void
  onReorderDepthChart: (pos: Position, order: PlayerId[]) => void
  /** Cut a player (dead money applies); the store gates who can be released. */
  onRelease?: (id: PlayerId) => void
  releaseBusy?: boolean
  /** This season's cap in $M; omitted while data is loading (cutdown panel's cap clause is dropped). */
  cap?: number
  /** Pure suggested-cutdown preview, re-run locally as the user keeps/un-keeps players. */
  cutdownPlan?: (protect: readonly PlayerId[]) => CutdownPlan | null
  /** Releases every checked cutdown row in one action. */
  onReleaseMany?: (ids: PlayerId[]) => void
}

interface Row {
  slot: RosterSlot
  name: string
  pos: Position
  age: number
  ovr: number
  pot: number
  years: number
  apy: number
  rookie: boolean
  injured: boolean
  injuredWeeks: string | null
  expiring: boolean
}

interface CutdownRow {
  playerId: PlayerId
  name: string
  pos: Position
  age: number
  ovr: number
  apy: number
  deadMoney: number | null
  netSavings: number | null
  kept: boolean
  why: string
}

const FILTERS: Array<Position | 'ALL'> = ['ALL', ...POSITIONS]

/** Dense roster table with a position filter, plus a keyboard-reorderable depth chart (docs/DESIGN.md §11). */
export function Roster({
  state,
  data,
  onSelectPlayer,
  onReorderDepthChart,
  onRelease,
  releaseBusy,
  cap,
  cutdownPlan,
  onReleaseMany,
}: RosterProps) {
  const [filter, setFilter] = useState<Position | 'ALL'>('ALL')
  const [sort, setSort] = useState<SortState>({ key: 'ovr', dir: 'desc' })
  const [protect, setProtect] = useState<PlayerId[]>([])
  const team = state.teams[state.userTeam]

  const plan = cutdownPlan ? cutdownPlan(protect) : null
  const showCutdown =
    Boolean(plan) && CAP_GATED_PHASES.has(state.phase) && (plan!.cuts.length > 0 || !plan!.ok)

  const rows: Row[] = useMemo(() => {
    if (!team) return []
    return team.roster.map((slot) => {
      const player = state.players[slot.playerId]!
      const scouting = state.scouting[slot.playerId]!
      return {
        slot,
        name: player.name,
        pos: player.pos,
        age: state.season - player.birthYear,
        ovr: scouting.ovr,
        pot: scouting.pot,
        years: slot.contract.years,
        apy: slot.contract.apy,
        rookie: isRookie(player, state),
        injured: Boolean(slot.injured),
        injuredWeeks: injuredWeeksLabel(slot.injured),
        expiring: slot.contract.years <= 1,
      }
    })
  }, [team, state])

  const filtered = filter === 'ALL' ? rows : rows.filter((r) => r.pos === filter)
  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const withValues = filtered.map((r) => ({ row: r, value: sortValue(r, sort.key) }))
    withValues.sort((a, b) => (a.value < b.value ? -1 * dir : a.value > b.value ? 1 * dir : 0))
    return withValues.map((w) => w.row)
  }, [filtered, sort])

  function sortValue(r: Row, key: string): number | string {
    switch (key) {
      case 'name':
        return r.name
      case 'age':
        return r.age
      case 'ovr':
        return r.ovr
      case 'pot':
        return r.pot
      case 'years':
        return r.years
      case 'apy':
        return r.apy
      default:
        return 0
    }
  }

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Player',
      frozen: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <BustSprite pos={r.pos} size={2} status={{ injured: r.injured, rookie: r.rookie }} />
          {r.name}
          <PositionBadge pos={r.pos} />
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
    {
      key: 'years',
      header: 'Years',
      numeric: true,
      sortValue: (r) => r.years,
      render: (r) => r.years,
    },
    {
      key: 'apy',
      header: 'APY',
      numeric: true,
      sortValue: (r) => r.apy,
      render: (r) => formatMoney(r.apy),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <span
          style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          {r.rookie && <StatusBadge status="rookie" />}
          {r.injured && (
            <>
              <StatusBadge status="injured" />
              {r.injuredWeeks && (
                <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
                  {r.injuredWeeks}
                </span>
              )}
            </>
          )}
          {r.expiring && <StatusBadge status="expiring" />}
        </span>
      ),
    },
    ...(onRelease
      ? [
          {
            key: 'release',
            header: '',
            render: (r: Row) => (
              <Button
                type="button"
                variant="ghost"
                busy={releaseBusy}
                busyLabel="…"
                aria-label={`Release ${r.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onRelease(r.slot.playerId)
                }}
              >
                Release
              </Button>
            ),
          } satisfies Column<Row>,
        ]
      : []),
  ]

  const depthPositions: Position[] = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S']
  const teamColors = data.teams[state.userTeam]?.colors ?? {
    primary: '#1F4334',
    secondary: '#F3ECD2',
  }

  // --- Cutdown panel (docs/DECISIONS.md 2026-09-20) ---------------------------------------------
  const sizeCuts = plan?.cuts.filter((c) => c.reason === 'size') ?? []
  const currentSize = team?.roster.length ?? 0
  const rosterLimit = sizeCuts.length > 0 ? currentSize - sizeCuts.length : ROSTER_LIMIT_FALLBACK
  const oversized = currentSize > rosterLimit
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const capSpace = cap == null || !team ? null : cap - payroll - team.deadMoney
  const overCap = capSpace != null && capSpace < 0

  const cutdownTitle =
    oversized && overCap
      ? `Cut down to ${rosterLimit} and get under the cap`
      : oversized
        ? `Cut down to ${rosterLimit}`
        : 'Get under the cap'

  const statusParts: string[] = []
  if (oversized) statusParts.push(`${currentSize} player${currentSize === 1 ? '' : 's'}`)
  if (overCap && capSpace != null) statusParts.push(`${formatMoney(-capSpace)} over the cap`)
  const cutdownStatus = statusParts.length > 0 ? `${statusParts.join(', ')}.` : ''

  function cutdownRow(
    playerId: PlayerId,
    opts: { kept: boolean; reason?: 'size' | 'cap'; deadMoney?: number; netSavings?: number },
  ): CutdownRow | null {
    const player = state.players[playerId]
    const scouting = state.scouting[playerId]
    const slot = team?.roster.find((s) => s.playerId === playerId)
    if (!player || !scouting || !slot) return null
    return {
      playerId,
      name: player.name,
      pos: player.pos,
      age: state.season - player.birthYear,
      ovr: scouting.ovr,
      apy: slot.contract.apy,
      deadMoney: opts.deadMoney ?? null,
      netSavings: opts.netSavings ?? null,
      kept: opts.kept,
      why: opts.kept ? 'Kept' : opts.reason === 'size' ? `To ${rosterLimit}` : 'Cap',
    }
  }

  const cutdownRows: CutdownRow[] = plan
    ? [
        ...plan.cuts.flatMap((c) => {
          const row = cutdownRow(c.playerId, {
            kept: false,
            reason: c.reason,
            deadMoney: c.deadMoney,
            netSavings: c.netSavings,
          })
          return row ? [row] : []
        }),
        ...protect.flatMap((id) => {
          const row = cutdownRow(id, { kept: true })
          return row ? [row] : []
        }),
      ]
    : []

  const checkedIds = plan?.cuts.map((c) => c.playerId) ?? []
  const releaseLabel = `Release ${checkedIds.length} player${checkedIds.length === 1 ? '' : 's'}`

  const cutdownSummary = plan
    ? plan.ok
      ? `After these ${plan.cuts.length} cut${plan.cuts.length === 1 ? '' : 's'}: ${plan.sizeAfter} players, ${formatMoney(plan.capSpaceAfter)} under the cap.`
      : `After these ${plan.cuts.length} cut${plan.cuts.length === 1 ? '' : 's'}: ${plan.sizeAfter} players, still ${formatMoney(-plan.capSpaceAfter)} over the cap. Trade a contract to get under.`
    : ''

  const cutdownColumns: Column<CutdownRow>[] = [
    {
      key: 'cut',
      header: 'Cut',
      render: (r) => (
        <input
          type="checkbox"
          checked={!r.kept}
          aria-label={`Cut ${r.name}`}
          style={{ width: 18, height: 18, accentColor: 'var(--accent)', cursor: 'pointer' }}
          onChange={() => {
            setProtect((prev) =>
              r.kept ? prev.filter((id) => id !== r.playerId) : [...prev, r.playerId],
            )
          }}
        />
      ),
    },
    {
      key: 'player',
      header: 'Player',
      frozen: true,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {r.name}
          <PositionBadge pos={r.pos} />
        </span>
      ),
    },
    { key: 'age', header: 'Age', numeric: true, render: (r) => r.age },
    { key: 'ovr', header: 'Ovr', numeric: true, rating: true, render: (r) => r.ovr },
    { key: 'apy', header: 'APY', numeric: true, render: (r) => formatMoney(r.apy) },
    {
      key: 'deadMoney',
      header: 'Dead money',
      numeric: true,
      render: (r) => (r.deadMoney == null ? '—' : formatMoney(r.deadMoney)),
    },
    {
      key: 'savings',
      header: 'Savings',
      numeric: true,
      render: (r) => (r.netSavings == null ? '—' : formatMoney(r.netSavings)),
    },
    {
      key: 'why',
      header: 'Why',
      render: (r) => (r.kept ? <span style={{ color: 'var(--text-2)' }}>{r.why}</span> : r.why),
    },
  ]

  const revealBase = showCutdown ? 1 : 0

  return (
    <TeamScope colors={teamColors} as="div" style={{ display: 'contents' }}>
      {showCutdown && plan && (
        <div className="gg-col-12">
          <Panel title={cutdownTitle} variant="attention" revealIndex={0}>
            {cutdownStatus && (
              <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--text-2)' }}>{cutdownStatus}</p>
            )}
            <Table
              columns={cutdownColumns}
              rows={cutdownRows}
              rowKey={(r) => r.playerId}
              caption={`${cutdownTitle} — suggested cuts`}
              dense
            />
            <p style={{ margin: 'var(--sp-3) 0' }}>{cutdownSummary}</p>
            <Button
              type="button"
              variant="danger"
              busy={releaseBusy}
              busyLabel="Releasing…"
              disabled={checkedIds.length === 0}
              onClick={() => {
                onReleaseMany?.(checkedIds)
                setProtect([])
              }}
            >
              {releaseLabel}
            </Button>
          </Panel>
        </div>
      )}

      <div className="gg-col-12">
        <Panel title="Roster" variant="sunken" revealIndex={revealBase}>
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
            rowKey={(r) => r.slot.playerId}
            caption={`${team?.id ?? ''} roster · ${rows.length} players`}
            dense
            sort={sort}
            onSortChange={(key) =>
              setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
            }
            onRowClick={(r) => onSelectPlayer(r.slot.playerId)}
          />
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Depth chart" variant="sunken" revealIndex={revealBase + 1}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            {depthPositions.map((pos) => {
              const order = team?.depthChart[pos] ?? []
              return (
                <div key={pos}>
                  <h4
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fd-1)',
                      margin: '0 0 var(--sp-2)',
                    }}
                  >
                    {pos}
                  </h4>
                  <div
                    role="list"
                    aria-label={`${pos} depth chart`}
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}
                  >
                    {order.map((id, i) => {
                      const player = state.players[id]
                      const scouting = state.scouting[id]
                      if (!player || !scouting) return null
                      return (
                        <NamePlate
                          key={id}
                          name={player.name}
                          pos={player.pos}
                          meta={`${scouting.ovr} ovr`}
                          onMoveUp={
                            i > 0
                              ? () => {
                                  const next = [...order]
                                  ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
                                  onReorderDepthChart(pos, next)
                                }
                              : undefined
                          }
                          onMoveDown={
                            i < order.length - 1
                              ? () => {
                                  const next = [...order]
                                  ;[next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
                                  onReorderDepthChart(pos, next)
                                }
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </TeamScope>
  )
}
