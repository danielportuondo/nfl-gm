import type { LeagueState, StaticData } from '@contracts/index'
import { Button, Panel, StatTile } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'

export interface EndGameProps {
  state: LeagueState
  data: StaticData
  /** This season's cap in $M, from the store. */
  cap: number
  /** Only offered when the horizon expired without a title — a championship ends the mandate. */
  onKeepPlaying?: () => void
}

function formatMoney(m: number): string {
  return `$${m.toFixed(1)}M`
}

/** Super Bowl win or horizon expiry: celebration/verdict + GM report card (docs/DESIGN.md §11). */
export function EndGame({ state, data, cap, onKeepPlaying }: EndGameProps) {
  const champion = state.outcome === 'CHAMPION'
  const team = state.teams[state.userTeam]
  const teamInfo = data.teams[state.userTeam]

  const seasonLines = state.history.map((h) => ({
    season: h.season,
    record: `${h.userRecord.wins}-${h.userRecord.losses}-${h.userRecord.ties}`,
    exit: h.userPlayoffExit,
  }))
  const titles = state.history.filter((h) => h.champion === state.userTeam).length

  const roster = team?.roster ?? []
  const avgAge = roster.length
    ? roster.reduce(
        (sum, s) => sum + (state.season - (state.players[s.playerId]?.birthYear ?? state.season)),
        0,
      ) / roster.length
    : 0
  const avgOvr = roster.length
    ? roster.reduce((sum, s) => sum + (state.scouting[s.playerId]?.ovr ?? 0), 0) / roster.length
    : 0
  const payroll = roster.reduce((sum, s) => sum + s.contract.apy, 0) + (team?.deadMoney ?? 0)
  const capSpace = cap - payroll
  const futurePicks = state.picks.filter(
    (p) => p.owner === state.userTeam && p.playerId === null,
  ).length

  return (
    <TeamScope
      colors={teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' }}
      as="div"
      style={{ display: 'contents' }}
    >
      <div className="gg-col-12">
        <Panel variant="attention" revealIndex={0} className="gg-yardlines">
          <div style={{ textAlign: 'center' }}>
            {teamInfo && (
              <div
                style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--sp-3)' }}
              >
                <TeamScope colors={teamInfo.colors}>
                  <HelmetSprite pos="QB" size={6} />
                </TeamScope>
              </div>
            )}
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--fd-5)',
                letterSpacing: 'var(--ls-display)',
                lineHeight: 'var(--lh-display)',
              }}
            >
              {champion ? `${teamInfo?.city ?? state.userTeam} champions` : 'Horizon reached'}
            </p>
            <p style={{ margin: 'var(--sp-2) 0 0', color: 'var(--text-2)' }}>
              {champion
                ? `Your mandate: win the Super Bowl by ${state.horizonEnd}. Done, in ${state.season}.`
                : `Your mandate was to win the Super Bowl by ${state.horizonEnd}. The window has closed.`}
            </p>
          </div>
        </Panel>
      </div>

      <div className="gg-col-8">
        <Panel title="GM report card" revealIndex={1}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            <StatTile value={titles} label="Titles won" />
            <StatTile
              value={formatMoney(capSpace)}
              label="Cap space"
              tone={capSpace < 0 ? 'danger' : 'default'}
            />
            <StatTile value={avgOvr.toFixed(1)} label="Roster consensus overall" />
            <StatTile value={avgAge.toFixed(1)} label="Roster average age" />
            <StatTile value={futurePicks} label="Draft picks owned" />
          </div>
        </Panel>

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Season by season" variant="sunken" revealIndex={2}>
          {seasonLines.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No seasons completed.</p>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {seasonLines.map((s) => (
                <li key={s.season} className="tabular-nums">
                  {s.season}: {s.record} · {s.exit}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="What's next" revealIndex={3}>
          {champion ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>
              The mandate is fulfilled. Thanks for playing.
            </p>
          ) : onKeepPlaying ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <p style={{ margin: 0, color: 'var(--text-2)' }}>
                You can keep running this front office with no horizon.
              </p>
              <Button type="button" variant="primary" onClick={onKeepPlaying}>
                Keep playing
              </Button>
            </div>
          ) : null}
        </Panel>
      </div>
    </TeamScope>
  )
}
