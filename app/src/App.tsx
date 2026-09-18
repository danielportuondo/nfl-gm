import { useGameStore } from '@store/index'
import type { NavItem } from '@ui/frame'
import { AppFrame } from '@ui/frame'
import { Button } from '@ui/primitives'
import { About } from '@screens/About'
import { Dashboard } from '@screens/Dashboard'
import { NewGame } from '@screens/NewGame'
import { PlayerCard } from '@screens/PlayerCard'
import { Roster } from '@screens/Roster'

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'roster', label: 'Roster' },
  { id: 'about', label: 'About' },
]

function formatPhase(phase: string): string {
  const lower = phase.replace(/_/g, ' ').toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function App() {
  const { state, data, dataStatus, dataError, screen, selectedPlayerId, theme, toasts, actions } = useGameStore()

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
  const cap = data.cap.bySeason[String(state.season)] ?? 0
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const horizonTotal = Math.max(1, state.horizonEnd - state.startSeason + 1)
  const horizonElapsed = Math.min(horizonTotal, Math.max(0, state.season - state.startSeason))

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
        end: (
          <Button type="button" variant="ghost" onClick={() => actions.setTheme(theme === 'light' ? 'dark' : 'light')}>
            {theme === 'light' ? 'Dark theme' : 'Light theme'}
          </Button>
        ),
      }}
      navItems={NAV_ITEMS}
      currentScreen={screen === 'player' ? 'roster' : screen === 'new-game' ? 'dashboard' : screen}
      onSelectScreen={(id) => actions.goTo(id as 'dashboard' | 'roster' | 'about')}
      toasts={toasts}
      onDismissToast={actions.dismissToast}
    >
      {screen === 'roster' && (
        <Roster state={state} data={data} onSelectPlayer={actions.selectPlayer} onReorderDepthChart={actions.setDepthChart} />
      )}
      {screen === 'player' && selectedPlayerId && (
        <PlayerCard state={state} data={data} playerId={selectedPlayerId} onBack={() => actions.goTo('roster')} />
      )}
      {screen === 'about' && <About />}
      {(screen === 'dashboard' || screen === 'new-game') && (
        <Dashboard state={state} data={data} onSimWeek={actions.simWeek} onAdvancePhase={actions.advancePhase} />
      )}
    </AppFrame>
  )
}
