import type { CSSProperties, ReactNode } from 'react'

export interface PanelProps {
  title?: string
  action?: ReactNode
  variant?: 'default' | 'sunken' | 'plate' | 'attention'
  /** DOM order index for the page-load "lights on" reveal (docs/DESIGN.md §5.1). Omit to skip. */
  revealIndex?: number
  className?: string
  children: ReactNode
  id?: string
}

/** The magnet-tile panel: raised, hard-shadowed, header + body (docs/DESIGN.md §8). */
export function Panel({ title, action, variant = 'default', revealIndex, className, children, id }: PanelProps) {
  const classes = ['gg-panel']
  if (variant !== 'default') classes.push(`gg-panel--${variant}`)
  if (revealIndex != null) classes.push('gg-reveal')
  if (className) classes.push(className)
  const style: CSSProperties | undefined = revealIndex != null ? { ['--i' as string]: revealIndex } : undefined
  return (
    <section className={classes.join(' ')} style={style} id={id}>
      {title && (
        <header className="gg-panel__header">
          <h3 className="gg-panel__title">{title}</h3>
          {action}
        </header>
      )}
      <div className="gg-panel__body">{children}</div>
    </section>
  )
}
