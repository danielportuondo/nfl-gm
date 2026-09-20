import { useMemo, useState, useEffect } from 'react'
import {
  POSITIONS,
  TEAM_IDS,
  type DraftPick,
  type LeagueState,
  type PickRef,
  type Player,
  type PlayerId,
  type Position,
  type RosterSlot,
  type ScoutingView,
  type StaticData,
  type TeamId,
  type TradeEvaluation,
  type TradeProposal,
  type TradeSide,
} from '@contracts/index'
import { AcceptanceBar, Button, OfferCard, Panel, PositionBadge } from '@ui/primitives'
import { TeamScope } from '@ui/sprites'
import { describePick } from '../shared/pickLabel'

export interface TradeCenterProps {
  state: LeagueState
  data: StaticData
  tradeOffers: TradeProposal[]
  suggestedTrades: TradeProposal[]
  busy?: boolean
  onEvaluate: (proposal: TradeProposal) => TradeEvaluation
  onProposeTrade: (proposal: TradeProposal) => void
  onRespondToOffer: (proposal: TradeProposal, accept: boolean) => void
  onRefreshOffers: () => void
  onRefreshSuggestions: () => void
}

function pickKey(p: Pick<DraftPick, 'season' | 'round' | 'originalTeam' | 'pick'>): string {
  return `${p.season}-${p.round}-${p.originalTeam}-${p.pick ?? '?'}`
}

function toRef(p: DraftPick): PickRef {
  return { season: p.season, round: p.round, originalTeam: p.originalTeam, pick: p.pick }
}

function describeSide(state: LeagueState, data: StaticData, side: TradeSide): string {
  const parts: string[] = []
  for (const id of side.players) {
    const p = state.players[id]
    if (p) parts.push(p.name)
  }
  for (const pick of side.picks) {
    parts.push(describePick(data, pick))
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing'
}

function makeProposalId(): string {
  return `trade-${Math.random().toString(36).slice(2, 10)}`
}

interface AssetPickerProps {
  state: LeagueState
  teamId: TeamId
  selectedPlayers: Set<PlayerId>
  selectedPicks: Set<string>
  onTogglePlayer: (id: PlayerId) => void
  onTogglePick: (key: string) => void
}

const ASSET_SORTS = [
  { key: 'ovr', label: 'Overall' },
  { key: 'name', label: 'Name' },
  { key: 'age', label: 'Age' },
] as const

function AssetPicker({
  state,
  teamId,
  selectedPlayers,
  selectedPicks,
  onTogglePlayer,
  onTogglePick,
}: AssetPickerProps) {
  const team = state.teams[teamId]
  const picks = state.picks.filter((p) => p.owner === teamId && p.playerId === null)
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL')
  const [sortKey, setSortKey] = useState<(typeof ASSET_SORTS)[number]['key']>('ovr')

  const rosterRows = (team?.roster ?? [])
    .map((slot) => {
      const player = state.players[slot.playerId]
      const scouting = state.scouting[slot.playerId]
      if (!player || !scouting) return null
      return { slot, player, scouting, age: state.season - player.birthYear }
    })
    .filter(
      (r): r is { slot: RosterSlot; player: Player; scouting: ScoutingView; age: number } =>
        r !== null,
    )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-2)',
          }}
        >
          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fd-1)', margin: 0 }}>
            Players
          </h4>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-1)',
                fontSize: 'var(--fs-1)',
              }}
            >
              Position
              <select
                value={posFilter}
                onChange={(e) => setPosFilter(e.target.value as Position | 'ALL')}
              >
                <option value="ALL">All</option>
                {POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-1)',
                fontSize: 'var(--fs-1)',
              }}
            >
              Sort
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as (typeof ASSET_SORTS)[number]['key'])}
              >
                {ASSET_SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div
          style={{
            maxHeight: 220,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--sp-1)',
          }}
        >
          {rosterRows
            .filter((r) => posFilter === 'ALL' || r.player.pos === posFilter)
            .sort((a, b) => {
              if (sortKey === 'name') return a.player.name.localeCompare(b.player.name)
              if (sortKey === 'age') return b.age - a.age
              return b.scouting.ovr - a.scouting.ovr
            })
            .map(({ slot, player, scouting }) => (
              <label
                key={slot.playerId}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
              >
                <input
                  type="checkbox"
                  checked={selectedPlayers.has(slot.playerId)}
                  onChange={() => onTogglePlayer(slot.playerId)}
                />
                {player.name} <PositionBadge pos={player.pos} />{' '}
                <span className="tabular-nums">{scouting.ovr} ovr</span>
              </label>
            ))}
          {rosterRows.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No players on this roster.</p>
          )}
        </div>
      </div>
      <div>
        <h4
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fd-1)',
            margin: '0 0 var(--sp-2)',
          }}
        >
          Draft picks
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
          {[...picks]
            .sort(
              (a, b) => a.season - b.season || a.round - b.round || (a.pick ?? 0) - (b.pick ?? 0),
            )
            .map((p) => {
              const key = pickKey(p)
              return (
                <label
                  key={key}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPicks.has(key)}
                    onChange={() => onTogglePick(key)}
                  />
                  {p.season} round {p.round}
                  {p.pick != null ? ` (pick ${p.pick})` : ''}
                </label>
              )
            })}
          {picks.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>No picks owned.</p>
          )}
        </div>
      </div>
    </div>
  )
}

/** Two asset pickers with a live acceptance bar between them (docs/DESIGN.md §11). */
export function TradeCenter({
  state,
  data,
  tradeOffers,
  suggestedTrades,
  busy,
  onEvaluate,
  onProposeTrade,
  onRespondToOffer,
  onRefreshOffers,
  onRefreshSuggestions,
}: TradeCenterProps) {
  // Store actions are stable, so this runs once per visit: suggestions follow the roster as it stands.
  useEffect(() => {
    onRefreshSuggestions()
  }, [onRefreshSuggestions])

  const otherTeams = TEAM_IDS.filter((id) => id !== state.userTeam)
  const [opponent, setOpponent] = useState<TeamId>(otherTeams[0]!)
  const [myPlayers, setMyPlayers] = useState<Set<PlayerId>>(new Set())
  const [myPicks, setMyPicks] = useState<Set<string>>(new Set())
  const [theirPlayers, setTheirPlayers] = useState<Set<PlayerId>>(new Set())
  const [theirPicks, setTheirPicks] = useState<Set<string>>(new Set())

  const teamInfo = data.teams[state.userTeam]

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, key: string) {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setter(next)
  }

  const proposal: TradeProposal = useMemo(() => {
    const myPickRefs: PickRef[] = state.picks
      .filter((p) => p.owner === state.userTeam && myPicks.has(pickKey(p)))
      .map(toRef)
    const theirPickRefs: PickRef[] = state.picks
      .filter((p) => p.owner === opponent && theirPicks.has(pickKey(p)))
      .map(toRef)
    return {
      id: 'live-preview',
      offer: { teamId: state.userTeam, players: [...myPlayers], picks: myPickRefs },
      request: { teamId: opponent, players: [...theirPlayers], picks: theirPickRefs },
      initiatedBy: 'USER',
      season: state.season,
      week: state.week,
    }
  }, [
    state.userTeam,
    state.picks,
    state.season,
    state.week,
    opponent,
    myPlayers,
    myPicks,
    theirPlayers,
    theirPicks,
  ])

  const hasAssets =
    proposal.offer.players.length +
      proposal.offer.picks.length +
      proposal.request.players.length +
      proposal.request.picks.length >
    0
  const evaluation = hasAssets ? onEvaluate(proposal) : null

  function submit() {
    onProposeTrade({ ...proposal, id: makeProposalId() })
    setMyPlayers(new Set())
    setMyPicks(new Set())
    setTheirPlayers(new Set())
    setTheirPicks(new Set())
  }

  return (
    <>
      <div className="gg-col-6">
        <TeamScope colors={teamInfo?.colors ?? { primary: '#1F4334', secondary: '#F3ECD2' }}>
          <Panel variant="plate" title="Your offer" revealIndex={0}>
            <AssetPicker
              state={state}
              teamId={state.userTeam}
              selectedPlayers={myPlayers}
              selectedPicks={myPicks}
              onTogglePlayer={(id) => {
                const next = new Set(myPlayers)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                setMyPlayers(next)
              }}
              onTogglePick={(key) => toggle(myPicks, setMyPicks, key)}
            />
          </Panel>
        </TeamScope>
      </div>

      <div className="gg-col-6">
        <Panel variant="plate" title="Their side" revealIndex={1}>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-1)',
              marginBottom: 'var(--sp-3)',
            }}
          >
            Team
            <select value={opponent} onChange={(e) => setOpponent(e.target.value as TeamId)}>
              {otherTeams.map((id) => (
                <option key={id} value={id}>
                  {data.teams[id]?.city} {data.teams[id]?.name}
                </option>
              ))}
            </select>
          </label>
          <AssetPicker
            state={state}
            teamId={opponent}
            selectedPlayers={theirPlayers}
            selectedPicks={theirPicks}
            onTogglePlayer={(id) => {
              const next = new Set(theirPlayers)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              setTheirPlayers(next)
            }}
            onTogglePick={(key) => toggle(theirPicks, setTheirPicks, key)}
          />
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel title="Deal" revealIndex={2}>
          {evaluation ? (
            <AcceptanceBar p={evaluation.p} valid={evaluation.valid} />
          ) : (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>
              Add players or picks on both sides to see how they'd respond.
            </p>
          )}
          {evaluation && evaluation.reasons.length > 0 && (
            <ul
              style={{
                margin: 'var(--sp-2) 0 0',
                paddingLeft: 'var(--sp-4)',
                color: 'var(--text-2)',
                fontSize: 'var(--fs-1)',
              }}
            >
              {evaluation.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
          <div style={{ marginTop: 'var(--sp-3)' }}>
            <Button
              type="button"
              variant="primary"
              busy={busy}
              busyLabel="Working…"
              disabled={!hasAssets}
              onClick={submit}
            >
              Offer trade
            </Button>
          </div>
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel
          title="Suggested trades"
          revealIndex={3}
          action={
            <Button type="button" variant="ghost" onClick={onRefreshSuggestions}>
              Refresh suggestions
            </Button>
          }
        >
          <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--text-2)' }}>
            Deals other front offices would take today, aimed at your weakest positions. Accept one
            and it is done.
          </p>
          {suggestedTrades.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>
              No suggestions right now. Check back after a week or a roster move.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {suggestedTrades.map((offer, i) => (
                <OfferCard
                  key={offer.id}
                  title={`Deal with ${data.teams[offer.offer.teamId]?.abbr ?? offer.offer.teamId}`}
                  youGet={describeSide(state, data, offer.offer)}
                  youGive={describeSide(state, data, offer.request)}
                  evaluation={onEvaluate(offer)}
                  busy={busy}
                  revealIndex={i}
                  acceptLabel="Accept deal"
                  declineLabel="Dismiss"
                  onAccept={() => onRespondToOffer(offer, true)}
                  onDecline={() => onRespondToOffer(offer, false)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="gg-col-12">
        <Panel
          title="Incoming offers"
          revealIndex={4}
          action={
            <Button type="button" variant="ghost" onClick={onRefreshOffers}>
              Check for offers
            </Button>
          }
        >
          {tradeOffers.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>
              No offers yet. Teams call when your pick lines up with their biggest need.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              {tradeOffers.map((offer, i) => (
                <OfferCard
                  key={offer.id}
                  title={`${data.teams[offer.offer.teamId]?.abbr ?? offer.offer.teamId} offers`}
                  youGet={describeSide(state, data, offer.offer)}
                  youGive={describeSide(state, data, offer.request)}
                  evaluation={onEvaluate(offer)}
                  busy={busy}
                  revealIndex={i}
                  onAccept={() => onRespondToOffer(offer, true)}
                  onDecline={() => onRespondToOffer(offer, false)}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
