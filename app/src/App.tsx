import { useGameStore } from '@store/index'
import type { NavItem } from '@ui/frame'
import { AppFrame } from '@ui/frame'
import { Button } from '@ui/primitives'
import { About } from '@screens/About'
import { Dashboard } from '@screens/Dashboard'
import { DraftRoom } from '@screens/DraftRoom'
import { FreeAgency } from '@screens/FreeAgency'
import { LeagueBrowser } from '@screens/LeagueBrowser'
import { NewGame } from '@screens/NewGame'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'
import { Schedule } from '@screens/Schedule'
import { Standings } from '@screens/Standings'
import { TradeCenter } from '@screens/TradeCenter'

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'roster', label: 'Roster' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'standings', label: 'Standings' },
  { id: 'draft', label: 'Draft' },
  { id: 'trade', label: 'Trades' },
  { id: 'free-agency', label: 'Free agency' },
  { id: 'league', label: 'League' },
  { id: 'about', label: 'About' },
]

function formatPhase(phase: string): string {
  if (phase === 'UDFA') return 'UDFA'
  const lower = phase.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function App() {
  const { state, data, dataStatus, dataError, screen, selectedPlayerId, theme, toasts, alerts, tradeOffers, busy, actions } = useGameStore()
  void alerts // surfaced by a future Dashboard pass; kept in the store per docs/HANDOFF.md Phase 3E follow-up.

  if (!state || !data) {
    return (
      <div className="gg-board">
        <div className="gg-col-12" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-3)' }}>Gridiron GM</h1>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button type="button" variant="ghost" onClick={() => actions.goTo('about')}>
              About
            </Button>
            <Button type="button" variant="ghost" onClick={() => actions.setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? 'Dark theme' : 'Light theme'}
            </Button>
          </div>
        </div>
        {screen === 'about' ? (
          <About />
        ) : data ? (
          <NewGame data={data} onStart={actions.newGame} />
        ) : dataStatus === 'error' ? (
          <p className="gg-col-12" role="alert">
            Could not load league data. {dataError}
          </p>
        ) : (
          <p className="gg-col-12" aria-live="polite">
            Loading league data…
          </p>
        )}
      </div>
    )
  }

  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]
  const record = team?.record ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }
  const cap = actions.capThisSeason() ?? data.cap.bySeason[String(state.season)] ?? 0
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0) + (team?.deadMoney ?? 0)
  const horizonTotal = Math.max(1, state.horizonEnd - state.startSeason + 1)
  const horizonElapsed = Math.min(horizonTotal, Math.max(0, state.season - state.startSeason))

  const room = state.draftRoom
  const onClock = Boolean(
    state.phase === 'DRAFT' && room?.status === 'ON_CLOCK' && room.order[room.currentPickIndex]?.owner === state.userTeam,
  )

  return (
    <AppFrame
      strip={{
        teamAbbr: teamInfo?.abbr ?? state.userTeam,
        teamColors: teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' },
        season: state.season,
        week: state.week,
        phaseLabel: formatPhase(state.phase),
        record: record.ties > 0 ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`,
        capSpaceText: `$${(cap - payroll).toFixed(1)}M free`,
        horizonText: `${horizonElapsed + 1}/${horizonTotal} seasons`,
        onClock,
        end: (
          <Button type="button" variant="ghost" onClick={() => actions.setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </Button>
        ),
      }}
      navItems={NAV_ITEMS}
      currentScreen={screen === 'player' ? 'roster' : screen === 'new-game' ? 'dashboard' : screen}
      onSelectScreen={(id) => actions.goTo(id as Parameters<typeof actions.goTo>[0])}
      toasts={toasts}
      onDismissToast={actions.dismissToast}
    >
      {screen === 'roster' && (
        <Roster
          state={state}
          data={data}
          onSelectPlayer={actions.selectPlayer}
          onReorderDepthChart={actions.setDepthChart}
          onRelease={actions.release}
          releaseBusy={busy.fa}
        />
      )}
      {screen === 'player' && selectedPlayerId && (
        <PlayerCard state={state} data={data} playerId={selectedPlayerId} onBack={() => actions.goTo('roster')} />
      )}
      {screen === 'about' && <About />}
      {(screen === 'dashboard' || screen === 'new-game') && (
        <Dashboard
          state={state}
          data={data}
          cap={cap}
          onSimWeek={actions.simWeek}
          onAdvancePhase={actions.advancePhase}
          simBusy={busy.simWeek}
          advanceBusy={busy.advancePhase}
        />
      )}
      {screen === 'draft' && (
        <DraftRoom
          state={state}
          data={data}
          busy={busy.draft}
          onStartDraft={actions.startDraft}
          onMakePick={actions.makePick}
          onAutoPick={actions.autoPick}
          onSimToMyPick={actions.simToMyPick}
          onFinishDraft={actions.finishDraft}
          onRespondToOffer={actions.respondToOffer}
          onEvaluate={actions.evaluateTrade}
          onTeamNeeds={actions.teamNeeds}
        />
      )}
      {screen === 'trade' && (
        <TradeCenter
          state={state}
          data={data}
          tradeOffers={tradeOffers}
          busy={busy.trade}
          onEvaluate={actions.evaluateTrade}
          onProposeTrade={actions.proposeTrade}
          onRespondToOffer={actions.respondToOffer}
          onRefreshOffers={actions.refreshTradeOffers}
        />
      )}
      {screen === 'free-agency' && (
        <FreeAgency
          state={state}
          cap={cap}
          busy={busy.fa}
          onOfferContract={actions.offerContract}
          onResign={actions.resign}
          onRelease={actions.release}
          onSignUdfa={actions.signUdfa}
          onResignAsk={actions.resignAsk}
        />
      )}
      {screen === 'schedule' && (
        <Schedule
          state={state}
          data={data}
          busy={{ simWeek: busy.simWeek, simToNextEvent: busy.simToNextEvent, simSeason: busy.simSeason }}
          onSimWeek={actions.simWeek}
          onSimToNextEvent={actions.simToNextEvent}
          onSimSeason={actions.simSeason}
        />
      )}
      {screen === 'standings' && <Standings data={data} rows={actions.standings()} />}
      {screen === 'league' && <LeagueBrowser state={state} data={data} onSelectPlayer={actions.selectPlayer} />}
    </AppFrame>
  )
}
