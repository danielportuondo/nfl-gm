import { ATTRIBUTION } from '@contracts/index'
import { Panel } from '@ui/primitives'

const DISCLAIMER =
  'Unofficial fan-made project. Not affiliated with or endorsed by the NFL, its teams, or the NFLPA. Data courtesy of nflverse (CC BY 4.0).'

/** Attribution and disclaimer, verbatim from docs/HANDOFF.md §2 (docs/DESIGN.md §11). */
export function About() {
  return (
    <div className="gg-col-8">
      <Panel title="About Gridiron GM" revealIndex={0}>
        <p style={{ fontSize: 'var(--fs-2)', maxWidth: '70ch' }}>{DISCLAIMER}</p>
        <p style={{ fontSize: 'var(--fs-2)', color: 'var(--text-2)', maxWidth: '70ch' }}>
          {ATTRIBUTION}
        </p>
        <p style={{ fontSize: 'var(--fs-2)', maxWidth: '70ch' }}>
          Every player is a team-colored sprite, never a photo or a team logo. Ratings you see are
          what the league believed about a player at the time — nobody in the game, including you,
          sees the future.
        </p>
      </Panel>
    </div>
  )
}
