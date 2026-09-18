import type { LeagueState, PlayerId, StaticData, TeamId } from '@contracts/index'
import { Button, Meter, Panel, PositionBadge, StatusBadge, TeamBadge as TeamBadgePrimitive } from '@ui/primitives'
import { BustSprite, TeamScope } from '@ui/sprites'
import { injuredWeeksLabel, isRookie } from '@screens/shared/playerStatus'

export interface PlayerCardProps {
  state: LeagueState
  data: StaticData
  playerId: PlayerId
  onBack: () => void
}

function findTeam(state: LeagueState, playerId: PlayerId): TeamId | null {
  for (const team of Object.values(state.teams)) {
    if (team.roster.some((slot) => slot.playerId === playerId)) return team.id
  }
  return null
}

/** Consensus ratings only — nothing on this screen is derived from state.truth (docs/DESIGN.md §11). */
export function PlayerCard({ state, data, playerId, onBack }: PlayerCardProps) {
  const player = state.players[playerId]
  const scouting = state.scouting[playerId]

  if (!player || !scouting) {
    return (
      <div className="gg-col-12">
        <Panel title="Player not found" revealIndex={0}>
          <Button type="button" variant="secondary" onClick={onBack}>
            Back to roster
          </Button>
        </Panel>
      </div>
    )
  }

  const teamId = findTeam(state, playerId)
  const team = teamId ? state.teams[teamId] : null
  const teamInfo = teamId ? data.teams[teamId] : null
  const slot = team?.roster.find((r) => r.playerId === playerId)
  const isFreeAgent = !team
  const age = state.season - player.birthYear

  const sprite = <BustSprite pos={player.pos} size={4} status={{ freeAgent: isFreeAgent }} />

  const results = state.results.filter((r) => r.box?.home.some((l) => l.playerId === playerId) || r.box?.away.some((l) => l.playerId === playerId))

  return (
    <>
      <div className="gg-col-4">
        <Panel revealIndex={0}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-3)' }}>
            {teamInfo ? <TeamScope colors={teamInfo.colors}>{sprite}</TeamScope> : sprite}
            <h2 style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--fs-3)', margin: 0, textAlign: 'center' }}>{player.name}</h2>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <PositionBadge pos={player.pos} />
              {teamInfo && (
                <TeamScope colors={teamInfo.colors}>
                  <TeamBadgePrimitive abbr={teamInfo.abbr} />
                </TeamScope>
              )}
              {isRookie(player, state) && <StatusBadge status="rookie" />}
              {slot?.injured && <StatusBadge status="injured" />}
              {slot?.injured && <span style={{ color: 'var(--text-2)' }}>{injuredWeeksLabel(slot.injured)}</span>}
            </div>
            <p style={{ margin: 0, color: 'var(--text-2)' }}>Age {age}</p>
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
          </div>
        </Panel>
      </div>

      <div className="gg-col-8">
        <Panel title="Consensus" revealIndex={1}>
          <div style={{ display: 'flex', gap: 'var(--sp-6)', marginBottom: 'var(--sp-4)' }}>
            <div>
              <div className="tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-4)' }}>
                {scouting.ovr}
              </div>
              <div style={{ color: 'var(--text-2)' }}>Overall</div>
            </div>
            <div>
              <div className="tabular-nums" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-4)' }}>
                {scouting.pot}
              </div>
              <div style={{ color: 'var(--text-2)' }}>Potential</div>
            </div>
          </div>
          <Meter value={scouting.confidence} label="Scouting confidence" />
        </Panel>

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Contract" variant="sunken" revealIndex={2}>
          {slot ? (
            <p style={{ margin: 0 }}>
              {slot.contract.years} year{slot.contract.years === 1 ? '' : 's'} left · ${slot.contract.apy.toFixed(1)}M / year ·{' '}
              {Math.round(slot.contract.guaranteedPct * 100)}% guaranteed
            </p>
          ) : (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>Not signed to a roster.</p>
          )}
        </Panel>

        <div style={{ height: 'var(--sp-4)' }} />

        <Panel title="Season by season" variant="sunken" revealIndex={3}>
          {results.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No stats yet. Sim a week to see results here.</p>
          ) : (
            <p style={{ margin: 0 }}>{results.length} games played.</p>
          )}
        </Panel>
      </div>
    </>
  )
}
