import { useMemo, useState } from 'react'
import type { Conference, Division, StandingRow, StaticData } from '@contracts/index'
import { Panel, StatusBadge, Table, type Column, type SortState } from '@ui/primitives'
import { TeamScope, HelmetSprite } from '@ui/sprites'

export interface StandingsProps {
  data: StaticData
  rows: StandingRow[]
}

const GROUPS: Array<{ conf: Conference; div: Division }> = (['AFC', 'NFC'] as Conference[]).flatMap(
  (conf) => (['East', 'North', 'South', 'West'] as Division[]).map((div) => ({ conf, div })),
)

function clinchBadge(row: StandingRow) {
  if (row.clinched === 'DIV') return <StatusBadge status="clinch-div" />
  if (row.clinched === 'BYE') return <StatusBadge status="clinch-bye" />
  if (row.clinched === 'WC') return <StatusBadge status="clinch-wc" />
  return null
}

/** Eight division tables with clinch badges, sortable (docs/DESIGN.md §11). */
export function Standings({ data, rows }: StandingsProps) {
  const [sort, setSort] = useState<SortState>({ key: 'pct', dir: 'desc' })

  function sortRows(group: StandingRow[]): StandingRow[] {
    const dir = sort.dir === 'asc' ? 1 : -1
    const sorted = [...group]
    sorted.sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return 0
    })
    return sorted
  }

  function sortValue(row: StandingRow, key: string): number | string {
    switch (key) {
      case 'team':
        return data.teams[row.teamId]?.abbr ?? row.teamId
      case 'record':
        return row.wins
      case 'pct':
        return row.pct
      case 'pf':
        return row.pointsFor
      case 'pa':
        return row.pointsAgainst
      default:
        return 0
    }
  }

  const columns: Column<StandingRow>[] = [
    {
      key: 'team',
      header: 'Team',
      frozen: true,
      sortValue: (r) => data.teams[r.teamId]?.abbr ?? r.teamId,
      render: (r) => {
        const info = data.teams[r.teamId]
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            {info && (
              <TeamScope colors={info.colors}>
                <HelmetSprite pos="QB" size={2} />
              </TeamScope>
            )}
            {info?.city} {info?.name}
          </span>
        )
      },
    },
    {
      key: 'record',
      header: 'W-L-T',
      numeric: true,
      sortValue: (r) => r.wins,
      render: (r) => `${r.wins}-${r.losses}-${r.ties}`,
    },
    {
      key: 'pct',
      header: 'Pct',
      numeric: true,
      sortValue: (r) => r.pct,
      render: (r) => r.pct.toFixed(3),
    },
    {
      key: 'pf',
      header: 'PF',
      numeric: true,
      sortValue: (r) => r.pointsFor,
      render: (r) => r.pointsFor,
    },
    {
      key: 'pa',
      header: 'PA',
      numeric: true,
      sortValue: (r) => r.pointsAgainst,
      render: (r) => r.pointsAgainst,
    },
    { key: 'clinch', header: 'Clinched', render: clinchBadge },
  ]

  const byGroup = useMemo(() => {
    const map = new Map<string, StandingRow[]>()
    for (const g of GROUPS) map.set(`${g.conf}-${g.div}`, [])
    for (const row of rows) {
      const info = data.teams[row.teamId]
      if (!info) continue
      const key = `${info.conf}-${info.div}`
      map.get(key)?.push(row)
    }
    return map
  }, [rows, data.teams])

  if (rows.length === 0) {
    return (
      <div className="gg-col-12">
        <Panel title="Standings" revealIndex={0}>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>Not built yet.</p>
        </Panel>
      </div>
    )
  }

  return (
    <>
      {GROUPS.map((g, i) => (
        <div className="gg-col-6" key={`${g.conf}-${g.div}`}>
          <Panel title={`${g.conf} ${g.div}`} variant="sunken" revealIndex={i}>
            <Table
              columns={columns}
              rows={sortRows(byGroup.get(`${g.conf}-${g.div}`) ?? [])}
              rowKey={(r) => r.teamId}
              caption={`${g.conf} ${g.div} standings`}
              dense
              sort={sort}
              onSortChange={(key) =>
                setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
              }
            />
          </Panel>
        </div>
      ))}
    </>
  )
}
