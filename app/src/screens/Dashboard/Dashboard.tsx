import type { Game, LeagueState, StaticData } from '@contracts/index'
import { Button, Meter, Panel, StatTile } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'

export interface DashboardProps {
  state: LeagueState
  data: StaticData
  onSimWeek: () => void
  onAdvancePhase: () => void
  simBusy?: boolean
  advanceBusy?: boolean
}

function nextGame(state: LeagueState): Game | undefined {
  const upcoming = state.schedule
    .filter((g) => g.season === state.season && (g.home === state.userTeam || g.away === state.userTeam) && g.week >= state.week)
    .sort((a, b) => a.week - b.week)
  return upcoming[0]
}

function formatMoney(m: number): string {
  return `$${m.toFixed(1)}M`
}

/** Season hub: record, next opponent, horizon meter, cap, alerts, sim controls (docs/DESIGN.md §11). */
export function Dashboard({ state, data, onSimWeek, onAdvancePhase, simBusy, advanceBusy }: DashboardProps) {
  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]
  const record = team?.record ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
  const recordText = record.ties > 0 ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`
  const upcoming = nextGame(state)
  const opponentId = upcoming ? (upcoming.home === state.userTeam ? upcoming.away : upcoming.home) : null
  const opponentInfo = opponentId ? data.teams[opponentId] : null

  const horizonTotal = Math.max(1, state.horizonEnd - state.startSeason + 1)
  const horizonElapsed = Math.min(horizonTotal, Math.max(0, state.season - state.startSeason))

  const cap = data.cap.bySeason[String(state.season)] ?? 0
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const capSpace = cap - payroll - (team?.deadMoney ?? 0)

  const injured = (team?.roster ?? []).filter((slot) => slot.injured).length
  const expiring = (team?.roster ?? []).filter((slot) => slot.contract.years <= 1).length
  const alerts: string[] = []
  if (injured > 0) alerts.push(`${injured} player${injured === 1 ? '' : 's'} injured.`)
  if (expiring > 0) alerts.push(`${expiring} contract${expiring === 1 ? '' : 's'} expiring after this season.`)
  if (capSpace < 0) alerts.push(`Over the cap by ${formatMoney(-capSpace)}. Release or trade a contract to continue.`)

  return (
    <>
      <div className="gg-col-8">
        <Panel title="Season hub" variant="default" revealIndex={0} className="gg-yardlines">
          <p style={{ margin: '0 0 var(--sp-4)', fontSize: 'var(--fs-3)' }}>
            {teamInfo?.city} {teamInfo?.name} · <span className="tabular-nums">{recordText}</span>
          </p>
          {teamInfo && opponentInfo && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
              <TeamScope colors={teamInfo.colors}>
                <HelmetSprite pos="QB" size={4} />
              </TeamScope>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-2)' }}>at week {upcoming?.week}</span>
              <TeamScope colors={opponentInfo.colors}>
                <HelmetSprite pos="QB" size={4} />
              </TeamScope>
              <span>
                {opponentInfo.city} {opponentInfo.name}
              </span>
            </div>
          )}
          <Meter value={horizonTotal === 0 ? 0 : horizonElapsed / horizonTotal} label={`Season ${horizonElapsed + 1} of ${horizonTotal}`} />
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
            <Button type="button" variant="primary" busy={simBusy} busyLabel="Simming…" onClick={onSimWeek}>
              Sim week
            </Button>
            <Button type="button" variant="secondary" busy={advanceBusy} busyLabel="Working…" onClick={onAdvancePhase}>
              Sim to next event
            </Button>
          </div>
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="Cap" variant="default" revealIndex={1}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <StatTile value={formatMoney(cap)} label="Cap this season" />
            <StatTile value={formatMoney(capSpace)} label="Cap space" tone={capSpace < 0 ? 'danger' : 'default'} />
          </div>
        </Panel>
        <div style={{ height: 'var(--sp-4)' }} />
        <Panel title="Alerts" variant="default" revealIndex={2}>
          {alerts.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No alerts.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {alerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
