import type { ReactNode } from 'react'
import { BustSprite, type SpriteStatus } from '../sprites'
import type { Position } from '@contracts/index'

export interface NamePlateProps {
  name: string
  pos: Position
  number?: number
  status?: SpriteStatus
  /** e.g. "82 ovr / 91 pot" for a draft board tile. */
  meta?: ReactNode
  selected?: boolean
  onClick?: () => void
  /** Keyboard/pointer reorder within a depth-chart column (docs/DESIGN.md §11). */
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** Depth-chart rows: no position badge (the column says it), a quieter ovr, full name on hover. */
  compact?: boolean
  /** Award cards: the full name and meta wrap onto extra lines instead of truncating. */
  wrap?: boolean
}

/** Draft-board tile: bust sprite, name, position badge, consensus ovr/pot (docs/DESIGN.md §8). */
export function NamePlate({
  name,
  pos,
  number,
  status,
  meta,
  selected,
  onClick,
  onMoveUp,
  onMoveDown,
  compact,
  wrap,
}: NamePlateProps) {
  const className = [
    'gg-nameplate',
    compact && 'gg-nameplate--compact',
    wrap && 'gg-nameplate--wrap',
  ]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      <BustSprite pos={pos} size={2} number={number} status={status} />
      <span className="gg-nameplate__name" title={compact ? name : undefined}>
        {name}
      </span>
      {!compact && <span className="gg-badge gg-badge--position">{pos}</span>}
      {meta && <span className="gg-nameplate__meta">{meta}</span>}
    </>
  )

  if (onMoveUp || onMoveDown) {
    return (
      <div className={className} aria-selected={selected} role="listitem">
        {content}
        <span className="gg-nameplate__reorder">
          <button
            type="button"
            className="gg-button gg-button--ghost"
            style={{ minHeight: 20, padding: '0 6px', fontSize: '0.6rem' }}
            onClick={onMoveUp}
            disabled={!onMoveUp}
            aria-label={`Move ${name} up`}
          >
            ▲
          </button>
          <button
            type="button"
            className="gg-button gg-button--ghost"
            style={{ minHeight: 20, padding: '0 6px', fontSize: '0.6rem' }}
            onClick={onMoveDown}
            disabled={!onMoveDown}
            aria-label={`Move ${name} down`}
          >
            ▼
          </button>
        </span>
      </div>
    )
  }

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-selected={selected}>
        {content}
      </button>
    )
  }

  return (
    <div className={className} aria-selected={selected}>
      {content}
    </div>
  )
}
