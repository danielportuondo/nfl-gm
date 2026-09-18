export interface StatTileProps {
  value: string | number
  label: string
  tone?: 'default' | 'danger' | 'positive'
}

/** A number in Pixelify with a Barlow label under it. No gradient, no icon (docs/DESIGN.md §8). */
export function StatTile({ value, label, tone = 'default' }: StatTileProps) {
  const valueClass = tone === 'default' ? 'gg-stat-tile__value' : `gg-stat-tile__value gg-stat-tile__value--${tone}`
  return (
    <div className="gg-stat-tile">
      <span className={valueClass}>{value}</span>
      <span className="gg-stat-tile__label">{label}</span>
    </div>
  )
}
