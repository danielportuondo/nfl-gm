/**
 * Pixel-rect geometry for the sprite system (docs/DESIGN.md §7). 16×16 grid, integer coordinates only,
 * rendered crisp at 2×/4×/6×. No faces, no skin, no photos, no logos — team-colored silhouettes only.
 */
import type { Position } from '@contracts/index'

export type BodyType = 'QB' | 'SKILL' | 'BIG' | 'LB' | 'SPECIAL'

const BODY_TYPE_BY_POS: Record<Position, BodyType> = {
  QB: 'QB',
  RB: 'SKILL',
  WR: 'SKILL',
  TE: 'SKILL',
  CB: 'SKILL',
  S: 'SKILL',
  OL: 'BIG',
  DL: 'BIG',
  LB: 'LB',
  K: 'SPECIAL',
  P: 'SPECIAL',
}

export function bodyTypeForPosition(pos: Position): BodyType {
  return BODY_TYPE_BY_POS[pos]
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  fill: string
}

export const HIGHLIGHT = 'color-mix(in oklab, var(--team-primary), white 22%)'

interface PalettePlain {
  primary: string
  secondary: string
  line: string
  highlight: string
  neutral: string
}

/** Free agents render in neutral surface colors instead of team colors (§7). */
export function paletteFor(isFreeAgent: boolean): PalettePlain {
  return isFreeAgent
    ? { primary: 'var(--surface-3)', secondary: 'var(--text-3)', line: 'var(--text-3)', highlight: 'var(--surface-2)', neutral: 'var(--surface-2)' }
    : { primary: 'var(--team-primary)', secondary: 'var(--team-secondary)', line: 'var(--line)', highlight: HIGHLIGHT, neutral: 'var(--surface-2)' }
}

/** Side-profile helmet shell, shared across body types; the facemask differs only for SPECIAL. */
export function helmetRects(bodyType: BodyType, isFreeAgent: boolean): Rect[] {
  const p = paletteFor(isFreeAgent)
  const rects: Rect[] = [
    // shell (a stepped oval, facing right)
    { x: 5, y: 2, w: 6, h: 1, fill: p.primary },
    { x: 3, y: 3, w: 9, h: 2, fill: p.primary },
    { x: 2, y: 5, w: 10, h: 4, fill: p.primary },
    { x: 3, y: 9, w: 9, h: 2, fill: p.primary },
    { x: 5, y: 11, w: 6, h: 1, fill: p.primary },
    // racing stripe
    { x: 7, y: 2, w: 2, h: 10, fill: p.secondary },
    // highlight
    { x: 4, y: 3, w: 2, h: 1, fill: p.highlight },
    // visor (a silhouette, not a person)
    { x: 9, y: 6, w: 3, h: 1, fill: p.line },
  ]
  if (bodyType === 'SPECIAL') {
    // single-bar facemask
    rects.push({ x: 12, y: 7, w: 4, h: 1, fill: p.line })
  } else {
    rects.push(
      { x: 12, y: 6, w: 3, h: 1, fill: p.line },
      { x: 12, y: 8, w: 3, h: 1, fill: p.line },
      { x: 15, y: 5, w: 1, h: 5, fill: p.line },
    )
  }
  return rects
}

/** Shoulders + jersey, body silhouette by position group. Number sits in front of the jersey. */
export function bustRects(bodyType: BodyType, isFreeAgent: boolean): Rect[] {
  const p = paletteFor(isFreeAgent)
  const rects: Rect[] = [
    // head
    { x: 6, y: 1, w: 4, h: 3, fill: p.primary },
    { x: 7, y: 2, w: 2, h: 1, fill: p.line },
  ]
  if (bodyType !== 'BIG') rects.push({ x: 7, y: 4, w: 2, h: 1, fill: p.neutral }) // neck

  const shoulders: Record<BodyType, Rect[]> = {
    QB: [{ x: 4, y: 5, w: 8, h: 2, fill: p.primary }],
    SPECIAL: [{ x: 4, y: 5, w: 8, h: 2, fill: p.primary }],
    LB: [
      { x: 3, y: 5, w: 10, h: 2, fill: p.primary },
      { x: 3, y: 6, w: 1, h: 1, fill: p.secondary },
      { x: 12, y: 6, w: 1, h: 1, fill: p.secondary },
    ],
    SKILL: [
      { x: 3, y: 5, w: 10, h: 2, fill: p.primary },
      { x: 2, y: 8, w: 1, h: 1, fill: p.secondary },
      { x: 13, y: 8, w: 1, h: 1, fill: p.secondary },
    ],
    BIG: [{ x: 2, y: 4, w: 12, h: 3, fill: p.primary }],
  }
  rects.push(...shoulders[bodyType])

  // jersey body + sleeve trim
  rects.push(
    { x: 3, y: 7, w: 10, h: 7, fill: p.primary },
    { x: 3, y: 7, w: 1, h: 7, fill: p.secondary },
    { x: 12, y: 7, w: 1, h: 7, fill: p.secondary },
  )
  return rects
}

/** 6×6 injury cross, bottom-right (§7 overlays). */
export const INJURY_OVERLAY: Rect[] = [
  { x: 10, y: 12, w: 6, h: 2, fill: 'var(--danger)' },
  { x: 12, y: 10, w: 2, h: 6, fill: 'var(--danger)' },
]

/** 5×5 rookie star, top-right (§7 overlays). */
export const ROOKIE_OVERLAY: Rect[] = [
  { x: 13, y: 0, w: 3, h: 1, fill: 'var(--accent)' },
  { x: 12, y: 1, w: 1, h: 1, fill: 'var(--accent)' },
  { x: 14, y: 1, w: 1, h: 1, fill: 'var(--accent)' },
  { x: 11, y: 2, w: 5, h: 1, fill: 'var(--accent)' },
  { x: 12, y: 3, w: 1, h: 1, fill: 'var(--accent)' },
  { x: 14, y: 3, w: 1, h: 1, fill: 'var(--accent)' },
]
