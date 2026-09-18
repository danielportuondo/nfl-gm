/**
 * Constant sweep for the trade AI. The hindsight adversary (scripts/qa/tradeExploit.ts) buys the
 * players the league underrates — mostly young, low-consensus lottery tickets the value curve prices
 * at almost nothing. This sweep asks which constants actually raise the price of that class:
 * `valueConstants.potShareMax` / `potShareFlatAge` (youth premium), `ovrExp` (how steep the curve is
 * below 70), `minPlayerValue`, and `tradeConstants.scale` / `marginByStrictness.strict`.
 *
 *   pnpm tsx scripts/qa/tradeSweep.ts [--season 2015] [--attempts 200]
 *
 * The sweep mutates the constants objects in place between runs; it is a measurement tool, not part of
 * the engine, and it exists so the values committed in constants.ts have evidence behind them.
 */
import { tradeConstants, valueConstants } from '../../src/engine/trade/constants'
import { runExploit, type ExploitArgs } from './tradeExploit'
import { mean, newRealGame, pct, table } from './lib'

interface Knobs {
  label: string
  apply: () => void
}

async function measure(season: number, attempts: number, label: string): Promise<string[]> {
  const args: ExploitArgs = { season, attempts, strictness: 'strict', seed: 'sweep', minP: 0.5 }
  const { state, ctx } = await newRealGame({ season, seed: args.seed, strictness: 'strict' })
  const all = runExploit(state, ctx, args)
  const accepted = all.filter((a) => a.accepted)
  return [
    label,
    String(all.length),
    `${accepted.length}`,
    pct(accepted.length / Math.max(1, all.length), 0),
    mean(all.map((a) => a.p)).toFixed(3),
    mean(accepted.map((a) => a.consensusPaid)).toFixed(1),
    mean(accepted.map((a) => a.trueGained)).toFixed(1),
    accepted.reduce((s, a) => s + a.trueGained, 0).toFixed(0),
  ]
}

async function main(): Promise<void> {
  let season = 2015
  let attempts = 200
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--season') season = Number(argv[++i])
    else if (argv[i] === '--attempts') attempts = Number(argv[++i])
  }

  const base = {
    potShareMax: valueConstants.potShareMax,
    potShareFlatAge: valueConstants.potShareFlatAge,
    ovrExp: valueConstants.ovrExp,
    minPlayerValue: valueConstants.minPlayerValue,
    scale: tradeConstants.scale,
    margins: { ...tradeConstants.marginByStrictness },
  }
  const reset = (): void => {
    valueConstants.potShareMax = base.potShareMax
    valueConstants.potShareFlatAge = base.potShareFlatAge
    valueConstants.ovrExp = base.ovrExp
    valueConstants.minPlayerValue = base.minPlayerValue
    tradeConstants.scale = base.scale
    tradeConstants.marginByStrictness = { ...base.margins }
  }

  const grid: Knobs[] = [
    { label: 'baseline', apply: () => {} },
    { label: 'potShareMax 0.75', apply: () => void (valueConstants.potShareMax = 0.75) },
    { label: 'potShareMax 0.9', apply: () => void (valueConstants.potShareMax = 0.9) },
    { label: 'potShareFlatAge 32', apply: () => void (valueConstants.potShareFlatAge = 32) },
    {
      label: 'potShareMax 0.9 + flatAge 32',
      apply: () => {
        valueConstants.potShareMax = 0.9
        valueConstants.potShareFlatAge = 32
      },
    },
    { label: 'ovrExp 2.8', apply: () => void (valueConstants.ovrExp = 2.8) },
    { label: 'ovrExp 2.4', apply: () => void (valueConstants.ovrExp = 2.4) },
    { label: 'minPlayerValue 2.0', apply: () => void (valueConstants.minPlayerValue = 2.0) },
    { label: 'scale 8', apply: () => void (tradeConstants.scale = 8) },
    { label: 'strict margin 0.30', apply: () => void (tradeConstants.marginByStrictness.strict = 0.3) },
  ]

  const rows: string[][] = [
    ['setting', 'deals', 'accepted', 'accept%', 'mean p', 'consensus paid', 'true gained', 'total true'],
  ]
  for (const knob of grid) {
    reset()
    knob.apply()
    rows.push(await measure(season, attempts, knob.label))
  }
  reset()

  console.log(`\ntrade constant sweep — ${season}, ${attempts} greedy hindsight attempts at "strict"\n`)
  console.log(table(rows))
  console.log('')
}

main().catch((err: unknown) => {
  console.error(`tradeSweep: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  process.exitCode = 1
})
