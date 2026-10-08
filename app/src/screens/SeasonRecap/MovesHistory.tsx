import type { CSSProperties, ReactNode } from 'react'
import { useMemo, useState } from 'react'
import type { LeagueState, PlayerId, StaticData, TradeSide, Transaction } from '@contracts/index'
import { Panel } from '@ui/primitives'
import { describePick } from '../shared/pickLabel'
import { teamAbbr } from '../shared/teamLabel'
import { formatMoney } from '../shared/formatMoney'
import {
  MOVE_FILTERS,
  MOVE_FILTER_LABEL,
  groupBySeason,
  matchesFilter,
  pickUsedAs,
  ratingFor,
  summarizeCounts,
  type MoveFilter,
} from './moves'
import { leagueYear } from '../shared/phaseLabel'

export interface MovesHistoryProps {
  state: LeagueState
  data: StaticData
  revealIndex?: number
}

function playerLabel(state: LeagueState, id: PlayerId): { name: string; pos: string } {
  const p = state.players[id]
  return { name: p?.name ?? id, pos: p?.pos ?? '—' }
}

/** Ratings are always in the display face (docs/DESIGN.md §2.3), never Barlow. */
function Rating({
  state,
  id,
  ovrAtMove,
}: {
  state: LeagueState
  id: PlayerId
  ovrAtMove: Record<string, number>
}) {
  const r = ratingFor(state, id, ovrAtMove)
  if (!r) return null
  const style: CSSProperties = {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--fd-1)',
  }
  if (r.then == null) {
    return (
      <span className="tabular-nums" style={style}>
        {r.now}
      </span>
    )
  }
  const color =
    r.now > r.then ? 'var(--positive)' : r.now < r.then ? 'var(--danger)' : 'var(--text-2)'
  return (
    <span className="tabular-nums" style={style}>
      {r.then} <span aria-hidden="true">→</span> <span style={{ color }}>{r.now}</span>
    </span>
  )
}

const KIND_LABEL: Record<Transaction['kind'], string> = {
  TRADE: 'Trade',
  DRAFT: 'Draft',
  UDFA: 'UDFA',
  SIGN: 'Signed',
  RESIGN: 'Re-signed',
  RELEASE: 'Released',
  LEFT_LEAGUE: 'Left the league',
}

const KIND_TAG_STYLE: Record<Transaction['kind'], CSSProperties> = {
  TRADE: { background: 'var(--line)', color: 'var(--text-inverse)' },
  DRAFT: { background: 'var(--line)', color: 'var(--text-inverse)' },
  UDFA: { background: 'transparent', color: 'var(--text-2)', border: '2px solid var(--text-2)' },
  SIGN: {
    background: 'transparent',
    color: 'var(--positive)',
    border: '2px solid var(--positive)',
  },
  RESIGN: {
    background: 'transparent',
    color: 'var(--positive)',
    border: '2px solid var(--positive)',
  },
  RELEASE: { background: 'var(--danger)', color: 'var(--on-danger)' },
  LEFT_LEAGUE: {
    background: 'transparent',
    color: 'var(--text-2)',
    border: '2px solid var(--text-2)',
  },
}

function KindTag({ kind }: { kind: Transaction['kind'] }) {
  return (
    <span className="gg-badge" style={{ ...KIND_TAG_STYLE[kind], flexShrink: 0 }}>
      {KIND_LABEL[kind]}
    </span>
  )
}

/** Interspaces nodes with ", "; nodes must already carry their own keys. */
function joinNodes(nodes: ReactNode[]): ReactNode {
  return nodes.flatMap((n, i) => (i === 0 ? [n] : [', ', n]))
}

function renderSide(
  side: TradeSide,
  state: LeagueState,
  data: StaticData,
  ovrAtMove: Record<string, number>,
  resolvePicks: boolean,
): ReactNode {
  const parts: ReactNode[] = []
  for (const id of side.players) {
    const { name, pos } = playerLabel(state, id)
    parts.push(
      <span
        key={`p-${id}`}
        style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'baseline' }}
      >
        <span>
          {name} {pos}
        </span>
        <Rating state={state} id={id} ovrAtMove={ovrAtMove} />
      </span>,
    )
  }
  side.picks.forEach((pick, i) => {
    const used = resolvePicks ? pickUsedAs(state, pick) : undefined
    const usedLabel = used?.playerId ? playerLabel(state, used.playerId) : undefined
    parts.push(
      <span key={`k-${i}`}>
        {describePick(data, pick)}
        {usedLabel ? ` → ${usedLabel.name} ${usedLabel.pos}` : ''}
      </span>,
    )
  })
  return parts.length === 0 ? 'nothing' : joinNodes(parts)
}

function Row({ kind, children }: { kind: Transaction['kind']; children: ReactNode }) {
  return (
    <div
      role="listitem"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--sp-2)',
        flexWrap: 'wrap',
        minWidth: 0,
        borderTop: 'var(--bw) solid var(--line)',
        paddingTop: 'var(--sp-2)',
      }}
    >
      <KindTag kind={kind} />
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          flex: '1 1 220px',
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function EntryLine({ t, state, data }: { t: Transaction; state: LeagueState; data: StaticData }) {
  switch (t.kind) {
    case 'DRAFT': {
      const { name, pos } = playerLabel(state, t.playerId)
      return (
        <Row kind={t.kind}>
          <span>
            <span className="tabular-nums">
              R{t.round} #{t.pick}
            </span>{' '}
            · {name} {pos}
          </span>
          <Rating state={state} id={t.playerId} ovrAtMove={t.ovrAtMove} />
        </Row>
      )
    }
    case 'UDFA': {
      const { name, pos } = playerLabel(state, t.playerId)
      return (
        <Row kind={t.kind}>
          <span>
            {name} {pos}
          </span>
          <Rating state={state} id={t.playerId} ovrAtMove={t.ovrAtMove} />
        </Row>
      )
    }
    case 'SIGN':
    case 'RESIGN': {
      const { name, pos } = playerLabel(state, t.playerId)
      return (
        <Row kind={t.kind}>
          <span>
            {name} {pos} · {t.contract.years}y {formatMoney(t.contract.apy)}/yr
          </span>
          <Rating state={state} id={t.playerId} ovrAtMove={t.ovrAtMove} />
        </Row>
      )
    }
    case 'RELEASE': {
      const { name, pos } = playerLabel(state, t.playerId)
      return (
        <Row kind={t.kind}>
          <span>
            {name} {pos} · dead {formatMoney(t.deadMoney)}
          </span>
          <Rating state={state} id={t.playerId} ovrAtMove={t.ovrAtMove} />
        </Row>
      )
    }
    case 'LEFT_LEAGUE': {
      const { name, pos } = playerLabel(state, t.playerId)
      return (
        <Row kind={t.kind}>
          <span>
            {name} {pos}
          </span>
          <Rating state={state} id={t.playerId} ovrAtMove={t.ovrAtMove} />
        </Row>
      )
    }
    case 'TRADE': {
      return (
        <Row kind={t.kind}>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', minWidth: 0 }}
          >
            <span>with {teamAbbr(data, t.got.teamId, leagueYear(t.season, t.phase))}</span>
            <p style={{ margin: 0 }}>
              <span style={{ fontWeight: 600 }}>Gave: </span>
              {renderSide(t.gave, state, data, t.ovrAtMove, false)}
            </p>
            <p style={{ margin: 0 }}>
              <span style={{ fontWeight: 600 }}>Got: </span>
              {renderSide(t.got, state, data, t.ovrAtMove, true)}
            </p>
          </div>
        </Row>
      )
    }
  }
}

/** "Your moves": the user's transaction log, newest season first (docs/DESIGN.md, extended). */
export function MovesHistory({ state, data, revealIndex }: MovesHistoryProps) {
  const [filter, setFilter] = useState<MoveFilter>('all')
  const groups = useMemo(() => groupBySeason(state.transactions), [state.transactions])

  if (state.transactions.length === 0) {
    return (
      <Panel title="Your moves" variant="sunken" revealIndex={revealIndex}>
        <p style={{ margin: 0, color: 'var(--text-2)' }}>
          No moves yet. Trades, picks, signings and releases you make show up here.
        </p>
      </Panel>
    )
  }

  const visibleGroups = groups
    .map((g) => ({ ...g, entries: g.entries.filter((e) => matchesFilter(e, filter)) }))
    .filter((g) => g.entries.length > 0)

  return (
    <Panel title="Your moves" variant="sunken" revealIndex={revealIndex}>
      <div
        role="group"
        aria-label="Filter by move type"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {MOVE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="gg-button gg-button--secondary"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            style={filter === f ? { boxShadow: 'var(--shadow-press)' } : undefined}
          >
            {MOVE_FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      {visibleGroups.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-2)' }}>No moves match this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
          {visibleGroups.map((g) => (
            <section key={g.season} style={{ minWidth: 0 }}>
              <h4
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fd-2)',
                  margin: '0 0 var(--sp-1)',
                }}
              >
                <span className="tabular-nums">{g.season}</span>
                {g.season === leagueYear(state.season, state.phase) &&
                state.outcome === 'IN_PROGRESS'
                  ? ' (in progress)'
                  : ''}
              </h4>
              <p
                style={{
                  margin: '0 0 var(--sp-2)',
                  color: 'var(--text-2)',
                  fontSize: 'var(--fs-1)',
                }}
              >
                {summarizeCounts(g.entries)}
              </p>
              <div role="list" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {g.entries.map((t, i) => (
                  <EntryLine key={i} t={t} state={state} data={data} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Panel>
  )
}
