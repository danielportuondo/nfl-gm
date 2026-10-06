import { useState } from 'react'
import type {
  DraftPick,
  DraftRoomState,
  LeagueState,
  PickRef,
  StaticData,
  TradeEvaluation,
  TradeProposal,
} from '@contracts/index'
import { AcceptanceBar, Button, Panel } from '@ui/primitives'
import { describePick } from '../shared/pickLabel'
import { teamAbbr } from '../shared/teamLabel'

export interface TradeUpPanelProps {
  state: LeagueState
  data: StaticData
  room: DraftRoomState
  /** The AI-owned slot on the clock. */
  slot: DraftPick
  busy?: boolean
  onEvaluate: (proposal: TradeProposal) => TradeEvaluation
  onProposeTrade: (proposal: TradeProposal) => void
  onOpenTradeCenter: () => void
}

const toRef = (p: DraftPick): PickRef => ({
  season: p.season,
  round: p.round,
  originalTeam: p.originalTeam,
  pick: p.pick,
})

const refKey = (p: PickRef): string => `${p.season}-${p.round}-${p.originalTeam}-${p.pick ?? '?'}`

function ownPicks(state: LeagueState): DraftPick[] {
  return state.picks
    .filter((p) => p.owner === state.userTeam && p.playerId === null)
    .sort(
      (a, b) =>
        a.season - b.season ||
        a.round - b.round ||
        (a.pick ?? 999) - (b.pick ?? 999) ||
        a.originalTeam.localeCompare(b.originalTeam),
    )
}

/**
 * Offer picks for the slot an AI team is on the clock with (QA M3). Picks only; a deal with players
 * goes through the Trade Center. The room waits on this pick until the user sims on.
 */
export function TradeUpPanel({
  state,
  data,
  room,
  slot,
  busy,
  onEvaluate,
  onProposeTrade,
  onOpenTradeCenter,
}: TradeUpPanelProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const target = toRef(slot)
  const picks = ownPicks(state)
  const offered = picks.map(toRef).filter((ref) => selected.has(refKey(ref)))

  const proposal: TradeProposal | null =
    offered.length === 0
      ? null
      : {
          id: `draft-trade-up-${room.season}-${room.currentPickIndex}-${offered.map(refKey).join('+')}`,
          offer: { teamId: state.userTeam, players: [], picks: offered },
          request: { teamId: slot.owner, players: [], picks: [target] },
          initiatedBy: 'USER',
          season: state.season,
          week: state.week,
        }
  const evaluation = proposal ? onEvaluate(proposal) : null
  const partner = teamAbbr(data, slot.owner, slot.season)

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Panel title="Trade for this pick" revealIndex={1}>
      <p style={{ margin: '0 0 var(--sp-3)', color: 'var(--text-2)' }}>
        Offer {partner} your picks for {describePick(data, target)}.
      </p>
      {picks.length === 0 ? (
        <p style={{ margin: '0 0 var(--sp-3)' }}>You have no picks to offer.</p>
      ) : (
        <div
          role="group"
          aria-label="Your picks to offer"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-2)',
            marginBottom: 'var(--sp-3)',
          }}
        >
          {picks.map((p) => {
            const key = refKey(toRef(p))
            const on = selected.has(key)
            return (
              <button
                key={key}
                type="button"
                className="gg-button gg-button--secondary"
                aria-pressed={on}
                onClick={() => toggle(key)}
                style={on ? { boxShadow: 'var(--shadow-press)' } : undefined}
              >
                {describePick(data, p)}
              </button>
            )
          })}
        </div>
      )}
      {evaluation && (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <AcceptanceBar p={evaluation.p} valid={evaluation.valid} />
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)' }}>
        <Button
          type="button"
          variant="primary"
          busy={busy}
          busyLabel="Working…"
          disabled={!proposal || evaluation?.valid === false}
          onClick={() => proposal && onProposeTrade(proposal)}
        >
          Offer trade
        </Button>
        <Button type="button" variant="ghost" onClick={onOpenTradeCenter}>
          Open trades
        </Button>
      </div>
    </Panel>
  )
}
