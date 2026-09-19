import { useMemo, useState } from 'react'
import type { GameResult, LeagueState, StaticData, TeamId } from '@contracts/index'
import { Button, Panel, Table, type Column } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'

export interface ScheduleProps {
  state: LeagueState
  data: StaticData
  busy?: { simWeek?: boolean; simToNextEvent?: boolean; simSeason?: boolean }
  onSimWeek: () => void
  onSimToNextEvent: () => void
  onSimSeason: () => void
}

interface UserGameRow {
  week: number
  opponent: TeamId
  home: boolean
  result: GameResult | null
}

function resultText(row: UserGameRow): string {
  if (!row.result) return '—'
  const my = row.home ? row.result.homeScore : row.result.awayScore
  const their = row.home ? row.result.awayScore : row.result.homeScore
  const outcome = my > their ? 'W' : my < their ? 'L' : 'T'
  return `${outcome} ${my}-${their}${row.result.overtime ? ' OT' : ''}`
}

/** Week-by-week for the user's team plus league scores for the selected week (docs/DESIGN.md §11). */
export function Schedule({
  state,
  data,
  busy,
  onSimWeek,
  onSimToNextEvent,
  onSimSeason,
}: ScheduleProps) {
  const userGames = useMemo(() => {
    const rows: UserGameRow[] = []
    for (const g of state.schedule) {
      if (g.season !== state.season) continue
      if (g.home !== state.userTeam && g.away !== state.userTeam) continue
      const home = g.home === state.userTeam
      const opponent = home ? g.away : g.home
      const result = state.results.find((r) => r.gameId === g.id) ?? null
      rows.push({ week: g.week, opponent, home, result })
    }
    return rows.sort((a, b) => a.week - b.week)
  }, [state.schedule, state.results, state.season, state.userTeam])

  const [selectedWeek, setSelectedWeek] = useState<number>(state.week || 1)
  const weeks = useMemo(
    () =>
      [...new Set(state.schedule.filter((g) => g.season === state.season).map((g) => g.week))].sort(
        (a, b) => a - b,
      ),
    [state.schedule, state.season],
  )

  const weekGames = state.schedule.filter(
    (g) => g.season === state.season && g.week === selectedWeek,
  )

  const columns: Column<UserGameRow>[] = [
    { key: 'week', header: 'Week', numeric: true, render: (r) => r.week },
    {
      key: 'opponent',
      header: 'Opponent',
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {data.teams[r.opponent] && (
            <TeamScope colors={data.teams[r.opponent]!.colors}>
              <HelmetSprite pos="QB" size={2} />
            </TeamScope>
          )}
          {r.home ? 'vs' : '@'} {data.teams[r.opponent]?.abbr ?? r.opponent}
        </span>
      ),
    },
    { key: 'result', header: 'Result', render: (r) => resultText(r) },
  ]

  return (
    <>
      <div className="gg-col-12">
        <Panel title="Sim controls" revealIndex={0}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
            <Button
              type="button"
              variant="primary"
              busy={busy?.simWeek}
              busyLabel="Simming…"
              onClick={onSimWeek}
            >
              Sim week
            </Button>
            <Button
              type="button"
              variant="secondary"
              busy={busy?.simToNextEvent}
              busyLabel="Simming…"
              onClick={onSimToNextEvent}
            >
              Sim to next event
            </Button>
            <Button
              type="button"
              variant="secondary"
              busy={busy?.simSeason}
              busyLabel="Simming…"
              onClick={onSimSeason}
            >
              Sim season
            </Button>
          </div>
        </Panel>
      </div>

      <div className="gg-col-6">
        <Panel title="Your schedule" variant="sunken" revealIndex={1}>
          <Table
            columns={columns}
            rows={userGames}
            rowKey={(r) => `${r.week}`}
            caption={`${state.userTeam} ${state.season} schedule`}
            dense
          />
        </Panel>
      </div>

      <div className="gg-col-6">
        <Panel
          title="League scores"
          variant="sunken"
          revealIndex={2}
          action={
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              Week
              <select
                value={selectedWeek}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
              >
                {weeks.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {weekGames.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No games scheduled this week.</p>
          ) : (
            <ul
              style={{
                margin: 0,
                paddingLeft: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--sp-2)',
              }}
            >
              {weekGames.map((g) => {
                const result = state.results.find((r) => r.gameId === g.id)
                return (
                  <li key={g.id} className="tabular-nums">
                    {data.teams[g.away]?.abbr ?? g.away} @ {data.teams[g.home]?.abbr ?? g.home}
                    {result
                      ? ` — ${result.awayScore}-${result.homeScore}${result.overtime ? ' OT' : ''}`
                      : ' — not played'}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
