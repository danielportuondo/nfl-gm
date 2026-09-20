import type { CSSProperties } from 'react'
import type { GameResult, PlayoffBracket, StaticData, TeamId } from '@contracts/index'
import { TeamScope } from '@ui/sprites'
import { buildBracketTree, type BracketSlot, type ConferenceBracket } from './bracketTree'

export interface BracketProps {
  bracket: PlayoffBracket
  results: GameResult[]
  data: StaticData
}

const ROUND_HEADERS = ['Wild card', 'Divisional', 'Conference', 'Super Bowl']

interface CellSpec {
  slot: BracketSlot
  col: number
  rowStart: number
  rowSpan: number
  isRoot: boolean
}

/** DOM order: each conference's leaves, then the DIV game they feed, so feeders always precede it. */
function conferenceCells(conf: ConferenceBracket, rowOffset: number): CellSpec[] {
  const [leaf0, leaf1, leaf2, leaf3] = conf.leaves
  const [div0, div1] = conf.divs
  return [
    { slot: leaf0!, col: 1, rowStart: rowOffset + 1, rowSpan: 1, isRoot: false },
    { slot: leaf1!, col: 1, rowStart: rowOffset + 2, rowSpan: 1, isRoot: false },
    { slot: div0!, col: 2, rowStart: rowOffset + 1, rowSpan: 2, isRoot: false },
    { slot: leaf2!, col: 1, rowStart: rowOffset + 3, rowSpan: 1, isRoot: false },
    { slot: leaf3!, col: 1, rowStart: rowOffset + 4, rowSpan: 1, isRoot: false },
    { slot: div1!, col: 2, rowStart: rowOffset + 3, rowSpan: 2, isRoot: false },
    { slot: conf.conf, col: 3, rowStart: rowOffset + 1, rowSpan: 4, isRoot: false },
  ]
}

function abbrOf(data: StaticData, teamId: TeamId): string {
  return data.teams[teamId]?.abbr ?? teamId
}

function seedOf(bracket: PlayoffBracket, teamId: TeamId): number | undefined {
  return bracket.seeds.find((s) => s.teamId === teamId)?.seed
}

function BracketCard({
  slot,
  bracket,
  results,
  data,
  isRoot,
}: {
  slot: BracketSlot
  bracket: PlayoffBracket
  results: GameResult[]
  data: StaticData
  isRoot: boolean
}) {
  const classes = ['gg-bracket__card']
  if (isRoot) classes.push('gg-bracket__card--root', 'gg-bracket__card--champion')

  const body =
    slot.kind === 'bye' ? (
      <div className="gg-bracket__row tabular-nums">
        <span className="gg-bracket__seed">{slot.seed}</span>
        <span className="gg-bracket__team">{abbrOf(data, slot.teamId)}</span>
        <span className="gg-bracket__score">Bye</span>
      </div>
    ) : (
      [slot.game!.away, slot.game!.home].map((teamId) => {
        const isWinner = teamId === slot.teamId
        const result = results.find((r) => r.gameId === slot.game!.id)
        const score = result
          ? teamId === slot.game!.home
            ? result.homeScore
            : result.awayScore
          : null
        return (
          <div
            key={teamId}
            className={`gg-bracket__row tabular-nums ${isWinner ? 'gg-bracket__row--winner' : 'gg-bracket__row--loser'}`}
          >
            <span className="gg-bracket__seed">{seedOf(bracket, teamId) ?? ''}</span>
            <span className="gg-bracket__team">{abbrOf(data, teamId)}</span>
            <span className="gg-bracket__score">{score ?? '–'}</span>
          </div>
        )
      })
    )

  const card = <div className={classes.join(' ')}>{body}</div>

  if (isRoot) {
    const colors = data.teams[slot.teamId]?.colors
    if (colors) {
      return (
        <TeamScope colors={colors} style={{ width: '100%' }}>
          {card}
        </TeamScope>
      )
    }
  }
  return card
}

/** Postseason drawn as a binary tree with 2px `--line` connectors (docs/DESIGN.md §11). */
export function Bracket({ bracket, results, data }: BracketProps) {
  const tree = buildBracketTree(bracket, results)
  if (!tree) return null

  const cells: CellSpec[] = [
    ...conferenceCells(tree.afc, 0),
    ...conferenceCells(tree.nfc, 4),
    { slot: tree.superBowl, col: 4, rowStart: 1, rowSpan: 8, isRoot: true },
  ]

  return (
    <div className="gg-bracket-wrap">
      <div className="gg-bracket">
        {ROUND_HEADERS.map((label, i) => (
          <span
            key={label}
            className="gg-bracket__header"
            style={{ gridColumn: i + 1, gridRow: 1 }}
          >
            {label}
          </span>
        ))}
        {cells.map((cell, i) => {
          const isParent = cell.slot.children.length > 0
          const style: CSSProperties = {
            gridColumn: cell.col,
            gridRow: `${cell.rowStart + 1} / span ${cell.rowSpan}`,
          }
          return (
            <div
              key={cell.slot.game?.id ?? `${cell.slot.kind}-${cell.slot.teamId}-${i}`}
              className={
                isParent ? 'gg-bracket__cell gg-bracket__cell--parent' : 'gg-bracket__cell'
              }
              style={style}
            >
              <BracketCard
                slot={cell.slot}
                bracket={bracket}
                results={results}
                data={data}
                isRoot={cell.isRoot}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
