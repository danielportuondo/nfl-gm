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
}: NamePlateProps) {
  const content = (
    <>
      <BustSprite pos={pos} size={2} number={number} status={status} />
      <span className="gg-nameplate__name">{name}</span>
      <span className="gg-badge gg-badge--position">{pos}</span>
      {meta && <span className="gg-nameplate__meta">{meta}</span>}
    </>
  )

  if (onMoveUp || onMoveDown) {
    return (
      <div className="gg-nameplate" aria-selected={selected} role="listitem">
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
      <button type="button" className="gg-nameplate" onClick={onClick} aria-selected={selected}>
        {content}
      </button>
    )
  }

  return (
    <div className="gg-nameplate" aria-selected={selected}>
      {content}
    </div>
  )
}
