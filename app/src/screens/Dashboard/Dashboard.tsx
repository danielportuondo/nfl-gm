import type { Game, LeagueState, StaticData } from '@contracts/index'
import { Button, Meter, Panel, StatTile } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'
import { formatMoney } from '@screens/shared/formatMoney'
import { injuredWeeksLabel } from '@screens/shared/playerStatus'
import type { ScreenId } from '@store/router'

export interface DashboardProps {
  state: LeagueState
  data: StaticData
  /** This season's cap in $M (the store knows the post-data growth rule; the raw table does not). */
  cap: number
  onSimWeek: () => void
  onAdvancePhase: () => void
  simBusy?: boolean
  advanceBusy?: boolean
  /** Routes an alert to the screen that can fix it (docs/HANDOFF.md Phase 5A brief item 5). */
  onNavigate?: (screen: ScreenId) => void
}

interface Alert {
  text: string
  detail: string
  screen: ScreenId
}

function nextGame(state: LeagueState): Game | undefined {
  const upcoming = state.schedule
    .filter(
      (g) =>
        g.season === state.season &&
        (g.home === state.userTeam || g.away === state.userTeam) &&
        g.week >= state.week,
    )
    .sort((a, b) => a.week - b.week)
  return upcoming[0]
}

/** Season hub: record, next opponent, horizon meter, cap, alerts, sim controls (docs/DESIGN.md §11). */
/** What pressing the phase button does from each stop of the offseason; in season the week sim takes over. */
const ADVANCE_LABEL: Record<LeagueState['phase'], string> = {
  PRESEASON: 'Start the season',
  REGULAR: 'Sim week',
  PLAYOFFS: 'Sim week',
  OFFSEASON_RESIGN: 'Close re-signing and go to the draft',
  DRAFT: 'Leave the draft',
  UDFA: 'Close UDFA signings',
  FREE_AGENCY: 'Close free agency',
  TRAINING_CAMP: 'Break camp',
}

export function Dashboard({
  state,
  data,
  cap,
  onSimWeek,
  onAdvancePhase,
  simBusy,
  advanceBusy,
  onNavigate,
}: DashboardProps) {
  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]
  const record = team?.record ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
  const recordText =
    record.ties > 0
      ? `${record.wins}-${record.losses}-${record.ties}`
      : `${record.wins}-${record.losses}`
  const upcoming = nextGame(state)
  const opponentId = upcoming
    ? upcoming.home === state.userTeam
      ? upcoming.away
      : upcoming.home
    : null
  const opponentInfo = opponentId ? data.teams[opponentId] : null

  const horizonTotal = Math.max(1, state.horizonEnd - state.startSeason + 1)
  const horizonElapsed = Math.min(horizonTotal, Math.max(0, state.season - state.startSeason))

  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const capSpace = cap - payroll - (team?.deadMoney ?? 0)

  const inSeason = state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
  const draftPending = state.phase === 'DRAFT' && state.draftRoom?.status !== 'COMPLETE'
  const advanceLabel = ADVANCE_LABEL[state.phase]

  const injuredSlots = (team?.roster ?? []).filter((slot) => slot.injured)
  const expiring = (team?.roster ?? []).filter((slot) => slot.contract.years <= 1).length
  const alerts: Alert[] = []
  if (injuredSlots.length > 0) {
    const worst = injuredSlots
      .map((slot) => ({
        name: state.players[slot.playerId]?.name ?? slot.playerId,
        label: injuredWeeksLabel(slot.injured),
      }))
      .sort((a, b) => (b.label ?? '').localeCompare(a.label ?? ''))[0]!
    alerts.push({
      text: `${injuredSlots.length} player${injuredSlots.length === 1 ? '' : 's'} injured.`,
      detail: worst.label ? `${worst.name}: ${worst.label}` : worst.name,
      screen: 'roster',
    })
  }
  if (expiring > 0) {
    alerts.push({
      text: `${expiring} contract${expiring === 1 ? '' : 's'} expiring after this season.`,
      detail: 'Re-sign them in Free agency or let them walk.',
      screen: 'free-agency',
    })
  }
  if (capSpace < 0) {
    alerts.push({
      text: `Over the cap by ${formatMoney(-capSpace)}.`,
      detail: 'Release or trade a contract to continue.',
      screen: 'finances',
    })
  }
  const rosterSize = team?.roster.length ?? 0
  if ((state.phase === 'PRESEASON' || inSeason) && rosterSize > 53) {
    alerts.push({
      text: `Roster has ${rosterSize} players.`,
      detail: 'Cut to 53 to continue.',
      screen: 'roster',
    })
  }
  if ((state.phase === 'PRESEASON' || inSeason) && rosterSize < 46) {
    alerts.push({
      text: `Roster has ${rosterSize} players.`,
      detail: `Sign at least ${46 - rosterSize} more in free agency.`,
      screen: 'free-agency',
    })
  }

  return (
    <>
      <div className="gg-col-8">
        <Panel title="Season hub" variant="default" revealIndex={0} className="gg-yardlines">
          <p style={{ margin: '0 0 var(--sp-4)', fontSize: 'var(--fs-3)' }}>
            {teamInfo?.city} {teamInfo?.name} · <span className="tabular-nums">{recordText}</span>
          </p>
          {teamInfo && opponentInfo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-4)',
                marginBottom: 'var(--sp-4)',
              }}
            >
              <TeamScope colors={teamInfo.colors}>
                <HelmetSprite pos="QB" size={4} />
              </TeamScope>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-2)' }}>
                at week {upcoming?.week}
              </span>
              <TeamScope colors={opponentInfo.colors}>
                <HelmetSprite pos="QB" size={4} />
              </TeamScope>
              <span>
                {opponentInfo.city} {opponentInfo.name}
              </span>
            </div>
          )}
          <Meter
            value={horizonTotal === 0 ? 0 : horizonElapsed / horizonTotal}
            label={`Season ${horizonElapsed + 1} of ${horizonTotal}`}
          />
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              marginTop: 'var(--sp-4)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            {inSeason ? (
              <Button
                type="button"
                variant="primary"
                busy={simBusy}
                busyLabel="Simming…"
                onClick={onSimWeek}
              >
                Sim week
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                busy={advanceBusy}
                busyLabel="Working…"
                disabled={draftPending}
                onClick={onAdvancePhase}
              >
                {advanceLabel}
              </Button>
            )}
            {draftPending && (
              <span style={{ color: 'var(--text-2)' }}>
                Finish the draft in the Draft room first.
              </span>
            )}
          </div>
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="Cap" variant="default" revealIndex={1}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
            <StatTile value={formatMoney(cap)} label="Cap this season" />
            <StatTile
              value={formatMoney(capSpace)}
              label="Cap space"
              tone={capSpace < 0 ? 'danger' : 'default'}
            />
          </div>
        </Panel>
        <div style={{ height: 'var(--sp-4)' }} />
        <Panel
          title={`Alerts${alerts.length > 0 ? ` (${alerts.length})` : ''}`}
          variant={alerts.length > 0 ? 'attention' : 'default'}
          revealIndex={2}
        >
          {alerts.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No alerts.</p>
          ) : (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--sp-2)',
              }}
            >
              {alerts.map((a, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="gg-nameplate"
                    style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
                    onClick={() => onNavigate?.(a.screen)}
                  >
                    <span style={{ fontWeight: 600 }}>{a.text}</span>
                    <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
                      {a.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
