/**
 * Mock-league injury rates against `injuryConstants.rateScale`. The unit test in
 * tests/engine/sim/injuries.test.ts asserts BOTH rows land in 0.6-1.6, which the fitted duration mix
 * (62.8 % one-week) makes impossible; this prints the trade-off.
 */
import { mockLeague } from '../../tests/fixtures/mockLeague'
import { makeCtx, runSeason } from '../../tests/engine/sim/harness'
import { injuryConstants } from '../../src/engine/sim/constants'
const ctx = makeCtx()
for (const scale of [2.8, 2.0, 1.8, 1.6]) {
  injuryConstants.rateScale = scale
  const t = runSeason(
    mockLeague({ seed: 'inj-on', season: 2021, settings: { injuries: true } }),
    ctx,
  )
  console.log(
    scale,
    'total',
    (t.injuries / t.teamGames).toFixed(3),
    'multiWeek',
    (t.multiWeekInjuries / t.teamGames).toFixed(3),
  )
}
