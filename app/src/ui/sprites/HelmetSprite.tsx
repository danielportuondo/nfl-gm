import type { Position } from '@contracts/index'
import { PixelSvg } from './PixelSvg'
import { bodyTypeForPosition, helmetRects, INJURY_OVERLAY, ROOKIE_OVERLAY } from './shapes'

export interface SpriteStatus {
  injured?: boolean
  rookie?: boolean
  freeAgent?: boolean
}

interface HelmetSpriteProps {
  pos: Position
  size?: 2 | 4 | 6
  status?: SpriteStatus
  /** Falls back to the enclosing <TeamScope> when omitted. */
  team?: string
}

/**
 * Side-profile helmet, colored by the enclosing <TeamScope> (docs/DESIGN.md §7). Decorative only —
 * aria-hidden; the adjacent text names the player.
 */
export function HelmetSprite({ pos, size = 2, status }: HelmetSpriteProps) {
  const bodyType = bodyTypeForPosition(pos)
  const rects = [...helmetRects(bodyType, Boolean(status?.freeAgent))]
  if (status?.injured) rects.push(...INJURY_OVERLAY)
  if (status?.rookie) rects.push(...ROOKIE_OVERLAY)
  return <PixelSvg rects={rects} size={size} />
}
