import { useMemo, useState } from 'react'
import type { Game, GameType, LeagueState, PlayoffExit, SeasonSummary, StaticData } from '@contracts/index'
import { Panel, StatTile } from '@ui/primitives'
import { HelmetSprite, TeamScope } from '@ui/sprites'

export interface SeasonRecapProps {
  state: LeagueState
  data: StaticData
}

const EXIT_LABEL: Record<PlayoffExit, string> = {
  MISSED: 'Missed the playoffs',
  WC: 'Lost in the wild card round',
  DIV: 'Lost in the divisional round',
  CONF: 'Lost in the conference championship',
  SB_LOSS: 'Lost the Super Bowl',
  CHAMPION: 'Won the Super Bowl',
}

const ROUND_LABEL: Record<GameType, string> = { REG: 'Regular season', WC: 'Wild card', DIV: 'Divisional', CONF: 'Conference', SB: 'Super Bowl' }
const ROUND_ORDER: GameType[] = ['WC', 'DIV', 'CONF', 'SB']

function teamLabel(data: StaticData, teamId: string): string {
  return data.teams[teamId]?.abbr ?? teamId
}

/** Final standings, playoff bracket and awards for a completed season (docs/DESIGN.md §11). */
export function SeasonRecap({ state, data }: SeasonRecapProps) {
  const seasons = useMemo(() => state.history.map((h) => h.season).sort((a, b) => b - a), [state.history])
  const [season, setSeason] = useState<number | null>(seasons[0] ?? null)
  const summary: SeasonSummary | undefined = state.history.find((h) => h.season === season) ?? state.history[state.history.length - 1]

  if (!summary) {
    return (
      <div className="gg-col-12">
        <Panel title="Season recap" revealIndex={0}>
          <p style={{ margin: 0, color: 'var(--text-2)' }}>No season has finished yet. Play through the playoffs to see a recap here.</p>
        </Panel>
      </div>
    )
  }

  const teamInfo = data.teams[summary.userTeam]
  const bracketGames = state.schedule.filter((g) => g.season === summary.season && g.type !== 'REG')
  const rounds = ROUND_ORDER.map((type) => ({
    type,
    games: bracketGames.filter((g) => g.type === type).sort((a, b) => a.week - b.week),
  })).filter((r) => r.games.length > 0)

  function scoreFor(game: Game): string {
    const result = state.results.find((r) => r.gameId === game.id)
    if (!result) return 'Not played'
    return `${teamLabel(data, game.away)} ${result.awayScore} – ${result.homeScore} ${teamLabel(data, game.home)}${result.overtime ? ' OT' : ''}`
  }

  const sortedStandings = [...summary.standings].sort((a, b) => a.divRank - b.divRank || b.pct - a.pct)

  return (
    <TeamScope colors={teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' }} as="div" style={{ display: 'contents' }}>
      <div className="gg-col-12">
        <Panel
          title={`${summary.season} season recap`}
          revealIndex={0}
          action={
            seasons.length > 1 ? (
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                Season
                <select value={summary.season} onChange={(e) => setSeason(Number(e.target.value))}>
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
            {teamInfo && (
              <TeamScope colors={teamInfo.colors}>
                <HelmetSprite pos="QB" size={4} />
              </TeamScope>
            )}
            <div>
              <p style={{ margin: 0, fontSize: 'var(--fs-3)' }}>
                {teamInfo?.city} {teamInfo?.name} finished {summary.userRecord.wins}-{summary.userRecord.losses}-{summary.userRecord.ties}.
              </p>
              <p style={{ margin: 0, color: 'var(--text-2)' }}>{EXIT_LABEL[summary.userPlayoffExit]}</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-4)' }}>
            <StatTile value={summary.champion ? teamLabel(data, summary.champion) : '—'} label="Champion" />
            <StatTile value={summary.runnerUp ? teamLabel(data, summary.runnerUp) : '—'} label="Runner-up" />
          </div>
        </Panel>
      </div>

      <div className="gg-col-6">
        <Panel title="Final standings" variant="sunken" revealIndex={1}>
          <ol style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
            {sortedStandings.map((row) => (
              <li key={row.teamId} className="tabular-nums">
                {teamLabel(data, row.teamId)} — {row.wins}-{row.losses}-{row.ties}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div className="gg-col-6">
        <Panel title="Playoff bracket" variant="sunken" revealIndex={2}>
          {rounds.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No playoff games recorded for this season.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              {rounds.map((round) => (
                <div key={round.type} style={{ borderTop: 'var(--bw) solid var(--line)', paddingTop: 'var(--sp-2)' }}>
                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-1)', margin: '0 0 var(--sp-2)' }}>{ROUND_LABEL[round.type]}</h4>
                  <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
                    {round.games.map((g) => (
                      <li key={g.id} className="tabular-nums">
                        {scoreFor(g)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Awards" variant="sunken" revealIndex={3}>
          {summary.awards.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No awards recorded this season.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
              {summary.awards.map((a, i) => (
                <li key={i}>
                  {a.name}
                  {a.playerId ? `: ${state.players[a.playerId]?.name ?? a.playerId}` : ''}
                  {a.teamId ? ` (${teamLabel(data, a.teamId)})` : ''}
                  {a.note ? ` — ${a.note}` : ''}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </TeamScope>
  )
}
