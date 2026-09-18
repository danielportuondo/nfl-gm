import type { Rect } from './shapes'

interface PixelSvgProps {
  rects: Rect[]
  size: 2 | 4 | 6
  title?: string
}

/** Shared 16×16 crisp-edge pixel canvas (docs/DESIGN.md §7). Never a non-integer scale. */
export function PixelSvg({ rects, size, title }: PixelSvgProps) {
  const px = 16 * size
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
      ))}
    </svg>
  )
}
