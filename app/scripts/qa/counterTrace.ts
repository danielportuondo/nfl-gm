/** Phase 6 trace: where does counterFor exit for declined USER deals across a p range? */
import type { TradeProposal } from '../../src/contracts/index'
import { aiTeams, newRealGame } from './lib'
import { acceptanceConstants } from '../../src/engine/trade/constants'

async function main(): Promise<void> {
  const strictness = (process.argv[2] ?? 'balanced') as
    'lenient' | 'balanced' | 'strict' | 'ruthless'
  const { state, ctx } = await newRealGame({ season: 2015, seed: 'ctrace', strictness })
  const exits: Record<string, number> = {}
  const bump = (k: string) => (exits[k] = (exits[k] ?? 0) + 1)
  const user = state.teams[state.userTeam]!.roster.map((r) => r.playerId).sort(
    (a, b) => state.scouting[b]!.ovr - state.scouting[a]!.ovr,
  )
  let n = 0
  for (const ai of aiTeams(state).slice(0, 16)) {
    const theirs = state.teams[ai]!.roster.map((r) => r.playerId).sort(
      (a, b) => state.scouting[b]!.ovr - state.scouting[a]!.ovr,
    )
    for (let i = 0; i < 12; i++) {
      for (let j = i; j < Math.min(theirs.length, i + 6); j++) {
        const proposal: TradeProposal = {
          id: `ct-${n++}`,
          offer: { teamId: state.userTeam, players: [user[j]!], picks: [] },
          request: { teamId: ai, players: [theirs[i]!], picks: [] },
          initiatedBy: 'USER',
          season: state.season,
          week: state.week,
        }
        const ev = ctx.modules.trade.evaluate(state, proposal, ctx)
        if (!ev.valid) {
          bump('invalid')
          continue
        }
        if (ev.p >= 0.5) {
          bump('p>=0.5 (no counter by design)')
          continue
        }
        const shortfall = ev.valueOut + ev.needAdj + ev.margin - ev.valueIn
        if (shortfall > acceptanceConstants.counterMaxShortfallPct * Math.max(1, ev.valueOut)) {
          bump('shortfall > maxPct')
          continue
        }
        const rng = ctx.modules.rng.fromSeed(state.seed, state.season, 'ct', String(n))
        const out = ctx.modules.trade.submit(state, proposal, ctx, rng)
        if (out.accepted) {
          bump('accepted by luck')
          continue
        }
        bump(out.counter ? 'COUNTERED' : 'eligible but no counter')
        if (!out.counter && (exits['eligible but no counter'] ?? 0) <= 3) {
          console.log('  no-counter example', {
            p: ev.p.toFixed(3),
            valueIn: ev.valueIn.toFixed(1),
            valueOut: ev.valueOut.toFixed(1),
            needAdj: ev.needAdj.toFixed(1),
            margin: ev.margin.toFixed(1),
            shortfall: shortfall.toFixed(1),
          })
        }
      }
    }
  }
  console.log(strictness, exits)
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
