import { useState } from 'react'
import type { Contract, LeagueState, PlayerId, Position } from '@contracts/index'
import { Button, Panel, PositionBadge, StatTile, Table, type Column } from '@ui/primitives'

export interface FreeAgencyProps {
  state: LeagueState
  /** This season's cap in $M, from the store. */
  cap: number
  busy?: boolean
  onOfferContract: (playerId: PlayerId, contract: Contract) => void
  onResign: (playerId: PlayerId, contract: Contract) => void
  onRelease: (playerId: PlayerId) => void
  onSignUdfa: (playerIds: PlayerId[]) => void
  onResignAsk: (playerId: PlayerId) => number | null
}

function formatMoney(m: number): string {
  return `$${m.toFixed(1)}M`
}

interface PoolRow {
  id: PlayerId
  name: string
  pos: Position
  age: number
  ovr: number
  pot: number
}

/** Pool table with asks, your offers, re-sign list, UDFA list (docs/DESIGN.md §11). */
export function FreeAgency({ state, cap, busy, onOfferContract, onResign, onRelease, onSignUdfa, onResignAsk }: FreeAgencyProps) {
  const team = state.teams[state.userTeam]
  const payroll = (team?.roster ?? []).reduce((sum, slot) => sum + slot.contract.apy, 0)
  const capSpace = cap - payroll - (team?.deadMoney ?? 0)
  const minApy = Math.max(0.5, Math.round(cap * 0.003 * 10) / 10)

  const [selected, setSelected] = useState<PlayerId | null>(null)
  const [offerYears, setOfferYears] = useState(2)
  const [offerApy, setOfferApy] = useState(minApy)

  const [resignDrafts, setResignDrafts] = useState<Record<PlayerId, { years: number; apy: number }>>({})
  const [udfaSelected, setUdfaSelected] = useState<Set<PlayerId>>(new Set())

  const poolRows: PoolRow[] = state.freeAgents
    .map((id) => {
      const player = state.players[id]
      const scouting = state.scouting[id]
      if (!player || !scouting) return null
      return { id, name: player.name, pos: player.pos, age: state.season - player.birthYear, ovr: scouting.ovr, pot: scouting.pot }
    })
    .filter((r): r is PoolRow => r !== null)
    .sort((a, b) => b.ovr - a.ovr || b.pot - a.pot || a.name.localeCompare(b.name))

  const columns: Column<PoolRow>[] = [
    {
      key: 'name',
      header: 'Player',
      frozen: true,
      render: (r) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
          {r.name} <PositionBadge pos={r.pos} />
        </span>
      ),
    },
    { key: 'age', header: 'Age', numeric: true, render: (r) => r.age },
    { key: 'ovr', header: 'Ovr', numeric: true, rating: true, render: (r) => r.ovr },
    { key: 'pot', header: 'Pot', numeric: true, rating: true, render: (r) => r.pot },
  ]

  const expiring = (team?.roster ?? []).filter((slot) => slot.contract.years <= 1)
  const udfaPool = state.phase === 'UDFA' ? (state.draftRoom?.udfaPool ?? []) : []

  return (
    <>
      <div className="gg-col-12">
        <Panel title="Cap" revealIndex={0}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--sp-4)' }}>
            <StatTile value={formatMoney(cap)} label="Cap this season" />
            <StatTile value={formatMoney(capSpace)} label="Cap space" tone={capSpace < 0 ? 'danger' : 'default'} />
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
                  const ask = onResignAsk(slot.playerId)
                  const draft = resignDrafts[slot.playerId] ?? { years: 2, apy: ask ?? slot.contract.apy }
                  return (
                    <div key={slot.playerId} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp-3)' }}>
                      <span style={{ minWidth: 160 }}>
                        {player.name} <PositionBadge pos={player.pos} />
                      </span>
                      <span style={{ color: 'var(--text-2)' }}>{ask != null ? `Asking ${formatMoney(ask)}/yr` : 'Ask unavailable'}</span>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
                        Years
                        <input
                          type="number"
                          min={1}
                          max={7}
                          value={draft.years}
                          style={{ width: '4ch' }}
                          onChange={(e) =>
                            setResignDrafts((d) => ({ ...d, [slot.playerId]: { ...draft, years: Number(e.target.value) } }))
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
                          onChange={(e) => setResignDrafts((d) => ({ ...d, [slot.playerId]: { ...draft, apy: Number(e.target.value) } }))}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="primary"
                        busy={busy}
                        busyLabel="Working…"
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
                      <Button type="button" variant="danger" busy={busy} busyLabel="Working…" onClick={() => onRelease(slot.playerId)}>
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
            {udfaPool.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--text-2)' }}>No UDFA pool loaded.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', maxHeight: 320, overflowY: 'auto' }}>
                  {udfaPool.map((id) => {
                    const player = state.players[id]
                    const scouting = state.scouting[id]
                    if (!player || !scouting) return null
                    return (
                      <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
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
                        {player.name} <PositionBadge pos={player.pos} /> <span className="tabular-nums">{scouting.ovr} ovr</span>
                      </label>
                    )
                  })}
                </div>
                <div style={{ marginTop: 'var(--sp-3)' }}>
                  <Button type="button" variant="primary" busy={busy} busyLabel="Signing…" onClick={() => onSignUdfa([...udfaSelected])}>
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
          <Table
            columns={columns}
            rows={poolRows}
            rowKey={(r) => r.id}
            caption="Unsigned players, sorted by consensus overall"
            dense
            selectedRowKey={selected}
            onRowClick={(r) => setSelected(r.id)}
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
                  return ask === null ? null : <span style={{ color: 'var(--text-2)' }}> · asking about {formatMoney(ask)}/yr</span>
                })()}
              </p>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                Years
                <input type="number" min={1} max={5} value={offerYears} onChange={(e) => setOfferYears(Number(e.target.value))} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' }}>
                APY ($M)
                <input type="number" min={minApy} step={0.1} value={offerApy} onChange={(e) => setOfferApy(Number(e.target.value))} />
                <span style={{ color: 'var(--text-2)', fontSize: 'var(--fs-1)' }}>League minimum is about {formatMoney(minApy)}.</span>
              </label>
              <Button
                type="button"
                variant="primary"
                busy={busy}
                busyLabel="Working…"
                onClick={() =>
                  onOfferContract(selected, { years: offerYears, apy: offerApy, guaranteedPct: 0.3, signedSeason: state.season, rookie: false })
                }
              >
                Offer contract
              </Button>
            </div>
          )}
        </Panel>
      </div>
    </>
  )
}
