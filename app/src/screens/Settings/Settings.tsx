import { useState } from 'react'
import type { GameSettings, LeagueState, StaticData } from '@contracts/index'
import type { Theme } from '@ui/frame'
import { Button, Modal, Panel } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'
import { GameSettingsFields } from '../shared/GameSettingsFields'
import { phaseLabel } from '../shared/phaseLabel'

export interface SettingsProps {
  state: LeagueState
  data: StaticData
  theme: Theme
  onSetTheme: (theme: Theme) => void
  onUpdateSettings: (patch: Partial<GameSettings>) => void
  onStartOver: () => void
}

const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
]

const FALLBACK_COLORS = { primary: '#1F4334', secondary: '#F3ECD2' }

/**
 * Appearance and game settings as two quiet panels, then the run plate: the same team-colored
 * composition you started from on New Game, now the place you leave from (docs/DESIGN.md §11).
 */
export function Settings({
  state,
  data,
  theme,
  onSetTheme,
  onUpdateSettings,
  onStartOver,
}: SettingsProps) {
  const [confirming, setConfirming] = useState(false)
  const team = data.teams[state.userTeam]
  const teamName = team ? `${team.city} ${team.name}` : state.userTeam
  const total = Math.max(1, state.horizonEnd - state.startSeason + 1)
  const index = Math.min(total, Math.max(1, state.season - state.startSeason + 1))
  const inSeason = state.phase === 'REGULAR' || state.phase === 'PLAYOFFS'
  const where =
    inSeason && state.week > 0
      ? `${phaseLabel(state.phase)}, week ${state.week}`
      : phaseLabel(state.phase)

  function confirmStartOver() {
    setConfirming(false)
    onStartOver()
  }

  return (
    <>
      <div className="gg-col-6">
        <Panel title="Appearance" revealIndex={0}>
          <div className="gg-field">
            <span className="gg-field__label" id="gg-setting-theme-label">
              Theme
            </span>
            <div className="gg-choice" role="group" aria-labelledby="gg-setting-theme-label">
              {THEMES.map((t) => (
                <Button
                  key={t.id}
                  type="button"
                  variant={t.id === theme ? 'primary' : 'secondary'}
                  aria-pressed={t.id === theme}
                  onClick={() => onSetTheme(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
          <p className="gg-field__hint">System follows your device.</p>
        </Panel>
      </div>

      <div className="gg-col-6">
        <Panel title="This game" revealIndex={1}>
          <div className="gg-fields">
            <GameSettingsFields value={state.settings} onChange={onUpdateSettings} />
          </div>
          <p className="gg-field__hint">Changes apply from the next trade, offer or sim.</p>
        </Panel>
      </div>

      <div className="gg-col-12">
        <TeamScope colors={team?.colors ?? FALLBACK_COLORS}>
          <Panel variant="plate" revealIndex={2}>
            <div className="gg-mandate">
              <HelmetSprite pos="QB" size={4} />
              <div className="gg-mandate__text">
                <h2 className="gg-mandate__team">
                  {teamName}, {state.season}
                </h2>
                <p className="gg-mandate__lead">
                  Season {index} of {total}, {where}.
                </p>
                <p className="gg-mandate__note">
                  Start over to pick a new team or year. Your saved game stays until you start a new
                  one.
                </p>
                <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
                  Start over
                </Button>
              </div>
            </div>
          </Panel>
        </TeamScope>
      </div>

      {confirming && (
        <Modal
          title="Start over?"
          onClose={() => setConfirming(false)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                Keep playing
              </Button>
              <Button type="button" variant="danger" onClick={confirmStartOver}>
                Start over
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This leaves the {team?.name ?? state.userTeam} and returns to the New Game screen. Your
            saved game stays until you start a new one.
          </p>
        </Modal>
      )}
    </>
  )
}
