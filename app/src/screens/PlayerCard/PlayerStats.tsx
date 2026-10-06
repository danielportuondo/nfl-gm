import type { LeagueState, Player, StaticData } from '@contracts/index'
import { Panel, StatTile, Table } from '@ui/primitives'
import type { Column } from '@ui/primitives'
import {
  headlineKeysFor,
  latestRegularSeason,
  playerSeasonStats,
  statColumnsFor,
} from '@screens/shared/playerStats'
import type { SeasonStatLine, StatTotals } from '@screens/shared/playerStats'

export interface PlayerStatsProps {
  state: Pick<LeagueState, 'schedule' | 'results'>
  data: Pick<StaticData, 'teams'>
  player: Pick<Player, 'id' | 'pos'>
  revealIndex: number
}

interface StatRow {
  key: string
  label: string
  playoffs: boolean
  teams: string
  totals: StatTotals
}

function toRows(lines: SeasonStatLine[], data: Pick<StaticData, 'teams'>): StatRow[] {
  const teamLabel = (line: SeasonStatLine) =>
    line.teams.map((id) => data.teams[id]?.abbr ?? id).join(', ')
  return lines.flatMap((line) => {
    const rows: StatRow[] = []
    if (line.regular) {
      rows.push({
        key: `${line.season}-reg`,
        label: String(line.season),
        playoffs: false,
        teams: teamLabel(line),
        totals: line.regular,
      })
    }
    if (line.playoffs) {
      rows.push({
        key: `${line.season}-po`,
        label: `${line.season} playoffs`,
        playoffs: true,
        teams: teamLabel(line),
        totals: line.playoffs,
      })
    }
    return rows
  })
}

/**
 * The player's box-score line: a headline for the latest regular season, then every sim season
 * (playoffs on their own rows). Box scores are public; nothing here reads state.truth.
 */
export function PlayerStats({ state, data, player, revealIndex }: PlayerStatsProps) {
  const lines = playerSeasonStats(state, player.id)
  const latest = latestRegularSeason(lines)

  if (!latest) {
    return (
      <Panel title="Season by season" variant="sunken" revealIndex={revealIndex}>
        <p style={{ margin: 0, color: 'var(--text-2)' }}>
          No stats yet. Sim a week to see results here.
        </p>
      </Panel>
    )
  }

  const columns = statColumnsFor(player.pos)
  const headline = headlineKeysFor(player.pos)
  const tileColumns = headline
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
  const totals = latest.regular!
  const lineLabel = `${latest.season} regular season`

  const tableColumns: Column<StatRow>[] = [
    {
      key: 'season',
      header: 'Season',
      frozen: true,
      render: (row) => (
        <span style={{ whiteSpace: 'nowrap', color: row.playoffs ? 'var(--text-2)' : undefined }}>
          {row.label}
        </span>
      ),
    },
    { key: 'team', header: 'Team', render: (row) => row.teams },
    { key: 'games', header: 'Gm', numeric: true, render: (row) => row.totals.games },
    { key: 'missed', header: 'Missed', numeric: true, render: (row) => row.totals.gamesMissed },
    ...columns.map((col): Column<StatRow> => ({
      key: col.key,
      header: col.header,
      numeric: true,
      render: (row) => col.value(row.totals),
    })),
  ]

  return (
    <>
      <Panel title="This season" revealIndex={revealIndex}>
        <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--text-2)' }}>{lineLabel}</p>
        <div
          role="group"
          aria-label={`${lineLabel} line`}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-5)' }}
        >
          <StatTile value={totals.games} label="Games" />
          {tileColumns.map((col) => (
            <StatTile key={col.key} value={col.value(totals)} label={col.label} />
          ))}
          {totals.gamesMissed > 0 && (
            <StatTile value={totals.gamesMissed} label="Missed, injured" tone="danger" />
          )}
        </div>
      </Panel>

      <div style={{ height: 'var(--sp-4)' }} />

      <Panel title="Season by season" variant="sunken" revealIndex={revealIndex + 1}>
        <Table
          dense
          caption="Season by season"
          columns={tableColumns}
          rows={toRows(lines, data)}
          rowKey={(row) => row.key}
        />
        <p style={{ margin: 'var(--sp-3) 0 0', color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
          Games counts box-score appearances. Missed counts team games lost to injury.
        </p>
      </Panel>
    </>
  )
}
