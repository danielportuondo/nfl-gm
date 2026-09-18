/**
 * Market-curve sweep for engine/fa (§6.6).
 *
 *   pnpm exec tsx scripts/qa/faSweep.ts [--season 2023] [--teams 8]
 *
 * Two things the market curve controls and one exploit it enables:
 *
 *   payroll   league mean payroll as a share of the cap. Real NFL teams sit at 95–100 %; a curve that
 *             underprices veterans leaves the whole league with fake cap room.
 *   ask/apy   the ratio of what a veteran asks to re-sign for to what he is already paid. When this is
 *             well below 1 for the biggest contracts, cutting a star and signing him straight back is
 *             free money (`faExploit.ts` probe 3).
 *   churn     mean year-1 saving from cut-and-re-sign over each team's twelve biggest contracts.
 *             Positive = an exploit; negative = a tax, which is what §6.6's "simple, discourages
 *             hoarding" dead-money rule is supposed to produce.
 */
import { TEAM_IDS, type EngineContext, type LeagueState, type TeamId } from '../../src/contracts/index'
import { faConstants } from '../../src/engine/fa/constants'
import { mean, newRealGame, table } from './lib'

interface Knob {
  label: string
  topCapPct: number
  valueExp: number
  deadMoneyPct: number
}

function payrollShare(state: LeagueState, ctx: EngineContext): { mean: number; min: number; max: number } {
  const cap = ctx.modules.fa.capFor(state.season, ctx)
  const shares = TEAM_IDS.map((t) => ctx.modules.fa.payroll(state, t) / cap)
  return { mean: mean(shares), min: Math.min(...shares), max: Math.max(...shares) }
}

/** Year-1 saving from cutting a big contract and re-signing the same player at his market ask. */
function churn(state: LeagueState, ctx: EngineContext, teams: readonly TeamId[]): { saving: number; askOverApy: number; exploitable: number; n: number } {
  const { fa } = ctx.modules
  const savings: number[] = []
  const ratios: number[] = []
  let exploitable = 0
  for (const team of teams) {
    const big = [...(state.teams[team]?.roster ?? [])]
      .filter((s) => s.contract.years >= 2 && s.contract.apy > 3)
      .sort((a, b) => b.contract.apy - a.contract.apy)
      .slice(0, 12)
    for (const slot of big) {
      const c = slot.contract
      const dead = c.apy * c.years * c.guaranteedPct * faConstants.deadMoneyPct
      const ask = fa.resignAsk(fa.release(state, team, slot.playerId, ctx), slot.playerId, ctx)
      const net = c.apy - dead - ask
      savings.push(net)
      ratios.push(ask / Math.max(0.01, c.apy))
      if (net > 0) exploitable++
    }
  }
  return { saving: mean(savings), askOverApy: mean(ratios), exploitable: exploitable / Math.max(1, savings.length), n: savings.length }
}

async function main(): Promise<void> {
  let season = 2023
  let teamCount = 8
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--season') season = Number(argv[++i])
    else if (argv[i] === '--teams') teamCount = Number(argv[++i])
  }
  const { state } = await newRealGame({ season, userTeam: 'IND', seed: 'fasweep' })
  const teams = TEAM_IDS.slice(0, teamCount)

  const base: Knob = {
    label: 'baseline',
    topCapPct: faConstants.topCapPct,
    valueExp: faConstants.valueExp,
    deadMoneyPct: faConstants.deadMoneyPct,
  }
  const grid: Knob[] = [
    base,
    { label: 'topCapPct 0.20', topCapPct: 0.2, valueExp: base.valueExp, deadMoneyPct: base.deadMoneyPct },
    { label: 'valueExp 2.1', topCapPct: base.topCapPct, valueExp: 2.1, deadMoneyPct: base.deadMoneyPct },
    { label: 'topCapPct 0.20 + exp 2.1', topCapPct: 0.2, valueExp: 2.1, deadMoneyPct: base.deadMoneyPct },
    { label: 'topCapPct 0.22 + exp 2.0', topCapPct: 0.22, valueExp: 2.0, deadMoneyPct: base.deadMoneyPct },
    { label: 'baseline + deadPct 0.40', topCapPct: base.topCapPct, valueExp: base.valueExp, deadMoneyPct: 0.4 },
    { label: 'exp 2.1 + deadPct 0.40', topCapPct: base.topCapPct, valueExp: 2.1, deadMoneyPct: 0.4 },
  ]

  const rows: string[][] = [['setting', 'payroll/cap', 'min', 'max', 'ask / current apy', 'churn saving $M', '% profitable']]
  for (const knob of grid) {
    faConstants.topCapPct = knob.topCapPct
    faConstants.valueExp = knob.valueExp
    faConstants.deadMoneyPct = knob.deadMoneyPct
    // Payroll is measured on a league rebuilt with this curve, since newGame synthesizes every deal.
    const fresh = await newRealGame({ season, userTeam: 'IND', seed: 'fasweep' })
    const share = payrollShare(fresh.state, fresh.ctx)
    const c = churn(fresh.state, fresh.ctx, teams)
    rows.push([
      knob.label,
      `${(100 * share.mean).toFixed(0)}%`,
      `${(100 * share.min).toFixed(0)}%`,
      `${(100 * share.max).toFixed(0)}%`,
      c.askOverApy.toFixed(2),
      c.saving.toFixed(2),
      `${(100 * c.exploitable).toFixed(0)}%`,
    ])
  }
  faConstants.topCapPct = base.topCapPct
  faConstants.valueExp = base.valueExp
  faConstants.deadMoneyPct = base.deadMoneyPct

  console.log(`\nfa market-curve sweep — ${season}, churn over ${teams.length} teams' twelve biggest deals\n`)
  console.log(table(rows))
  console.log('\n  real NFL payroll/cap ≈ 95–100 %; churn saving should be <= 0 for the exploit to be closed.')
  console.log(`  (state loaded once for reference: ${Object.keys(state.players).length} players)\n`)
}

main().catch((err: unknown) => {
  console.error(`faSweep: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exitCode = 1
})
