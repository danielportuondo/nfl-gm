import type { Position } from '@contracts/index'
import type { SpriteStatus } from './HelmetSprite'
import { PixelSvg } from './PixelSvg'
import { bodyTypeForPosition, bustRects, INJURY_OVERLAY, ROOKIE_OVERLAY } from './shapes'

interface BustSpriteProps {
  pos: Position
  size?: 2 | 4 | 6
  number?: number
  status?: SpriteStatus
}

/**
 * Shoulders + jersey bust, colored by the enclosing <TeamScope> (docs/DESIGN.md §7). The jersey
 * number renders in Pixelify over --on-team-primary. Decorative only — aria-hidden.
 */
export function BustSprite({ pos, size = 2, number, status }: BustSpriteProps) {
  const bodyType = bodyTypeForPosition(pos)
  const isFreeAgent = Boolean(status?.freeAgent)
  const rects = [...bustRects(bodyType, isFreeAgent)]
  if (status?.injured) rects.push(...INJURY_OVERLAY)
  if (status?.rookie) rects.push(...ROOKIE_OVERLAY)
  const px = 16 * size
  return (
    <span style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <PixelSvg rects={rects} size={size} />
      {number != null && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            paddingBottom: `${px * 0.14}px`,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: `${px * 0.28}px`,
            lineHeight: 1,
            color: isFreeAgent ? 'var(--text-3)' : 'var(--on-team-primary)',
          }}
        >
          {number}
        </span>
      )}
    </span>
  )
}
