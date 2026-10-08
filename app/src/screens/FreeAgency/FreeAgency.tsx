import { useMemo, useState } from 'react'
import {
  POSITIONS,
  type Contract,
  type LeagueState,
  type PlayerId,
  type Position,
} from '@contracts/index'
import {
  Button,
  Meter,
  Panel,
  PositionBadge,
  StatTile,
  Table,
  type Column,
  type SortState,
} from '@ui/primitives'
import { committedPayroll, roundUpTenth } from '@engine/fa'
import { isExpiring } from '../shared/contractStatus'
import { formatMoney } from '../shared/formatMoney'
import { absenceLabel } from '../shared/absences'
import { isOffseasonPhase } from '../shared/phaseLabel'
import { useReleaseConfirm, type ReleaseImpact } from '../shared/ReleaseConfirm'

export interface FreeAgencyProps {
  state: LeagueState
  /** The cap a signing is measured against, in $M: this season's in season, next season's in the offseason. */
  cap: number
  busy?: boolean
  onOfferContract: (playerId: PlayerId, contract: Contract) => void
  onResign: (playerId: PlayerId, contract: Contract) => void
  onRelease: (playerId: PlayerId) => void
  /** Cap effect of releasing these players, shown in the confirm. */
  releaseImpact?: (ids: PlayerId[]) => ReleaseImpact | null
  onSignUdfa: (playerIds: PlayerId[]) => void
  onResignAsk: (playerId: PlayerId) => number | null
  /** A player with no real season left: shown as "Leaving football", no re-sign. Defaults to nobody. */
  isLeavingFootball?: (playerId: PlayerId) => boolean
  /** Acceptance odds before the offer is made (docs/DECISIONS.md Phase 5 follow-ups). Null when not built yet. */
  onOfferOdds?: (playerId: PlayerId, contract: Contract) => number | null
}

const POOL_FILTERS: Array<Position | 'ALL'> = ['ALL', ...POSITIONS]

/** Asks print rounded up, so typing the printed number always meets the real ask. */
function formatAsk(m: number): string {
  return formatMoney(roundUpTenth(m))
}

interface PoolRow {
  id: PlayerId
  name: string
  pos: Position
  age: number
  ovr: number
  pot: number
  absence: string | null
}

/** Pool table with asks, your offers, re-sign list, UDFA list (docs/DESIGN.md §11). */
export function FreeAgency({
  state,
  cap,
  busy,
  onOfferContract,
  onResign,
  onRelease,
  releaseImpact,
  onSignUdfa,
  onResignAsk,
  isLeavingFootball,
  onOfferOdds,
}: FreeAgencyProps) {
  const { askToRelease, releaseDialog } = useReleaseConfirm()
  const team = state.teams[state.userTeam]
  const offseason = isOffseasonPhase(state.phase)
  const capSpace = cap - committedPayroll(state, state.userTeam)
  const minApy = Math.max(0.5, Math.round(cap * 0.003 * 10) / 10)

  const [selected, setSelected] = useState<PlayerId | null>(null)
  const [offerYears, setOfferYears] = useState(2)
  const [offerApy, setOfferApy] = useState(minApy)
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL')
  const [sort, setSort] = useState<SortState>({ key: 'ovr', dir: 'desc' })

  const [resignDrafts, setResignDrafts] = useState<
    Record<PlayerId, { years: number; apy: number }>
  >({})
  const [udfaSelected, setUdfaSelected] = useState<Set<PlayerId>>(new Set())

  const allRows: PoolRow[] = state.freeAgents
    .map((id) => {
      const player = state.players[id]
      const scouting = state.scouting[id]
      if (!player || !scouting) return null
      return {
        id,
        name: player.name,
        pos: player.pos,
        age: state.season - player.birthYear,
        ovr: scouting.ovr,
        pot: scouting.pot,
        absence: absenceLabel(state, id),
      }
    })
    .filter((r): r is PoolRow => r !== null)

  const poolRows = useMemo(() => {
    const filtered = posFilter === 'ALL' ? allRows : allRows.filter((r) => r.pos === posFilter)
    const dir = sort.dir === 'asc' ? 1 : -1
    const sorted = [...filtered]
    sorted.sort((a, b) => {
      const va =
        sort.key === 'name'
          ? a.name
          : sort.key === 'age'
            ? a.age
            : sort.key === 'pot'
              ? a.pot
              : a.ovr
      const vb =
        sort.key === 'name'
          ? b.name
          : sort.key === 'age'
            ? b.age
            : sort.key === 'pot'
              ? b.pot
              : b.ovr
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0
    })
    return sorted
  }, [allRows, posFilter, sort])

  const columns: Column<PoolRow>[] = [
    {
      key: 'name',
      header: 'Player',
      frozen: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {r.name} <PositionBadge pos={r.pos} />
        </span>
      ),
    },
    { key: 'age', header: 'Age', numeric: true, sortValue: (r) => r.age, render: (r) => r.age },
    {
      key: 'ovr',
      header: 'Ovr',
      numeric: true,
      rating: true,
      sortValue: (r) => r.ovr,
      render: (r) => r.ovr,
    },
    {
      key: 'pot',
      header: 'Pot',
      numeric: true,
      rating: true,
      sortValue: (r) => r.pot,
      render: (r) => r.pot,
    },
    {
      key: 'absence',
      header: 'Real absence',
      sortValue: (r) => r.absence ?? '',
      render: (r) =>
        r.absence ? <span style={{ color: 'var(--danger)' }}>{r.absence}</span> : null,
    },
  ]

  const offerOdds =
    selected && onOfferOdds
      ? onOfferOdds(selected, {
          years: offerYears,
          apy: offerApy,
          guaranteedPct: 0.3,
          signedSeason: state.season,
          rookie: false,
        })
      : null

  const expiring = (team?.roster ?? []).filter((slot) => isExpiring(state, slot.contract))
  const udfaPool = state.phase === 'UDFA' ? (state.draftRoom?.udfaPool ?? []) : []
  // draft.runUdfa finalizes every team's UDFA signings in one shot and clears draftRoom (by design);
  // an empty pool while still in the UDFA phase means signings are done, not that nothing loaded.
  const udfaDone = state.phase === 'UDFA' && state.draftRoom === null

  return (
    <>
      <div className="gg-col-12">
        <Panel title="Cap" revealIndex={0}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 'var(--sp-4)',
            }}
          >
            <StatTile
              value={formatMoney(cap)}
              label={offseason ? 'Cap next season' : 'Cap this season'}
            />
            <StatTile
              value={formatMoney(capSpace)}
              label={offseason ? 'Space next season' : 'Cap space'}
              tone={capSpace < 0 ? 'danger' : 'default'}
            />
            <StatTile value={String((team?.roster ?? []).length)} label="Roster size" />
          </div>
        </Panel>
      </div>

      {state.phase === 'OFFSEASON_RESIGN' && (
        <div className="gg-col-12">
          <Panel title="Re-sign your own" variant="sunken" revealIndex={1}>
            {expiring.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-2)' }}>No expiring contracts.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {expiring.map((slot) => {
                  const player = state.players[slot.playerId]
                  if (!player) return null
                  const leaving = isLeavingFootball?.(slot.playerId) ?? false
                  const ask = onResignAsk(slot.playerId)
                  const draft = resignDrafts[slot.playerId] ?? {
                    years: 2,
                    apy: ask === null ? slot.contract.apy : roundUpTenth(ask),
                  }
                  return (
                    <div
                      key={slot.playerId}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 'var(--sp-3)',
                      }}
                    >
                      <span style={{ minWidth: 160 }}>
                        {player.name} <PositionBadge pos={player.pos} />
                      </span>
                      <span style={{ color: 'var(--text-2)' }}>
                        {leaving
                          ? 'Leaving football'
                          : ask != null
                            ? `Asking ${formatAsk(ask)}/yr`
                            : 'Ask unavailable'}
                      </span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                        Years
                        <input
                          type="number"
                          min={1}
                          max={7}
                          value={draft.years}
                          style={{ width: '4ch' }}
                          onChange={(e) =>
                            setResignDrafts((d) => ({
                              ...d,
                              [slot.playerId]: { ...draft, years: Number(e.target.value) },
                            }))
                          }
                        />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                        APY ($M)
                        <input
                          type="number"
                          min={minApy}
                          step={0.1}
                          value={draft.apy}
                          style={{ width: '6ch' }}
                          onChange={(e) =>
                            setResignDrafts((d) => ({
                              ...d,
                              [slot.playerId]: { ...draft, apy: Number(e.target.value) },
                            }))
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        variant="primary"
                        busy={busy}
                        busyLabel="Working…"
                        disabled={leaving}
                        onClick={() =>
                          onResign(slot.playerId, {
                            years: draft.years,
                            apy: draft.apy,
                            guaranteedPct: 0.5,
                            signedSeason: state.season,
                            rookie: false,
                          })
                        }
                      >
                        Re-sign
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        busy={busy}
                        busyLabel="Working…"
                        onClick={() =>
                          askToRelease({
                            title: `Release ${player.name}?`,
                            confirmLabel: 'Release',
                            impact: releaseImpact?.([slot.playerId]) ?? null,
                            onConfirm: () => onRelease(slot.playerId),
                          })
                        }
                      >
                        Release
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>
      )}

      {state.phase === 'UDFA' && (
        <div className="gg-col-12">
          <Panel title="Undrafted free agents" variant="sunken" revealIndex={1}>
            {udfaDone ? (
              <p style={{ margin: 0, color: 'var(--text-2)' }}>
                UDFA signings are done for this year.
              </p>
            ) : udfaPool.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-2)' }}>No UDFA pool loaded.</p>
            ) : (
              <>
                <p className="gg-field__hint" style={{ margin: '0 0 var(--sp-2)' }}>
                  Signing closes the UDFA period for every team this year — there's no more signing
                  after this.
                </p>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--sp-1)',
                    maxHeight: 320,
                    overflowY: 'auto',
                  }}
                >
                  {udfaPool.map((id) => {
                    const player = state.players[id]
                    const scouting = state.scouting[id]
                    if (!player || !scouting) return null
                    return (
                      <label
                        key={id}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
                      >
                        <input
                          type="checkbox"
                          checked={udfaSelected.has(id)}
                          onChange={() => {
                            const next = new Set(udfaSelected)
                            if (next.has(id)) next.delete(id)
                            else next.add(id)
                            setUdfaSelected(next)
                          }}
                        />
                        {player.name} <PositionBadge pos={player.pos} />{' '}
                        <span className="tabular-nums">{scouting.ovr} ovr</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ marginTop: 'var(--sp-3)' }}>
                  <Button
                    type="button"
                    variant="primary"
                    busy={busy}
                    busyLabel="Signing…"
                    onClick={() => onSignUdfa([...udfaSelected])}
                  >
                    Sign UDFA
                  </Button>
                </div>
              </>
            )}
          </Panel>
        </div>
      )}

      <div className="gg-col-8">
        <Panel title="Free agent pool" variant="sunken" revealIndex={2}>
          <div
            role="group"
            aria-label="Filter by position"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
              marginBottom: 'var(--sp-3)',
            }}
          >
            {POOL_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className="gg-button gg-button--secondary"
                aria-pressed={posFilter === f}
                onClick={() => setPosFilter(f)}
                style={posFilter === f ? { boxShadow: 'var(--shadow-press)' } : undefined}
              >
                {f}
              </button>
            ))}
          </div>
          <Table
            columns={columns}
            rows={poolRows}
            rowKey={(r) => r.id}
            caption="Unsigned players"
            dense
            selectedRowKey={selected}
            onRowClick={(r) => setSelected(r.id)}
            sort={sort}
            onSortChange={(key) =>
              setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
            }
          />
        </Panel>
      </div>

      <div className="gg-col-4">
        <Panel title="Make an offer" revealIndex={3}>
          {!selected ? (
            <p style={{ margin: 0, color: 'var(--text-2)' }}>Select a player from the pool.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
              <p style={{ margin: 0 }}>
                {state.players[selected]?.name}
                {(() => {
                  const ask = onResignAsk(selected)
                  return ask === null ? null : (
                    <span style={{ color: 'var(--text-2)' }}>
                      {' '}
                      · asking about {formatAsk(ask)}/yr
                    </span>
                  )
                })()}
              </p>
              {(() => {
                const absence = absenceLabel(state, selected)
                return absence ? (
                  <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
                    {absence}. He misses those weeks for your team too.
                  </p>
                ) : null
              })()}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                Years
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={offerYears}
                  onChange={(e) => setOfferYears(Number(e.target.value))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                APY ($M)
                <input
                  type="number"
                  min={minApy}
                  step={0.1}
                  value={offerApy}
                  onChange={(e) => setOfferApy(Number(e.target.value))}
                />
                <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>
                  League minimum is about {formatMoney(minApy)}.
                </span>
              </label>
              {offerOdds !== null && (
                <Meter value={offerOdds} label="Acceptance odds before you offer" />
              )}
              <Button
                type="button"
                variant="primary"
                busy={busy}
                busyLabel="Working…"
                onClick={() =>
                  onOfferContract(selected, {
                    years: offerYears,
                    apy: offerApy,
                    guaranteedPct: 0.3,
                    signedSeason: state.season,
                    rookie: false,
                  })
                }
              >
                Offer contract
              </Button>
            </div>
          )}
        </Panel>
      </div>
      {releaseDialog}
    </>
  )
}
