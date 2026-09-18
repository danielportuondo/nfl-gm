import type { Position } from '@contracts/index'

interface PositionBadgeProps {
  pos: Position
}

export function PositionBadge({ pos }: PositionBadgeProps) {
  return <span className="gg-badge gg-badge--position">{pos}</span>
}

interface TeamBadgeProps {
  abbr: string
}

/** Requires an enclosing <TeamScope> for --team-primary/--team-secondary/--on-team-primary. */
export function TeamBadge({ abbr }: TeamBadgeProps) {
  return <span className="gg-badge gg-badge--team">{abbr}</span>
}

interface StatusBadgeProps {
  status: 'rookie' | 'injured' | 'expiring'
}

const STATUS_LABEL: Record<StatusBadgeProps['status'], string> = {
  rookie: 'Rookie',
  injured: 'Injured',
  expiring: 'Expiring',
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`gg-badge gg-badge--${status}`}>{STATUS_LABEL[status]}</span>
}
