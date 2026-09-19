import { useState } from 'react'
import {
  TEAM_IDS,
  type GameSettings,
  type SaveSlotMeta,
  type StaticData,
  type TeamId,
} from '@contracts/index'
import { Button, Panel, TeamBadge } from '@ui/primitives'
import { TeamScope } from '@ui/sprites'
import type { NewGameInput } from '@store/types'

export interface NewGameProps {
  data: StaticData
  onStart: (input: NewGameInput) => void
  /** The 'default' save slot's metadata, when one exists (docs/DECISIONS.md Phase 5 follow-up). */
  savedGame?: SaveSlotMeta | null
  onContinue?: () => void
  continueBusy?: boolean
}

const MIN_START_SEASON = 2010
const HORIZON_MIN = 1
const HORIZON_MAX = 10

function yearRange(latest: number): number[] {
  const years: number[] = []
  for (let y = MIN_START_SEASON; y <= latest; y++) years.push(y)
  return years
}

const DEFAULT_SETTINGS: GameSettings = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
}

/** Year → team → horizon + settings, as a single column of panels, then "Your mandate" (docs/DESIGN.md §11). */
export function NewGame({ data, onStart, savedGame, onContinue, continueBusy }: NewGameProps) {
  const years = yearRange(data.manifest.latestRealSeason)
  const [startSeason, setStartSeason] = useState<number>(data.manifest.latestRealSeason)
  const [userTeam, setUserTeam] = useState<TeamId>(TEAM_IDS[13]) // IND — a reasonable, always-valid default
  const [horizonSeasons, setHorizonSeasons] = useState(3)
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS)

  const team = data.teams[userTeam]
  const endYear = startSeason + horizonSeasons - 1
  const seasonsWord = horizonSeasons === 1 ? 'season' : 'seasons'
  const showContinue = Boolean(savedGame && onContinue)
  const base = showContinue ? 1 : 0

  return (
    <>
      {savedGame && onContinue && (
        <div className="gg-col-12">
          <Panel variant="attention" revealIndex={0}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'var(--sp-3)',
              }}
            >
              <p style={{ margin: 0 }}>
                Continue as {savedGame.userTeam}, {savedGame.season} ·{' '}
                {savedGame.phase.replace(/_/g, ' ').toLowerCase()}.
              </p>
              <Button
                type="button"
                variant="primary"
                busy={continueBusy}
                busyLabel="Loading…"
                onClick={onContinue}
              >
                Continue
              </Button>
            </div>
          </Panel>
        </div>
      )}

      <div className="gg-col-12">
        <Panel title="Pick your start year" variant="sunken" revealIndex={base}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
            {years.map((y) => (
              <Button
                key={y}
                type="button"
                variant={y === startSeason ? 'primary' : 'secondary'}
                aria-pressed={y === startSeason}
                onClick={() => setStartSeason(y)}
              >
                {y}
              </Button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Pick your team" variant="sunken" revealIndex={base + 1}>
          <div
            role="grid"
            aria-label="Teams"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 'var(--sp-2)',
            }}
          >
            {TEAM_IDS.map((id) => {
              const info = data.teams[id]
              if (!info) return null
              return (
                <TeamScope key={id} colors={info.colors}>
                  <button
                    type="button"
                    className="gg-nameplate"
                    aria-selected={id === userTeam}
                    aria-label={`${info.city} ${info.name}`}
                    onClick={() => setUserTeam(id)}
                    style={{
                      flexDirection: 'column',
                      gap: 'var(--sp-1)',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                      width: '100%',
                    }}
                  >
                    <TeamBadge abbr={info.abbr} />
                    <span className="gg-nameplate__name" style={{ width: '100%' }}>
                      {info.city} {info.name}
                    </span>
                  </button>
                </TeamScope>
              )
            })}
          </div>
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Set your horizon" variant="sunken" revealIndex={base + 2}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-5)',
              alignItems: 'flex-end',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              Seasons to win it in
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="Fewer seasons"
                  disabled={horizonSeasons <= HORIZON_MIN}
                  onClick={() => setHorizonSeasons((h) => Math.max(HORIZON_MIN, h - 1))}
                >
                  −
                </Button>
                <span
                  className="tabular-nums"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fd-3)',
                    minWidth: '2ch',
                    textAlign: 'center',
                  }}
                >
                  {horizonSeasons}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label="More seasons"
                  disabled={horizonSeasons >= HORIZON_MAX}
                  onClick={() => setHorizonSeasons((h) => Math.min(HORIZON_MAX, h + 1))}
                >
                  +
                </Button>
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              Trade strictness
              <select
                value={settings.tradeStrictness}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    tradeStrictness: e.target.value as GameSettings['tradeStrictness'],
                  }))
                }
              >
                <option value="lenient">Lenient</option>
                <option value="balanced">Balanced</option>
                <option value="strict">Strict</option>
                <option value="ruthless">Ruthless</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
              AI offer frequency
              <select
                value={settings.aiOfferFrequency}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    aiOfferFrequency: e.target.value as GameSettings['aiOfferFrequency'],
                  }))
                }
              >
                <option value="rare">Rare</option>
                <option value="normal">Normal</option>
                <option value="aggressive">Aggressive</option>
              </select>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <input
                type="checkbox"
                checked={settings.injuries}
                onChange={(e) => setSettings((s) => ({ ...s, injuries: e.target.checked }))}
              />
              Injuries
            </label>
          </div>
        </Panel>
      </div>

      {team && (
        <div className="gg-col-12">
          <TeamScope colors={team.colors}>
            <Panel variant="plate" revealIndex={base + 3}>
              <p style={{ fontSize: 'var(--fs-3)', margin: '0 0 var(--sp-4)' }}>
                Your mandate: win the Super Bowl by {endYear}. That's {horizonSeasons} {seasonsWord}
                .
              </p>
              <Button
                type="button"
                variant="primary"
                onClick={() => onStart({ startSeason, userTeam, horizonSeasons, settings })}
              >
                Start
              </Button>
            </Panel>
          </TeamScope>
        </div>
      )}
    </>
  )
}
