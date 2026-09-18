import type { CSSProperties, ReactNode } from 'react'
import { pickOnTeamColor } from './colorUtil'

export interface TeamColors {
  primary: string
  secondary: string
}

interface TeamScopeProps {
  colors: TeamColors
  children: ReactNode
  /** Rendered element; a plain wrapper by default so TeamScope never fights the caller's layout. */
  as?: 'div' | 'span'
  className?: string
  style?: CSSProperties
}

/**
 * Sets --team-primary / --team-secondary / --on-team-primary on the nearest ancestor from
 * data.teams[id].colors (docs/DESIGN.md §7). Sprites and plates read these instead of a team id.
 */
export function TeamScope({ colors, children, as = 'div', className, style }: TeamScopeProps) {
  const Tag = as
  const scoped: CSSProperties = {
    ...style,
    // CSS custom properties aren't in the CSSProperties type; cast narrowly at the boundary.
    ['--team-primary' as string]: colors.primary,
    ['--team-secondary' as string]: colors.secondary,
    ['--on-team-primary' as string]: pickOnTeamColor(colors.primary),
  }
  return (
    <Tag className={className} style={scoped}>
      {children}
    </Tag>
  )
}
