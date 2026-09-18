import { useState } from 'react'
import { TEAM_IDS, type LeagueState, type Position, type PlayerId, type StaticData, type TeamId } from '@contracts/index'
import { Panel, PositionBadge, StatTile, Table, TeamBadge, type Column } from '@ui/primitives'
import { BustSprite, TeamScope } from '@ui/sprites'

export interface LeagueBrowserProps {
  state: LeagueState
  data: StaticData
  onSelectPlayer: (id: PlayerId) => void
}

interface Row {
  id: PlayerId
  name: string
  pos: Position
  ovr: number
  pot: number
  apy: number
  years: number
}

function formatMoney(m: number): string {
  return `$${m.toFixed(1)}M`
}

/** Team plate grid → that team's roster, picks and cap (docs/DESIGN.md §11). */
export function LeagueBrowser({ state, data, onSelectPlayer }: LeagueBrowserProps) {
  const [selectedTeam, setSelectedTeam] = useState<TeamId>(state.userTeam)
  const team = state.teams[selectedTeam]
  const info = data.teams[selectedTeam]
  const cap = data.cap.bySeason[String(state.season)] ?? 0
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)

  const rows: Row[] = (team?.roster ?? [])
    .map((slot) => {
      const player = state.players[slot.playerId]
      const scouting = state.scouting[slot.playerId]
      if (!player || !scouting) return null
      return { id: slot.playerId, name: player.name, pos: player.pos, ovr: scouting.ovr, pot: scouting.pot, apy: slot.contract.apy, years: slot.contract.years }
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.ovr - a.ovr)

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Player',
      frozen: true,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          <BustSprite pos={r.pos} size={2} />
          {r.name} <PositionBadge pos={r.pos} />
        </span>
      ),
    },
    { key: 'ovr', header: 'Ovr', numeric: true, rating: true, render: (r) => r.ovr },
    { key: 'pot', header: 'Pot', numeric: true, rating: true, render: (r) => r.pot },
    { key: 'years', header: 'Years', numeric: true, render: (r) => r.years },
    { key: 'apy', header: 'APY', numeric: true, render: (r) => formatMoney(r.apy) },
  ]

  const picks = state.picks.filter((p) => p.owner === selectedTeam).sort((a, b) => a.season - b.season || a.round - b.round)

  return (
    <>
      <div className="gg-col-12">
        <Panel title="Teams" variant="sunken" revealIndex={0}>
          <div role="grid" aria-label="Teams" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 'var(--sp-2)' }}>
            {TEAM_IDS.map((id) => {
              const t = data.teams[id]
              if (!t) return null
              return (
                <TeamScope key={id} colors={t.colors}>
                  <button
                    type="button"
                    className="gg-nameplate"
                    aria-selected={id === selectedTeam}
                    aria-label={`${t.city} ${t.name}`}
                    onClick={() => setSelectedTeam(id)}
                    style={{ justifyContent: 'center' }}
                  >
                    <TeamBadge abbr={t.abbr} />
                  </button>
                </TeamScope>
              )
            })}
          </div>
        </Panel>
      </div>

      {info && team && (
        <TeamScope colors={info.colors} as="div" style={{ display: 'contents' }}>
          <div className="gg-col-4">
            <Panel variant="plate" title={`${info.city} ${info.name}`} revealIndex={1}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
                <StatTile value={`${team.record.wins}-${team.record.losses}-${team.record.ties}`} label="Record" />
                <StatTile value={formatMoney(cap - payroll - team.deadMoney)} label="Cap space" tone={cap - payroll - team.deadMoney < 0 ? 'danger' : 'default'} />
              </div>
            </Panel>

            <div style={{ height: 'var(--sp-4)' }} />

            <Panel title="Draft picks" variant="sunken" revealIndex={2}>
              {picks.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--text-2)' }}>No picks owned.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
                  {picks.map((p) => (
                    <li key={`${p.season}-${p.round}-${p.originalTeam}`}>
                      {p.season} round {p.round}
                      {p.originalTeam !== selectedTeam ? ` (via ${data.teams[p.originalTeam]?.abbr ?? p.originalTeam})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="gg-col-8">
            <Panel title="Roster" variant="sunken" revealIndex={3}>
              <Table columns={columns} rows={rows} rowKey={(r) => r.id} caption={`${selectedTeam} roster`} dense onRowClick={(r) => onSelectPlayer(r.id)} />
            </Panel>
          </div>
        </TeamScope>
      )}
    </>
  )
}
