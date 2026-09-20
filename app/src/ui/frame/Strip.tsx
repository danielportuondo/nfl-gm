import type { ReactNode } from 'react'
import { TeamBadge } from '../primitives'
import { TeamScope, type TeamColors } from '../sprites'
export { type TeamColors } from '../sprites'

export interface StripProps {
  teamAbbr: string
  teamColors: TeamColors
  /** "2013 offseason" during an offseason, "2013" in season (screens/shared/phaseLabel.ts). */
  seasonText: string
  week: number
  phaseLabel: string
  record: string
  capSpaceText: string
  horizonText: string
  /** Only REGULAR/PLAYOFFS have a meaningful week number; the offseason shows the phase label alone. */
  inSeason?: boolean
  /** The one bold moment (docs/DESIGN.md §5.3): reused by the Draft Room, built by a later dispatch. */
  onClock?: boolean
  /** Trailing slot, right-aligned — the theme toggle lives here so it's reachable from every screen. */
  end?: ReactNode
}

/** Sticky scoreboard strip: team plate, season/week, record, cap space, horizon (docs/DESIGN.md §4). */
export function Strip({
  teamAbbr,
  teamColors,
  seasonText,
  week,
  phaseLabel,
  record,
  capSpaceText,
  horizonText,
  inSeason,
  onClock,
  end,
}: StripProps) {
  return (
    <header className={onClock ? 'gg-strip gg-strip--on-clock' : 'gg-strip'}>
      <TeamScope as="span" colors={teamColors} className="gg-strip__item">
        <TeamBadge abbr={teamAbbr} />
      </TeamScope>
      {onClock ? (
        <span className="gg-strip__item gg-strip__clock">ON THE CLOCK</span>
      ) : (
        <>
          <span className="gg-strip__item tabular-nums">
            {seasonText} · {phaseLabel} {inSeason && week > 0 ? `· week ${week}` : ''}
          </span>
          <span className="gg-strip__item tabular-nums">{record}</span>
          <span className="gg-strip__item tabular-nums">{capSpaceText}</span>
          <span className="gg-strip__item tabular-nums">{horizonText}</span>
        </>
      )}
      {end && <span style={{ marginLeft: 'auto', paddingLeft: 'var(--sp-3)' }}>{end}</span>}
    </header>
  )
}
