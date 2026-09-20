import { useState } from 'react'
import {
  TEAM_IDS,
  type GameSettings,
  type SaveSlotMeta,
  type StaticData,
  type TeamId,
  type TeamInfo,
} from '@contracts/index'
import { Button, Modal, Panel } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'
import type { NewGameInput } from '@store/types'
import { GameSettingsFields } from '../shared/GameSettingsFields'
import { phaseLabel } from '../shared/phaseLabel'
import { useSaveFilePicker } from '../shared/useSaveFilePicker'

export interface NewGameProps {
  data: StaticData
  onStart: (input: NewGameInput) => void
  /** The 'default' save slot's metadata, when one exists (docs/DECISIONS.md Phase 5 follow-up). */
  savedGame?: SaveSlotMeta | null
  onContinue?: () => void
  /** True while a game is being built or restored; Start and Continue wait for it. */
  busy?: boolean
  /** Imports an exported save file (Settings' "Save file" panel writes the files this reads). */
  onImportSave?: (json: string) => void
}

const MIN_START_SEASON = 2010
const HORIZON_MIN = 1
const HORIZON_MAX = 10
const DEFAULT_TEAM: TeamId = 'IND'
const CONFERENCES = ['AFC', 'NFC'] as const
const DIVISIONS = ['East', 'North', 'South', 'West'] as const

function yearRange(latest: number): number[] {
  const years: number[] = []
  for (let y = MIN_START_SEASON; y <= latest; y++) years.push(y)
  return years
}

/** The wall is ordered the way a war-room board is: conference, then division, then city. */
function divisionGroups(teams: StaticData['teams']): { label: string; teams: TeamInfo[] }[] {
  const groups: { label: string; teams: TeamInfo[] }[] = []
  for (const conf of CONFERENCES) {
    for (const div of DIVISIONS) {
      const members = TEAM_IDS.map((id) => teams[id])
        .filter((t): t is TeamInfo => t !== undefined && t.conf === conf && t.div === div)
        .sort((a, b) => a.city.localeCompare(b.city))
      groups.push({ label: `${conf} ${div}`, teams: members })
    }
  }
  return groups
}

const DEFAULT_SETTINGS: GameSettings = {
  tradeStrictness: 'balanced',
  aiOfferFrequency: 'normal',
  injuries: true,
}

/**
 * The mandate plate leads and re-dresses in the chosen team's colors; below it, year → team → horizon
 * as a single column of panels, the team step a helmet wall by division (docs/DESIGN.md §11).
 */
export function NewGame({
  data,
  onStart,
  savedGame,
  onContinue,
  busy,
  onImportSave,
}: NewGameProps) {
  const years = yearRange(data.manifest.latestRealSeason)
  const [startSeason, setStartSeason] = useState<number>(data.manifest.latestRealSeason)
  const [userTeam, setUserTeam] = useState<TeamId>(DEFAULT_TEAM)
  const [horizonSeasons, setHorizonSeasons] = useState(3)
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS)
  const [pendingImport, setPendingImport] = useState<string | null>(null)

  function handleFile(json: string) {
    if (savedGame) setPendingImport(json)
    else onImportSave?.(json)
  }
  const picker = useSaveFilePicker(handleFile)

  function confirmImport() {
    const json = pendingImport
    setPendingImport(null)
    if (json !== null) onImportSave?.(json)
  }

  const team = data.teams[userTeam]
  const endYear = startSeason + horizonSeasons - 1
  const seasonsWord = horizonSeasons === 1 ? 'season' : 'seasons'
  const savedTeam = savedGame ? data.teams[savedGame.userTeam] : undefined
  const showContinue = Boolean(savedGame && onContinue)
  const showImportPanel = !savedGame
  const base = showContinue || showImportPanel ? 1 : 0
  const groups = divisionGroups(data.teams)

  return (
    <>
      <input {...picker.inputProps} />

      {savedGame && onContinue && (
        <div className="gg-col-12">
          <Panel variant="attention" revealIndex={0}>
            <div className="gg-continue">
              <p style={{ margin: 0 }}>
                Continue as the {savedTeam?.name ?? savedGame.userTeam}: {savedGame.season},{' '}
                {phaseLabel(savedGame.phase)}.
              </p>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button
                  type="button"
                  variant="primary"
                  busy={busy}
                  busyLabel="Loading…"
                  onClick={onContinue}
                >
                  Continue
                </Button>
                <Button type="button" variant="ghost" onClick={picker.open}>
                  Import a save file
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {showImportPanel && (
        <div className="gg-col-12">
          <Panel title="Have a save file?" revealIndex={0}>
            <p className="gg-field__hint">Import a game exported from Settings.</p>
            <Button type="button" variant="ghost" onClick={picker.open}>
              Import a save file
            </Button>
          </Panel>
        </div>
      )}

      {team && (
        <div className="gg-col-12">
          <TeamScope colors={team.colors}>
            <Panel variant="plate" revealIndex={base}>
              <div className="gg-mandate">
                <HelmetSprite pos="QB" size={6} />
                <div className="gg-mandate__text">
                  <h2 className="gg-mandate__team">
                    {team.city} {team.name}, {startSeason}
                  </h2>
                  <p className="gg-mandate__lead">
                    Your mandate: win the Super Bowl by {endYear}. That's {horizonSeasons}{' '}
                    {seasonsWord}.
                  </p>
                  <p className="gg-mandate__note">
                    You take over the roster as it stood at the start of {startSeason}. Every rating
                    is what scouts believed then. You may know better.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    busy={busy}
                    busyLabel="Starting…"
                    onClick={() => onStart({ startSeason, userTeam, horizonSeasons, settings })}
                  >
                    Start
                  </Button>
                </div>
              </div>
            </Panel>
          </TeamScope>
        </div>
      )}

      <div className="gg-col-12">
        <Panel title="Pick your start year" variant="sunken" revealIndex={base + 1}>
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
        <Panel title="Pick your team" variant="sunken" revealIndex={base + 2}>
          <div className="gg-team-wall" role="group" aria-label="Teams by division">
            {groups.map((group) => (
              <section key={group.label} className="gg-team-wall__division">
                <h4 className="gg-team-wall__label">{group.label}</h4>
                <div className="gg-team-wall__tiles">
                  {group.teams.map((t) => (
                    <TeamScope key={t.id} colors={t.colors}>
                      <button
                        type="button"
                        className="gg-team-tile"
                        aria-pressed={t.id === userTeam}
                        aria-label={`${t.city} ${t.name}`}
                        onClick={() => setUserTeam(t.id)}
                      >
                        <HelmetSprite pos="QB" size={4} />
                        <span className="gg-team-tile__name">{t.name}</span>
                      </button>
                    </TeamScope>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Set your horizon" variant="sunken" revealIndex={base + 3}>
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

            <GameSettingsFields
              value={settings}
              onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            />
          </div>
        </Panel>
      </div>

      {pendingImport !== null && (
        <Modal
          title="Replace saved game?"
          onClose={() => setPendingImport(null)}
          footer={
            <>
              <Button type="button" variant="ghost" onClick={() => setPendingImport(null)}>
                Keep saved game
              </Button>
              <Button type="button" variant="danger" onClick={confirmImport}>
                Replace
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Importing replaces the saved game and its autosave. Export first if you want to keep it.
          </p>
        </Modal>
      )}
    </>
  )
}
