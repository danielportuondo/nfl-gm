import type { Game, LeagueState, StaticData } from '@contracts/index'
import { Button, Meter, Panel, StatTile } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'
import { isExpiring } from '@screens/shared/contractStatus'
import { departedNames } from '@screens/shared/departures'
import { formatMoney } from '@screens/shared/formatMoney'
import { horizonProgress, isOffseasonPhase } from '@screens/shared/phaseLabel'
import { injuredWeeksLabel } from '@screens/shared/playerStatus'
import { teamLabel } from '@screens/shared/teamLabel'
import type { ScreenId } from '@store/router'
import { noGameNote } from '../shared/scheduleNotes'

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
  /** AI trade offers waiting for an answer; shown as an alert that leads to the Trades screen. */
  tradeOfferCount?: number
  /** Players with no real season left; they are not counted as contracts to re-sign. */
  isLeavingFootball?: (playerId: string) => boolean
}

interface Alert {
  text: string
  detail: string
  screen: ScreenId
}

function nextGame(state: LeagueState): Game | undefined {
  // Only meaningful in season: outside REGULAR/PLAYOFFS this would otherwise surface last season's
  // schedule (its games all have results, but the phase transition can leave `week` low again) —
  // e.g. a finished Super Bowl reads as "next" all offseason (docs/HANDOFF.md QA sweep item 10).
  if (state.phase !== 'REGULAR' && state.phase !== 'PLAYOFFS') return undefined
  const played = new Set(state.results.map((r) => r.gameId))
  const upcoming = state.schedule
    .filter(
      (g) =>
        g.season === state.season &&
        (g.home === state.userTeam || g.away === state.userTeam) &&
        g.week >= state.week &&
        !played.has(g.id),
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
  tradeOfferCount = 0,
  isLeavingFootball,
}: DashboardProps) {
  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]
  const record = team?.record ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
  const recordText =
    record.ties > 0
      ? `${record.wins}-${record.losses}-${record.ties}`
      : `${record.wins}-${record.losses}`
  const upcoming = nextGame(state)
  const offWeekNote =
    state.phase === 'REGULAR'
      ? noGameNote(state.schedule, state.season, state.userTeam, state.week)
      : null
  const opponentId = upcoming
    ? upcoming.home === state.userTeam
      ? upcoming.away
      : upcoming.home
    : null
  const opponentInfo = opponentId ? data.teams[opponentId] : null

  const { index: seasonIndex, total: horizonTotal } = horizonProgress(state)

  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const capSpace = cap - payroll - (team?.deadMoney ?? 0)

  const inSeason = state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
  const draftPending = state.phase === 'DRAFT' && state.draftRoom?.status !== 'COMPLETE'
  const advanceLabel = ADVANCE_LABEL[state.phase]

  const alerts: Alert[] = []
  if (draftPending) {
    const year = state.draftRoom?.season ?? state.season + 1
    alerts.push(
      state.draftRoom
        ? {
            text: `The ${year} draft is under way.`,
            detail: 'Finish it in the Draft room.',
            screen: 'draft',
          }
        : {
            text: `The ${year} draft is waiting.`,
            detail: 'Start it in the Draft room.',
            screen: 'draft',
          },
    )
  }

  const injuredSlots = (team?.roster ?? []).filter((slot) => slot.injured)
  const expiring = (team?.roster ?? []).filter(
    (slot) => isExpiring(state, slot.contract) && !isLeavingFootball?.(slot.playerId),
  ).length
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
  const departed = state.phase === 'PRESEASON' ? departedNames(state, state.season - 1) : []
  if (departed.length > 0) {
    alerts.push({
      text: `${departed.length} player${departed.length === 1 ? '' : 's'} left the league.`,
      detail: departed.join(', '),
      screen: 'roster',
    })
  }
  if (tradeOfferCount > 0) {
    alerts.unshift({
      text: `${tradeOfferCount} trade offer${tradeOfferCount === 1 ? '' : 's'} waiting.`,
      detail: 'Answer them in Trades.',
      screen: 'trade',
    })
  }
  if (expiring > 0) {
    alerts.push({
      text: `${expiring} contract${expiring === 1 ? '' : 's'} ${
        isOffseasonPhase(state.phase)
          ? `ending before the ${state.season + 1} season`
          : 'expiring after this season'
      }.`,
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
            {teamLabel(data, state.userTeam, state.season).full} ·{' '}
            <span className="tabular-nums">{recordText}</span>
          </p>
          {offWeekNote && (
            <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--text-2)' }}>
              Week {state.week}: {offWeekNote}
            </p>
          )}
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
              <span>{teamLabel(data, opponentId!, state.season).full}</span>
            </div>
          )}
          <Meter
            value={(seasonIndex - 1) / horizonTotal}
            label={`Season ${seasonIndex} of ${horizonTotal}`}
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
