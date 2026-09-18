import { useMemo, useState } from 'react'
import type { LeagueState, PlayerId, Position, StaticData } from '@contracts/index'
import { Button, Panel, PositionBadge, StatTile, Table, type Column, type SortState } from '@ui/primitives'
import { TeamScope } from '@ui/sprites'

export interface FinancesProps {
  state: LeagueState
  data: StaticData
  /** This season's cap in $M, from the store. */
  cap: number
  /** Next season's cap in $M; null when not built yet. */
  capNextSeason: number | null
  busy?: boolean
  onRelease: (playerId: PlayerId) => void
  onSelectPlayer?: (id: PlayerId) => void
}

interface PayrollRow {
  id: PlayerId
  name: string
  pos: Position | null
  apy: number
  years: number
  expiring: boolean
}

function formatMoney(m: number): string {
  return `$${m.toFixed(1)}M`
}

/** Cap table by player, dead money, cap space this season and next, expiring contracts (docs/DESIGN.md §11). */
export function Finances({ state, data, cap, capNextSeason, busy, onRelease, onSelectPlayer }: FinancesProps) {
  const [sort, setSort] = useState<SortState>({ key: 'apy', dir: 'desc' })
  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]

  const allRows: PayrollRow[] = (team?.roster ?? []).map((slot) => {
    const player = state.players[slot.playerId]
    return {
      id: slot.playerId,
      name: player?.name ?? slot.playerId,
      pos: player?.pos ?? null,
      apy: slot.contract.apy,
      years: slot.contract.years,
      expiring: slot.contract.years <= 1,
    }
  })

  const rows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1
    const sorted = [...allRows]
    sorted.sort((a, b) => {
      const va = sort.key === 'name' ? a.name : sort.key === 'years' ? a.years : a.apy
      const vb = sort.key === 'name' ? b.name : sort.key === 'years' ? b.years : b.apy
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
    })
    return sorted
  }, [allRows, sort])

  const payroll = allRows.reduce((sum, r) => sum + r.apy, 0)
  const deadMoney = team?.deadMoney ?? 0
  const capSpace = cap - payroll - deadMoney
  // Contracts with years > 1 remain on the books next season; this season's expiring deals fall off.
  const payrollNextSeason = allRows.filter((r) => r.years > 1).reduce((sum, r) => sum + r.apy, 0)
  const capSpaceNext = capNextSeason == null ? null : capNextSeason - payrollNextSeason
  const expiring = allRows.filter((r) => r.expiring)

  const columns: Column<PayrollRow>[] = [
    {
      key: 'name',
      header: 'Player',
      frozen: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {r.name} {r.pos && <PositionBadge pos={r.pos} />}
        </span>
      ),
    },
    { key: 'years', header: 'Years', numeric: true, sortValue: (r) => r.years, render: (r) => r.years },
    { key: 'apy', header: 'APY', numeric: true, sortValue: (r) => r.apy, render: (r) => formatMoney(r.apy) },
    {
      key: 'release',
      header: '',
      render: (r) => (
        <Button
          type="button"
          variant="danger"
          busy={busy}
          busyLabel="…"
          aria-label={`Release ${r.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onRelease(r.id)
          }}
        >
          Release
        </Button>
      ),
    },
  ]

  return (
    <TeamScope colors={teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' }} as="div" style={{ display: 'contents' }}>
      <div className="gg-col-12">
        <Panel title="Cap" revealIndex={0}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-4)' }}>
            <StatTile value={formatMoney(cap)} label="Cap this season" />
            <StatTile value={formatMoney(capSpace)} label="Cap space this season" tone={capSpace < 0 ? 'danger' : 'default'} />
            <StatTile value={formatMoney(deadMoney)} label="Dead money" tone={deadMoney > 0 ? 'danger' : 'default'} />
            <StatTile
              value={capSpaceNext == null ? '—' : formatMoney(capSpaceNext)}
              label="Cap space next season"
              tone={capSpaceNext != null && capSpaceNext < 0 ? 'danger' : 'default'}
            />
          </div>
        </Panel>
      </div>

      <div className="gg-col-8">
        <Panel title="Payroll" variant="sunken" revealIndex={1}>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            caption={`${state.userTeam} payroll by player`}
            dense
            onRowClick={onSelectPlayer ? (r) => onSelectPlayer(r.id) : undefined}
            sort={sort}
            onSortChange={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
          />
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="Contracts expiring" variant="sunken" revealIndex={2}>
          {expiring.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No contracts expire after this season.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {expiring.map((r) => (
                <li key={r.id}>
                  {r.name} · {formatMoney(r.apy)}/yr
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </TeamScope>
  )
}
