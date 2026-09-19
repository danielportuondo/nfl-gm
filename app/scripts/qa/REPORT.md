# Phase 5B — balance and exploit report

Measured on the Phase 5 data (`6e82786`), 200-sim calibration, 6-season headless runs. Scripts in this
directory reproduce every number; they read `state.truth` on purpose (adversary role) and never ship.

```sh
cd app
pnpm calibrate -- --season 2015 --sims 200
pnpm exec tsx scripts/qa/simSweep.ts     --sims 150 --mode all
pnpm exec tsx scripts/qa/tradeExploit.ts --season 2015 --attempts 200 --strictness strict
pnpm exec tsx scripts/qa/draftExploit.ts --season 2015 --team IND --strictness strict
pnpm exec tsx scripts/qa/faExploit.ts    --season 2023 --team SEA
pnpm exec tsx scripts/qa/faSweep.ts      --season 2023 --teams 10
pnpm exec tsx scripts/qa/leagueHealth.ts --team SEA --start 2023 --seasons 5
pnpm exec tsx scripts/qa/injProbe.ts
```

## Constants changed

| file | constant | before | after | evidence |
| --- | --- | --- | --- | --- |
| `sim/constants.ts` | `simConstants.k` | 2.5 | 2.1 | sd(wins) 2015 3.35→3.10, 2023 3.51→3.26; corr(real) unchanged 0.857/0.853 |
| `sim/constants.ts` | `injuryConstants.rateScale` | 2.8 | 1.6 | injuries/team-game 2.87→1.64, multi-week 1.06→0.61; only value inside 0.6–1.6 for both |
| `sim/constants.ts` | `scoreConstants.otWindow` | 1 | 1.3 | OT 4.82 %→5.84 % (real ≈6 %) |
| `sim/constants.ts` | `scoreConstants.oneMarginFixP` | 0.72 | 0.38 | 1-point games 1.00 %→≈2.0 % (real ≈2 %) |
| `trade/constants.ts` | `tradeConstants.futurePickDiscount` | 0.85 | 0.92 | cross-year pick hoarding: free chart points 157→77, trade-down ladder 7 steps→0 |
| `fa/constants.ts` | `faConstants.acceptance` (new) | slope 3, bias 0 | `{askSlope 8, atAskBias 1.1, qualityWeight 1}` | at-ask acceptance 38–48 % → 0.75 for an average team |
| `fa/constants.ts` | `faConstants.rookieGuaranteedPctByRound` (new) | all 1 | `[1, 1, .6, .35, .2, .1, .1]` | SEA 2024 cutdown dead money $8.3M → $5.8M, IND 2013 $5.1M → $4.1M |

`draft/`, `lifecycle/`, `league/` constants untouched — no measurement justified moving them.

## Calibration vs §6.3 (200 sims, after)

| season | corr(real) | sd(wins) | home % | total | tie % | OT % | 1-pt % | inj/tg | multi-wk/tg |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2012 | 0.698 | 3.22 | 54.8 | 45.7 | 0.20 | 6.54 | 1.97 | 1.65 | 0.61 |
| 2015 | 0.864 | 3.08 | 55.0 | 45.7 | 0.20 | 6.43 | 2.04 | 1.64 | 0.61 |
| 2016 | 0.603 | 3.27 | 54.8 | 45.6 | 0.22 | 6.28 | 1.81 | 1.61 | 0.60 |
| 2019 | 0.758 | 3.14 | 54.6 | 45.6 | 0.45 | 6.31 | 2.14 | 1.60 | 0.60 |
| 2023 | 0.837 | 3.28 | 55.4 | 45.6 | 0.47 | 6.55 | 2.02 | 1.61 | 0.60 |

Before: sd(wins) 3.32–3.52, OT 4.6–4.9 %, 1-pt 0.85–1.0 %, injuries 2.80–2.88. Truth fallbacks 0 everywhere.

### 2016 correlation
`corr(team strength, real wins)` is the ceiling the sim can reach (it reproduces its own ratings at 0.98):
2010 0.817, 2011 0.740, 2012 0.687, 2013 0.710, 2014 0.881, 2015 0.857, 2016 0.617, 2017 0.763, 2018 0.783,
2019 0.733, 2020 0.864, 2021 0.791, 2022 0.833, 2023 0.812, 2024 0.834. 2016 delivers 0.603 against a 0.617
ceiling — a property of `state.scouting` (the ratings model), not of any sim constant. 2016 is also where the
nflverse roster files double (free-agent pool 330 → 1,181), which changes the ratings model's normalisation pool.

### Injuries — the two written targets are mutually exclusive
`ratePerPlayerGame` averages 0.022 × 46 active = 1.02 injuries per team-game unscaled; the fitted duration mix
is 62.8 % one-week, so multi-week is always 0.372 × total. Total ≤ 1.6 needs `rateScale` ≤ 1.58; multi-week
≥ 0.6 needs ≥ 1.61. 1.6 is the closest point. The shipped 2.8 read §6.3's "1–1.5 multi-week per team per week"
literally, which forces the total to 2.9.

## sd of wins
| k | 2015 | 2023 | corr 2015 | corr 2023 |
| --- | --- | --- | --- | --- |
| 2.5 | 3.35 | 3.51 | 0.857 | 0.854 |
| 2.1 | 3.10 | 3.26 | 0.858 | 0.853 |
| 1.9 | 2.97 | 3.12 | 0.857 | 0.851 |

"Procedural is worse" is mostly sampling noise: sd(team overall) is 2.4–3.2 in history and 2.0–3.2
procedurally; one 32-team season carries ≈ ±0.4 sampling sd on sd(wins). Realised after the change: IND
2012–2017 2.73–3.53 (was 3.10–3.69), SEA 2023–2027 3.10–3.53 (was 3.46–3.78).

## Dead money — the Phase 4 follow-up no longer reproduces at scale
| run | camp roster | cuts | dead money | % of cap |
| --- | --- | --- | --- | --- |
| IND 2012 → 2013 preseason | 70 | 17 | $5.1M | 4.1 % |
| SEA 2023 → 2024 preseason | 75 | 22 | $8.3M | 3.2 % |
| headless IND 2012–2017 (user) | — | — | $0.0–4.6M/season | 1.4–3.7 % |
| headless SEA 2023–2027 (user) | — | — | $0.0, 7.8, 9.5, 28.2, 49.4M | up to 15.7 % |

Cutting a camp roster is cheap; the big numbers appear past the data where the scripted GM signs 13–23
multi-year free agents and then cuts some. `deadMoney` is zeroed at the rollover (`fa/index.ts` rollover), so
nothing accumulates. Rookie deals were the biggest line in both cutdowns ($5.7M of SEA's $8.3M) — hence
`rookieGuaranteedPctByRound` (applied by the orchestrator, with slot-based pricing for rookies without a salary).

## Free agency
`acceptProbability` was `sigmoid(3(ratio−1) + (quality−0.5))`: an at-ask offer from an average team was
exactly 0.50 by construction. Measured over 120 pool players: 0.85 → 34/32 %, 1.00 → 47.5/38.3 %,
1.10 → 59/52 %, 1.40 → 72/70 % (IND 2013 / SEA 2024). New curve `sigmoid(8(ratio−1) + 1.1 + (quality−0.5))`:
0.85 → 0.48, 0.95 → 0.66, 1.00 → 0.75, 1.10 → 0.87, 1.20 → 0.94 for an average team.

Cut-and-re-sign churn is a tax on average (mean year-1 saving −$1.42M IND 2013, −$0.43M SEA 2024 over the 12
biggest contracts) but 4 of SEA's 12 are profitable (worst +$6.8M/yr): always a real contract whose APY sits far
above the synthesized market curve. Churn is fully closed at a new game (0 % profitable on 2012/2019/2023) and
opens only after a season of progression. Bid-at-ask farming cannot build a super-roster: `fa.offer` hard-gates
on roster size and cap, and the pool past the top ~60 is replacement level.

Market curve — recommended, not applied: league mean payroll is 73–77 % of the cap (real ≈ 95–100 %).
`valueExp 2.1` lifts it to 84–87 %, but a 2023-era team whose real contracts already fill the cap then has
nothing (SEA 2024 cutdown 22 cuts/$8.3M → 30 cuts/$37.7M; 0/120 bids clear the cap gate). Take `valueExp 2.1`
only together with a re-tune of `fitPayrollToCap`'s 97 % target and the scripted GM's cap reserve. `topCapPct`
should not move alone (raises every re-sign ask 17–30 %).

## Exploits
### Trade AI at "strict", 200 hindsight-informed attempts
| metric | 2015 | 2019 |
| --- | --- | --- |
| attempts with a plausible deal | 88/200 | 94/200 |
| accepted | 55 (62.5 %) | 60 (63.8 %) |
| mean p submitted | 0.644 | 0.632 |
| pooled consensus surplus (§6.5 bar ≤ 15 %) | −76.1 % | −83.4 % |
| pooled true surplus | +55.1 % | +11.0 % |
| true value points gained / trade | 9.0 | 2.3 |

To buy the players history says are underrated the user overpays 76–83 % on the league's own books; what comes
back (+9.0 / +2.3 true points per trade; an ovr-75 starter ≈ 21) is the hindsight premium the game is built on.
Annoyance works: 12 identical lowballs drive p 0.050 → 0.031 and the counter to its cap of 10.

### Draft
| probe | discount 0.85 | discount 0.92 |
| --- | --- | --- |
| free chart points, this-year picks → next-year picks | 157 (7 upgrades, all p = 0.50) | 77 |
| trade-down ladder | 7 steps, +23 pts | 0 steps |
| top-20 slots buyable at p ≥ 0.5 for the biggest hindsight gem | 0 | 0 |

The ladder is a non-exploit (+23 on 2,215 = 1 %). Cross-year pick hoarding was the real hole: at 0.85 the user
could convert his whole draft into next year's picks at p = 0.50 and bank half a first per season.

### Six-season runs
Rosters 53 for all 32 teams every season; both runs `invariants: ok`. Payroll league mean 73–82 % of cap (the
one real implausibility). Generated share of rostered players 0 % in history, 18 % / 28 % in the first two
procedural seasons. Procedural rookie classes n 401–411, consensus ovr p10 43 / med 60 / p90 68 vs pre-2016 real
n 389–396, p10 47 / med 60 / p90 67. Roster turnover ≈ 20 %/season, plausible; a clean retirement count needs
`lifecycle.retirements` instrumented.

## Logic findings
1. `tests/engine/sim/injuries.test.ts` asserted total and multi-week both in 0.6–1.6, impossible under the
   fitted mix. Relaxed by the orchestrator to multi-week 0.35–0.8.
2. `fa.synthesizeContract` priced a player still on his rookie deal off the veteran market curve when the
   roster entry had no APY (Tariq Woolen at $16.1M APY, $8.1M dead to cut). Fixed by the orchestrator: falls back
   to `rookieContract(slot).apy`.
3. Rookie contracts were 100 % guaranteed at every pick. Fixed (`rookieGuaranteedPctByRound`).
4. `acceptProbability` had no tunable. Fixed (`faConstants.acceptance`).
5. The trade AI never counters — 0 counters across 400 submitted deals and the draft probes, though §6.5
   promises one. Gate is presumably `counterMinP 0.5` / `counterMaxShortfallPct 0.6` / `counterCandidatesScanned 6`;
   trace before assuming the numbers are wrong. **Closed in Phase 6:** `scripts/qa/counterTrace.ts` submits
   ~1,150 one-for-one deals across 16 teams in 2015; of the 283 declined deals with p < 0.5 and a shortfall
   inside `counterMaxShortfallPct`, the AI countered 239 (84%). The zero here was methodological — this
   script only submits deals with p ≥ 0.5, where the shortfall is ≤ 0 and no counter is owed, and the
   lowball probe exceeds the 60% shortfall cap. The real gap was the store: `proposeTrade` discarded
   `outcome.counter`, so no user ever saw one. Counters now land in the Trade Center's incoming offers.
6. `tests/engine/sim/harness.ts#runSeason` never applies the injury events it counts — every game is simulated
   off the week-0 roster, so `rateScale` has no effect on the calibration table's sd(wins). Calibration
   understates a played season's variance. **Closed in Phase 6:** `runSeason` now simulates week by week
   and runs `lifecycle.applyInjuryEvents` + `tickInjuries` between weeks, as `league.simWeek` does.
   Effect on the 2015 table: sd(wins) 3.09 → 3.07, win corr (real) 0.86 unchanged — injuries hit
   every team about equally, so they add noise per season, not spread across teams.
7. `scripts/calibrate.ts` printed the 0.6–1.6 target on both injury rows; the multi-week row now prints its own.

## Open questions
- Is §6.3's "~1–1.5 multi-week injuries per team per week" or the harness's 0.6–1.6 total band authoritative?
  They are mutually exclusive under the fitted duration mix.
- Is a league-mean payroll of 73–77 % of the cap acceptable for v1? Fixing it is `valueExp 2.1` plus a re-tune
  of `fitPayrollToCap` and the scripted GM's cap reserve.
- `futurePickDiscount 0.92` is a compromise: any value below 1.0 is free money for a user with no time pressure.
