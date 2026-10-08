# Decisions log

Append-only. Each entry: date, phase, decision, why. Locked decisions in `docs/HANDOFF.md` §2 are not
re-opened here; this log records the choices made while building within them.

## 2026-09-17 — Phase 0

- **Repo root is `nfl-gm/`** (the existing GitHub repo), not `gridiron-gm/` as drawn in HANDOFF §3. Layout inside is as specified. Vite `base` is `/nfl-gm/` when `GITHUB_PAGES` is set.
- **Canonical `TeamId` = the franchise's current nflverse code** (`LAR`, `LAC`, `LV`, `WAS`…), stable across relocations. Historical codes map through `TEAM_ALIASES` in `app/src/contracts/teams.ts`. Era-correct city/name for display comes from `TeamInfo.eras`.
- **Zod schemas are the single source of truth** (`app/src/contracts/schemas.ts`). Domain TS types are inferred from them; JSON Schema (draft 2020-12) is generated with zod 4's native `z.toJSONSchema` into `app/src/contracts/schemas/*.schema.json`, which the Python pipeline validates against. `docs/ENGINE_CONTRACT.md` is generated from the contract sources. A test fails when either artifact is stale.
- **Engine modules are objects of pure functions** injected through `EngineContext.modules`, with `notImplemented` stubs exported from the contracts. This lets each fan-out agent test against stubs and avoids import cycles between engine folders.
- **`LeagueState.truth` stays in state** (per §6.1) but the save/data schemas carry it in a clearly named field, ESLint `no-restricted-properties`/`no-restricted-imports` block it under `screens/` and `ui/`, and `tests/truthIsolation.test.ts` greps for it.
- **Season data loading is explicit**: `EngineContext.seasonData(season)` returns the loaded chunk; for an in-history season that is not loaded the engine must throw `SeasonNotLoadedError` rather than silently going procedural. The store preloads the next season before `advancePhase`.
- **Initial-load budget interpretation**: "initial load ≤ 1.5 MB gz" = app shell + static files (`manifest`, `teams`, `cap`, `curves`, `injuryModel`). `trajectories.json` (<3 MB gz) and the start-season chunk load on New Game.
- **Toolchain versions**: pnpm 12, Node 25 locally / 22 in CI, TypeScript 6.0 (TS 7 was installed first but typescript-eslint does not support it yet; TS 6 also removes `baseUrl`, so `paths` are relative), Vite 8, Vitest 5, ESLint 10 flat config, zod 4, React 19, zustand 5, idb 8. Python pinned to 3.12 via `pipeline/.python-version`; pandas 3 (copy-on-write, string dtype by default — agents beware).
- **Fonts**: `@fontsource-variable/pixelify-sans` and `@fontsource/barlow` are installed so `ui-builder` can self-host the two faces chosen in `docs/DESIGN.md` without a dependency request.
- **Pre-installed for later phases** (agents may not add dependencies): `zustand`, `idb`, `@testing-library/*`, `jsdom`, `tsx`. Playwright is added by the orchestrator at Phase 5.
- **Subagents do not commit.** The orchestrator commits after each fan-out; concurrent agents committing on one working tree would fight over the index.
- **1B (ratings-model) does its own ingest** into the shared `pipeline/.cache/` using the same URL table as 1A, rather than waiting on 1A's first commit (HANDOFF §7 Phase 1 note, "prefer the latter").
- **Fable is available**, so `.claude/settings.json` uses `fable[1m]` as written in §5.1; `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` is set through the settings `env` block.

## 2026-09-17 — Phase 1 (fan-out #1)

- **Real data exported for 2010–2025** (68 files, ~2.4 MB gzipped total; each season chunk ≤ 170 KB gz). `latestRealSeason = 2025`; the in-progress 2026 season is excluded.
- **Ratings model results**: starter true value vs real point differential correlates 0.83–0.90 per season 2012–2023 (target 0.55). QB value leans 20% on APY-percentile-within-contract-cohort, down-weighted by experience so rookie scale cannot leak draft slot into truth. Career outcome columns (`w_av`, `probowls`, `allpro`) were not needed. Normalization pool = players with ≥ 1 game (nflverse added practice-squad rows in 2016). `classSize.udfa` = 146 (empirical), not the handoff's ~200.
- **Pipeline placeholder mode**: `make data --allow-placeholder-ratings` exists for running ingest/export without the model; the placeholders set `ovr == trueValue` and must never ship. Phase 1 data was re-exported with the real consensus parquets before commit.
- **nflverse team codes** are inconsistent across files (ARZ/BLT/CLV/HST/SL, GNB/KAN/LVR/NOR/NWE/SDG/SFO/TAM); `pipeline/.../build/teams.py` carries a superset of the app's `TEAM_ALIASES`. Candidate to fold back into `contracts/teams.ts` in Phase 2.
- **League loop conventions** (league-engine): `TeamState.record` resets at the TRAINING_CAMP → PRESEASON rollover; `advancePhase` throws during REGULAR/PLAYOFFS (only `simWeek` advances those); the caller (store/headless) runs `draft.startDraft`/`autoDraftToEnd` between `advancePhase(OFFSEASON_RESIGN)` and `advancePhase(DRAFT)`; in-season AI trade offers surface as `WeekReport.events` only — no persisted field for pending in-season offers yet.
- **Sim constants** on the mock league: `k = 2.5`, `hfa 2.0`, `marginSd 13.5`, `tieP 0.07` conditional on OT (×0.45 pre-2017), injury `rateScale 2.8`. To be re-tuned on real 2015 data in Phase 2.
- **UI**: theme toggle lives in a trailing slot on the Strip on every in-game screen (to be codified in DESIGN.md §4). Later screens extend `NAV_ITEMS` in `App.tsx`.

### Follow-ups for Phase 2 (integration)
- Fix `tests/fixtures/mockLeague.ts#roundRobin` home/away imbalance (some teams never host), then re-tune `k`.
- `injuryModel.permanentLoss.lossRange` exported as `[5, 20]` (placeholder guess) — spec says 1–3 points; fix in `build/injury.py`.
- Low-priority contract request from sim: `PlayerGameLine` cannot express safeties, two-point conversions, or defensive/return TDs, so reconstructed box points fall 2–8 short of the team score in ~25% of team-games.
- `originalTeam` in draft order equals `team` (nflverse has no original-team column); combine values are raw numbers, not percentiles.
- Add the Strip theme-toggle slot to DESIGN.md §4.
- **CI fixes after Phase 1**: `pnpm/action-setup` must not receive a `version` when `package.json` declares `packageManager`; pnpm 12 fails non-interactive installs with `ERR_PNPM_IGNORED_BUILDS` unless build scripts are approved via `allowBuilds` in `pnpm-workspace.yaml` (the `pnpm` field in `package.json` and `onlyBuiltDependencies` are not honored). Only `esbuild` needs approval. `make data` is now strict (requires the model parquets); `make data-placeholder` is the development-only escape hatch.

## 2026-09-18 — Phase 2 (integration #1)

- **`rosters.json` is the opening-day 53.** nflverse `roster_{season}.csv` is a season-level snapshot (one row per player-team stint, `status` = final status with that team), so the Phase 1 export listed every stint: 78–113 players per season sat on two rosters at once and teams carried 59–110 players. The pipeline now fills `ROSTER_TEMPLATE_53` per team from each player's season-start stint by depth rank, tops up by depth/status/snaps/experience, and sets `players.json.team` from roster membership (`null` → the engine's free-agent pool: 324–368 players in 2010–2015, 1,264–1,519 from 2016 when nflverse's roster files roughly doubled). Every team, every season, exports exactly 53. `DATA_CONTRACT.md` documents the rule; `test_opening_day_rosters_are_legal` and `tests/integration/realData.test.ts` enforce it on both sides.
- **Draft-year convention.** The draft run in season S's DRAFT phase is the S+1 class: `DraftPick.season`, `draftRoom.season` and the chunk read by `buildDraftOrder`/`loadProspects` are all S+1. `league.newGame(S)` therefore owns picks for S+1 and S+2 (was S and S+1, which re-drafted rookies already on the rosters). Loaders preload S..S+2 for a new game and season+1..season+3 ahead of each `advancePhase`.
- **`fa.runAiCutdowns` added to the contract** and called by `league.advancePhase(PRESEASON)` before `validateRoster`: offseason rosters swell to 90 and something has to bring AI teams back to 53 (history-anchored to the real opening-day roster when in history). The user's team is never cut automatically; the transition throws with the problem list instead.
- **`PlayerGameLine` gained `twoPt`, `defTd`, `retTd`, `safeties`** (all optional) so the sim can make box points sum to the team score (Phase 1D contract request). Sim does not populate them yet — Phase 5B's box-score pass.
- **Team codes folded.** `TEAM_ALIASES` in `contracts/teams.ts` now carries the pipeline's superset (ARZ/BLT/CLV/HST/SL, GNB/KAN/LVR/NOR/NWE/SDG/SFO/TAM, PHO/RAI/RAM); `build/teams.py` mirrors it exactly again.
- **Phase 2 scaffold modules** live at `app/src/engine/{draft,trade,fa,lifecycle,history}/index.ts`: `{ ...stub, <the few functions the season loop needs> }` with a header naming the Phase 3 agent that replaces the file. fa: cap lookup, payroll, contract synthesis from hints (a $0 hint counts as absent), size-only `validateRoster` (46–53 from PRESEASON through PLAYOFFS, ≤90 otherwise; cap reported, not enforced), value-based `runAiCutdowns`. draft: `buildDraftOrder` (real order from the chunk with in-game owners applied; post-history reverse standings with `pick: null`), `room`. trade: `generateAiOffers → []`. lifecycle: `applyInjuryEvents`, `tickInjuries` (no permanent loss yet), `age`. history: divergence set ops. Everything else still throws `NotImplementedError`, so `headless --seasons 2` stops at `fa.runAiResign` by design. `app/src/engine/index.ts` assembles `engineModules`; the store's defaults come from there, so Phase 3 modules wire in by replacing files.
- **Store boots on real data.** In the browser the singleton store runs in engine mode over `HttpDataSource(BASE_URL + 'data')`: static files load at creation (`dataStatus` loading/ready/error), season chunks and trajectories load on demand into the store's closure (never into state), `newGame` is async with `busy.newGame`. Under Node it stays in mock mode so importing it never fetches. Bundle: 127 KB gz (was 113) — the engine now ships in the app.
- **Real-data harnesses.** `scripts/lib/publicData.ts` reads `app/public/data` into a validated `EngineContext`; `calibrate --season 2015` compares simulated mean wins with the real standings; `headless --team IND --start 2015 --seasons N` plays seasons and checks roster/result/truth invariants. Results on real 2015 (200 sims, current constants `k = 2.5`, `hfa 2.0`, `σ 13.5`): win correlation vs real 0.87 (target ≥ 0.5; vs rating 0.99), sd of wins 3.30 (band 2.4–3.6; real 2015 was ≈ 3.0), home win 54.7 %, mean total 45.7, ties 0.17 %, OT 4.6 %, multi-week injuries 1.07 per team-game, truth fallbacks 0, one season in 0.2 s. Not grossly off → constants left for Phase 5B; sd of wins slightly wide and OT rate slightly low are the first things to look at.
- **Calibration harness rows.** The "injuries / team-game" row (2.9 on real data) counts one-week injuries too; the §6.3 target ("~1–1.5 multi-week injuries per team per week") is the "multi-week / team-game" row. The total row's 0.6–1.6 band is informational.

### Follow-ups for Phase 3 / 4
- `RosterEntry` could carry a `signedSeason` hint (OTC `year_signed`) so 3C can compute years *remaining* instead of treating the hint's total length as remaining; hints also reach 10 years (schema max 7) and are occasionally $0.
- `manifest.sizesBytes` omits `curves.json` and `trajectories.json` (written by the model export, not the season exporter) — 5C's size check must add them.
- Players on injured reserve at week 1 are cut from the opening 53 like everyone else and start as free agents; their season true value comes from whatever the ratings model assigned for a season they did not play. Revisit with 3D if it shows.
- 3A: `fakeDraft.startDraft` in `tests/engine/fakes.ts` still reads the S chunk, not S+1 — harmless for the fakes, wrong as a model.
- sim: populate the new `PlayerGameLine` fields so box points sum to the score (5B).
- UI: the store toasts every `WeekReport` event, which on real data is 16 "injury event(s)" toasts per week. Route week events to the Dashboard alerts panel and keep toasts for the user's own team (3E/5A).

## 2026-09-18 — Phase 3 (fan-out #2)

- **`draft.startDraft` is self-sufficient.** `league.advancePhase(OFFSEASON_RESIGN)` only sets `phase = 'DRAFT'`; the caller (store or `headless.ts`) then calls `startDraft`, which loads prospects itself if needed, settles post-history pick numbers from `state.history`, and runs AI picks until the user is on the clock or the draft is COMPLETE. `advance` re-syncs unmade picks' owners from `state.picks` so a mid-draft trade takes effect.
- **`DraftModule.userPick(state, playerId, ctx)`** — gained `ctx` (rookie contract via `fa.rookieContract`, divergence via `history.markDiverged`). The store passes it.
- **History anchoring in the draft is vetoed by saturation only in rounds 1–2** (`anchorVetoMaxRound`); day-three picks are depth, so a stacked position is no reason to rewrite history (without the gate the 2014 match rate fell to 35–76 %). `advance({ auto: true })` resolves the user's slot through the same anchored logic, not raw best-available, so an uninvolved user does not derail the draft. Measured: **2014 redraft 93.8 % historical** (240/256).
- **Trade gates.** In-season cap gate allows `max(0, capSpace) + 5 % of cap` of incoming salary (zero slack was unusable: 18/32 mock teams start over the cap). Roster gate is arithmetic (46–53 / ≤90) rather than `fa.validateRoster`. Sharp-drop re-valuation compares `state.scouting` to the season chunk's start-of-season consensus (no-op post-history). Counters flip orientation (`initiatedBy: 'AI'`) so `evaluate(counter)` is the user's fairness bar. `sim.teamStrength` is deliberately not used (it reads truth); pick-slot projection uses starter consensus + record. Scenario p at balanced: fair 1-for-1 0.48, fleece for AI 0.9997, against AI 0.0002; strict exploit run nets the user no surplus.
- **Contracts and cap.** Market curve `capPctFor(pos, ovr, age)` is hand-shaped (position multipliers + peak-age decline), not a regression fit — Phase 5 qa-balance retunes. `RosterEntry` has no `signedSeason`, so re-synthesized veteran deals assume they were signed this season; hint years clamp to 1–7, $0 hint = absent. `validateRoster` now enforces the cap in PRESEASON/REGULAR/PLAYOFFS. `release` charges dead money (25 % × apy × years × guaranteedPct into the existing `TeamState.deadMoney`) and marks divergence; natural expiry (rollover, AI "let go") moves to `freeAgents` with neither. `snapToHistory` handles `real === true` players only. Measured: anchoring 2015→2016 ≥ 90 %; cap invariants hold over 5 real offseasons.
- **Lifecycle.** Progression inside data is exact from trajectories; beyond, `prev + ageDelta + N(0, σ_pos)` from `curves.json`. Retirement uses a single value baseline (65) because `curves.retirement[pos].byAge` is defined at a position-mean value that is not exported. `udfaGrade.potQuantiles` levels assumed `[0.1, 0.25, 0.5, 0.75, 0.9]`. Procedural ids `gen-<seed>-<season>-<n>`; names only from `curves.names`. Generated class vs real 2012: size +3.6 %, position-mix L1 0.13, pot p50/p90 within 1 point, p10 6 points low (pooled UDFA grade diluted by the doubled 2016+ pools).
- **UI batch 2** (Draft Room, Trade Center, Free Agency, Schedule, Standings, League Browser) landed with the store actions and `#/draft #/trade #/free-agency #/schedule #/standings #/league` routes; 3E owned `store/`, `ui/` and App.tsx route wiring in addition to its screens. Week events now go to a store `alerts` list; toasts only for events naming the user's team or roster (text heuristic). Read-only sync helpers (`evaluateTrade`, `teamNeeds`, `resignAsk`, `standings`) return fallbacks instead of toasting so a live bar is not spammed. Bundle 147 KB gz (was 127).
- **Test infra.** `vitest testTimeout` raised to 30 s (60-sim calibration and multi-offseason runs take 5–10 s under a parallel run). `fakeDraft.startDraft` now reads the S+1 chunk.
- **Headless after Phase 3:** `--seasons 2` runs the whole offseason for the 31 AI teams and stops at PRESEASON on the user's team (IND: 67 players, $169M vs $155M cap) — by design; Phase 4's scripted GM cuts down and gets under the cap.

### Follow-ups for Phase 4
- `fa.runAiCutdowns` releases through `release`, which marks every cut player diverged; §6.8 wants divergence only from user actions, so give the AI path a non-diverging release or anchoring erodes each preseason.
- Zero `TeamState.tradeAnnoyance` at season rollover (§6.5 "for the rest of the season").
- `engine/trade` wraps `fa.capSpace` / `draft.teamNeeds` / `lifecycle.age` / `history.markDiverged` in try/catch fallbacks so it worked against stubs — remove them so integration failures are loud.
- `draft.runUdfa` must be a no-op when `draftRoom` is null: the store's `signUdfa` calls it directly and `league.advancePhase(UDFA)` calls it again with `[]`.
- `headless.ts`: scripted GM policy for the user team (draft best consensus, cut to 53 under cap, no trades) so 6 seasons complete; per-season report.
- Pipeline/curves: export a per-position mean value for the retirement table, explicit `udfaGrade` quantile levels, and consider fitting `udfaGrade` on 2010–2015 only.
- Screenshots for Draft Room and Trade Center at 1280/390 (no Playwright test flow exists yet — devops-tests in Phase 5).
- `trade.evaluate` post-history has no prior consensus snapshot for the sharp-drop rule; a `scoutingPrev` field would make it work beyond data.

## 2026-09-18 — Phase 4 (integration #2)

- **Full offseason cycle in `league.advancePhase`.** OFFSEASON_RESIGN exit now moves the user's expiring players who were not re-signed (`years === 1`, `signedSeason !== season`) into the pool with everyone else's, so AI free agency can sign them; a deal `fa.resign` stamps this season is the re-signing and stays (first-offseason veterans synthesized at `newGame` share that stamp and keep the old behaviour — they expire at the rollover). TRAINING_CAMP rollover zeroes `tradeAnnoyance` with the records, appends `buildDraftOrder(season + 2)` so two drafts are always tradeable, and after the snap fits every AI roster over the cap to 97 % of it by scaling veteran deals (`fitPayrollToCap`); `newGame` applies the same fit to all teams. Real APY totals exceed the cap in 2016–2021 (15 teams in 2021, KC at 1.32×) and v1 has no restructures, so this stands in for them. PRESEASON runs `runAiCutdowns`, then `fillAiRosters` (AI teams under 53 sign the best unsigned players they can afford, starter-template positions first), then validates. Past the data nothing else backfills a roster that lost its expiring deals and had no cap room in free agency (BAL ended 2026 with 43 players before this).
- **Anchoring survives multi-season play.** `fa.runAiCutdowns` releases without marking divergence (§6.8: only user actions diverge; dead money still applies). `history.snapToHistory` retires only players still in the league and leaves known players already gone alone (they can come back after a gap year); the snap log no longer re-retires 1,000+ players a season. `lifecycle.retirements` never rolls for a real player without `retiresAfter` while the season is in history — `retiresAfter` in `trajectories.json` is null only for players active in 2025, so a random roll retired real players who then had to be resurrected by the next snap. `lifecycle.progressSeason` seeds a real rookie who never took a snap from consensus (sim otherwise fell back on a displaced R7 pick signed as a UDFA). `draft.loadProspects` generates the post-history class with season S+1 (the first procedural draft threw "no prospects available"). `engine/trade` lost its stub-era try/catch fallbacks; the empty-need-profile fallback stays.
- **Scripted GM** (`app/scripts/lib/scriptedGm.ts`): re-sign expiring starters ≥ 68 ovr at their ask under the cap; draft best-available by consensus pot through `draft.userPick`; offer the ask for starter-template needs (anyone when short of 53); in preseason cut to 53 by consensus then under the cap by net savings per rating point, then refill to 53 (rollover retirements land after free agency closes) shedding the worst contract when capped out. No trades. `headless.ts` prints a per-season report and checks cap and truth coverage at opening day, ≥ 75 % AI-roster anchoring in history and procedural players past it. IND 2012, DAL 2010, KC 2021 (→ 2026) and SEA 2023 (→ 2027) all complete with invariants green. Measured: AI rosters match real opening-day rosters 95–100 % (min 89 %); sd(wins) 2.8–4.0 (procedural seasons at the high end); corr with real wins 0.31–0.80 by season, 2016 consistently lowest (single-season calibration for 2016 is 0.60 vs 0.86 for 2015).
- **Browser play-through (IND 2012 → 2013 week 1) and what it fixed.** Store: autosave at every phase transition, every 4 weeks, after a new game and debounced after any state change; the last game is restored on load (a reload dropped the game before). `capThisSeason()` so screens use `fa.capFor`; the strip's cap space includes dead money. Dashboard: one phase-aware button, "Sim week" only in season, disabled with a hint while the draft is unfinished, roster-size alerts. Roster: a Release action per row — there was no way to cut down in preseason, so a human GM was stuck at 70 players. Free agency pool sorted by ovr; the offer form shows the ask. `draft.applySelection` stamped a player onto every unmade `state.picks` entry with the same round/original team, so a compensatory pick and the team's own pick both showed the same player; keys in the pick lists collided the same way. Ratings are rounded to one decimal in `clampRating`. 2013 auto-draft reproduced the real Colts class exactly; a hindsight pick (Hopkins at 24) and an AI trade (Demario Davis for John Boyett) both went through.
- **Data observations (not fixed here).** `players.json` for 2016+ carries ~1,000 more `team: null` players than 2015 (3,045 vs 2,064), so the free-agent pool triples from 2016 and snap NEW_ARRIVAL counts spike; contracts coverage collapses in 2023–2025 (entries without APY: 833 / 1,189 / 1,502; median team payroll from the data falls to 7 % of the cap in 2025, so nearly every deal is synthesized from the market curve). The 2022 schedule is one game short (BUF–CIN cancelled); the harness accepts it.
- **Tagged `v0.5-alpha`.**

### Follow-ups for Phase 5
- 5B: dead money is 25 % of remaining guaranteed money for every cut, including snapped-in real signings and rookies (guaranteedPct 1), so a user who does nothing gets the real team's signings dumped on a 60–70-man preseason roster and pays $15–30M in dead money to cut down; the scripted GM's cut pattern shows it every season. Consider guaranteedPct by contract type, dead money only on multi-year vets, and/or capping snap arrivals onto the user's team.
- 5B: sd of wins 3.7–4.0 in procedural seasons (AI teams filled with minimum-salary players); injuries per team-game 2.8 vs the 0.6–1.6 target; 2016 win correlation 0.60 single-season; FA acceptance at the ask is ~0.4–0.5 so the user's offers at the ask mostly fail.
- 5C / data-ingest: drop or flag the 2016+ `team: null` players without a roster stint; investigate 2023–2025 contract coverage (OTC source); `manifest.sizesBytes`.
- Contract request candidate: `PickRef` cannot tell a compensatory pick from the team's own pick in the same round (`{season, round, originalTeam}`); trading one moves both. Add `pick` (nullable) to `PickRef` and key `trade.refKey` / `draft.syncOwners` on it when present.
- Phase order: retirements are decided at the TRAINING_CAMP rollover, after free agency has closed, so every team refills in preseason with what is left; deciding retirements before OFFSEASON_RESIGN would be more natural (needs S+1 truth earlier).
- UI: no "Continue" affordance on the new-game screen (restore is automatic and silent); the strip shows "week 21" through the offseason; the FA offer form's acceptance odds are not shown before offering; Free agency in PRESEASON has no re-sign/offer path beyond the pool.
- 3E follow-ups still open: Draft Room / Trade Center screenshots (5C's Playwright flow); `alerts` list has no Dashboard panel yet.

## 2026-09-18 — Phase 5 (fan-out #3)

- **Orchestrator pre-pass.** `fa.offerOdds` exposes P(accept) before the hard gates so the free-agency form can show odds live. `PickRef` gained an optional overall `pick`: trade matching, AI offer refs and the draft room's owner sync key on it when both sides know it, and `startDraft` stamps settled pick numbers back onto `state.picks` so procedural seasons carry them. Trading a compensatory pick no longer moves the team's own pick in that round.
- **5D data (added to the fan-out).** `historical_contracts.csv.gz` froze on 2022-05-29; the parquet under the same nflverse release is rebuilt daily and carries `gsis_id` directly, so 2023–2025 rosters missing an APY went 833 / 1,189 / 1,502 → 24 / 11 / 20 and SEA's 2025 payroll tracks the cap. A player belongs in season S only with a real stint (ACT/RES/INA), a draft slot or a contract covering S; CUT/DEV-only rows (40–300 a season) are dropped. The 2016+ pool stays several times 2015's because nflverse's roster snapshots genuinely grew that year (practice squad and tryout churn); whether practice-squad-only players belong in the pool is a v2 question. `manifest.sizesBytes` now covers every file. Still open: `model/data.py` reads the frozen contracts CSV for `apy_cap_pct`.
- **5C.** One Chromium smoke flow against the production preview bundle (new game → draft round with a pick and a trade → sim 4 weeks → reload restores). CI gains the e2e job and the §6.10 gzip budget check; Pages deploys only after CI succeeds on `main` (no 404 fallback: the app has no URL routing). README written; Draft Room and Trade Center screenshots captured by the flow.
- **5A.** Finances, Season Recap and End Game screens; on-the-clock callout and per-row Draft action; sort and position filters on every player table; `isRookie` follows the phase (the class drafted in season S has `rookieSeason` S+1, so from DRAFT onward a rookie is S+1); injured badges show weeks out; Dashboard alerts route to their screen; New Game shows Continue when a save exists; the strip drops "week 21" outside the season. Two bugs found on the way: table rows were not keyboard-focusable, and "Sim season" skipped the recap when one call crossed from REGULAR into the offseason. The recap bracket is a per-round list, not the connector-line bracket in DESIGN.md §11.
- **5B (worktree `phase5/balance`, report in `app/scripts/qa/REPORT.md`).** Constants: sim `k` 2.5→2.1 (sd wins ≈3.1), injury `rateScale` 2.8→1.6, `otWindow` 1→1.3, `oneMarginFixP` 0.72→0.38, `futurePickDiscount` 0.85→0.92, new `faConstants.acceptance` (at-ask 0.50→0.75) and `rookieGuaranteedPctByRound`. Calibration 2012/2015/2016/2019/2023 all inside §6.3 bands. 2016's 0.60 correlation equals the ceiling `corr(team strength, real wins)` for that season, so it is a ratings-model property. The two written injury targets are mutually exclusive under the fitted duration mix (multi-week is always 0.37 × total); the total band wins and the calibration printer now shows 0.35–0.8 for multi-week. Trade AI at strict: hindsight buyers overpay 76–83 % on consensus value for +2–9 true points per trade, which is the intended premium. Dead money at cutdown is $4–8M in history; the Phase 4 numbers came from the scripted GM's post-data FA churn. Logic fixes landed: rookie deals guaranteed by round, rookies without a recorded salary priced off their slot.

### Follow-ups for Phase 6
- Trade AI never counters (0 in 400 deals) although §6.5 promises one; trace `counterMinP` / `counterMaxShortfallPct` / `counterCandidatesScanned` before changing them.
- `tests/engine/sim/harness.ts#runSeason` never applies the injuries it counts, so calibration understates a played season's variance.
- League mean payroll is 73–77 % of the cap (real ≈95–100 %). `valueExp 2.1` fixes it only together with a re-tune of `fitPayrollToCap`'s 97 % target and the scripted GM's cap reserve; otherwise 2023-era teams lose every FA bid to the cap gate.
- The scripted GM past the data signs 13–23 multi-year free agents and cuts some, leaving SEA with $56–63M dead in 2026–27; a human would not, but it flags that cut/re-sign churn is profitable on real contracts priced far above the synthesized curve after a season of progression.
- `futurePickDiscount` below 1.0 is still free money for a patient user (77 chart points a season at 0.92).
- Season Recap bracket connectors; ratings model still reading the frozen contracts CSV; 2016+ practice-squad players in the pool.

## 2026-09-18 — Phase 6 (ship)

- **The salary regression from 5D.** The frozen contracts CSV carried APY in dollars; the parquet that replaced it carries millions. `_contract_hint` kept dividing by 1e6, so every exported salary rounded to 0.0 and the engine synthesized every contract in the game — the 5D "missing APY" counts were counting `years` hints, not salaries. `_apy_millions` now tells the unit apart by magnitude (no NFL salary is under $1,000 or over $1,000M a year), with a pipeline test for both inputs. After the rebuild 2010 carries a real salary on 628 of 1,696 roster slots, 2015 on 1,404 and 2023 on 1,672; league payroll at a fresh start is 89–92 % of the cap (2012/2015/2019/2023; was 73–77 %), which closes the payroll follow-up without touching `valueExp` or `fitPayrollToCap`.
- **Cap fallback for pre-table seasons.** `capFor` returned the *latest* cap (2025's $279M) for any season before the table, so a 2007 or 2009 first-rounder on a 2010 roster was priced off a $279M cap: Calvin Johnson $26.7M, Matthew Stafford $27.9M. Seasons before the first table year now use the first year's cap.
- **Rookie scale by era.** `rookieScale.topPct` 0.10 matched the pre-2011 scale (Bradford ≈10 % of cap) but doubled every post-CBA first-rounder (Andrew Luck $12.1M). The top is 0.047 from `cbaSeason` 2011 on; the decay is unchanged.
- **AI teams never fall below the floor.** With real salaries past the data an AI team can sit at the cap with 45 players; `fillAiRosters` refused league-minimum bodies once `payroll + min > cap` and validation threw (`MIA: roster has 45 players; minimum is 46`, SEA 2023 × 5). The filler now reaches 46 with minimum deals regardless of the cap, `runAiCutdowns` runs after it, and a new swap pass releases the most expensive cuttable veteran whose release actually saves room and signs a minimum body until the team is under the cap. Regression test in `tests/engine/fa/fa.test.ts`. Headless IND 2012 × 6 and SEA 2023 × 5 pass.
- **Counters were never shown, not never made.** `scripts/qa/counterTrace.ts`: of 283 declined one-for-one deals with p < 0.5 inside the shortfall cap (2015, 16 teams), the AI countered 239 (84 %). The Phase 5 zero came from a harness that only submitted deals at p ≥ 0.5 (no shortfall, no counter owed) and a lowball probe past the 60 % cap. The store then discarded `outcome.counter`; counters now land in the Trade Center's incoming offers with a toast, and accepting one goes through the existing AI-offer path.
- **No re-rolling a coin flip.** The Trade Center seeded the accept roll from a random proposal id, so the same package could be offered until it landed (four straight declines at 53–55 % in the playthrough, then a fifth try). The roll is now seeded from the package (teams, players, picks) plus season and week: the same deal gets the same answer until the user sweetens it or a week passes.
- **Calibration harness applies injuries.** `runSeason` simulates week by week and runs `lifecycle.applyInjuryEvents` + `tickInjuries` between weeks like `league.simWeek`. 2015: sd(wins) 3.09 → 3.07, corr with real wins 0.86 unchanged — injuries add per-season noise, not spread between teams.
- **Awards.** `summarizeSeason` fills `awards` with the season's statistical leaders from the regular-season box scores (passing, rushing, receiving yards; touchdowns; sacks; interceptions) — visible stats only.
- **QA playthrough (IND, 2010, three seasons).** Traded a sixth, three sevenths and a bench receiver for a rookie Antonio Brown at 64 %; 13-3 and a wild-card loss in 2010; 1-15 in 2011 with Manning's lost season in the trajectory (the real Colts went 2-14); drafted Andrew Luck at 1 and Russell Wilson at 34 in 2012, went 5-11 after cutting Freeney and Donald Brown to get under the cap. Everything a §1 GM does — trade, re-sign, draft, cut down, sim — works and saves across reloads. The preseason cutdown is the rough edge: 11–13 releases by hand each year with no "cut to 53" helper (v2). The expiring-contracts alert now points at Free agency, where re-signing lives.
- **Pages.** The repo is private and this GitHub plan does not serve Pages for private repos (`POST /pages` → 422; the first deploy run failed with 404 at `deploy-pages`). The workflow is correct and will deploy on the next CI success once the repo is public. Verifying the live URL is the one Phase 6 step left open for Daniel.

### Known follow-ups (v2)
- A "cut to 53 / get under the cap" helper for the user's preseason; today it is one release per click.
- Dead money past the data: the scripted GM leaves SEA with $58–65M dead in 2026–27 now that real salaries fill the cap. A human GM would not churn like that, but the cost of cutting real deals is real.
- `futurePickDiscount` 0.92 is still 77 free chart points a season for a patient user.
- Season Recap bracket connectors (DESIGN.md §11); ratings model still reads the frozen contracts CSV for `apy_cap_pct`; 2016+ practice-squad-only players in the FA pool; comp picks past the data.
- Awards are leaders only — no MVP or Coach of the Year, which would need a team-context model.

## 2026-09-19 — Phase 6 addendum (post-ship QA with Daniel)

- **The draft was clean; the free-agent pool was the leak.** Daniel felt the first-year draft was full of good non-rookies. Every prospect in the 2011, 2016, 2023 and generated 2026 classes is a true rookie of its year (0 pre-existing players, ages 19–23). What he was seeing was the *unsigned* list on the Free agency screen: the 53-man export ranked candidates by depth chart, then snaps, then experience, and never looked at consensus rating, so a starter who spent the season on injured reserve (no snaps, buried on the depth chart) fell into the pool — Trevon Diggs at 90, Marlon Humphrey at 89 on a 2023 start, Derwin James at 84 in 2019 — and a user could sign him on day one at 100 % odds. `_select_rosters` now ranks by roster status (ACT/RES/INA first), then consensus `ovr`, then depth. Players rated 70+ in the pool at a fresh start: 2010 12 → 1, 2012 11 → 3, 2015 36 → 13, 2019 67 → 24, 2023 89 → 33; what is left are genuine offseason free agents (Rodger Saffold, Frank Clark, Chandler Jones in 2023). Documented in `DATA_CONTRACT.md`.
- **The league had no safeties from 2016 on.** Tracing why no team could supply a safety: from 2016 nflverse rosters label every safety and corner `DB` in `position`, which the pipeline mapped to `CB`. Nine seasons shipped with zero S on any roster, so every team read as needing one, the 53-man template's S slots went unfilled, and the draft and trade AIs chased a position nobody had. `resolve_position` now prefers the finer `depth_chart_position` (FS/SS/CB, T/G/C, DE/DT/NT, ILB/OLB/MLB) whenever `position` is a whole-unit label; a bare `DB` still falls back to `CB`. 2023 rosters carry 128 S / 192 CB, in line with 2015's 133 / 188. UDFA rows in the draft build use the same resolver. Still open: the injury model and the ratings model were built with the coarse mapping, so 2016+ safeties were modelled as corners there; a rebuild of `.cache/model` is the fix.
- **Generated prospects could have pot < ovr** (81 of 379 in a 2026 class) because the two ratings drew independent noise. Pot is now floored at ovr in `draftClass.ts`, with a test.
- **Suggested trades.** `trade.suggestTrades(state, ctx, rng)` proposes up to four AI-initiated deals that send the user a real upgrade (consensus ovr above the user's best) at one of their three deepest need positions, from a team not short there, asking for the user's surplus — off their need positions, never a kicker or punter, preferably at the AI's own need — plus pick sweeteners until the AI's own p ≥ 0.5, inside the same plausibility band as incoming offers. AI-initiated, so accepting always executes; a decline dismisses it for the week. Deterministic per season/week/phase. Coverage at a fresh start: 2015: 29 of 32 teams get at least one, 2.9 on average; 2023: 25 of 32, 2.4 on average (the rest have no fillable need at a non-specialist position). Store: `suggestedTrades`, `dismissedSuggestionIds`, `refreshSuggestedTrades`; the Trade Center refreshes on entry and after an accepted deal. Test in `tests/engine/trade/suggest.test.ts` (real 2015 data, five teams).
- **Live.** Daniel made the repo public on 2026-09-19 and dispatched `pages.yml`; the deploy still 404ed because no Pages site existed yet — visibility alone does not create one. `gh api -X POST repos/danielportuondo/nfl-gm/pages -f build_type=workflow` created it, the next run deployed, and https://danielportuondo.github.io/nfl-gm/ serves the v1.1.0 build (new game → dashboard → suggested trades verified in a browser, no console errors). HANDOFF §9 is complete.
- **The bar on AI-initiated cards now reads as deal value.** OfferCard showed "40 % · Coin flip · Acceptance likelihood" on deals the AI already stands behind; it now shows "Fair / Lopsided / Favours you · Deal value for you" (`AcceptanceBar mode="fairness"`). User-built proposals keep the acceptance wording.

### Known follow-ups (v2), updated
- Rebuild the ratings and injury models with `resolve_position` so 2016+ safeties are modelled as safeties.
- A "cut to 53 / get under the cap" helper for the user's preseason.
- Dead money past the data; `futurePickDiscount` 0.92; Season Recap bracket connectors; frozen contracts CSV in the ratings model; practice-squad-only players in the FA pool; comp picks past the data; MVP-style awards.

## 2026-09-19 — v1.2.0 (follow-up closure)

Daniel's call on the two "Known follow-ups (v2)" lists and REPORT.md's open questions: close everything recommended as close, defer the rest, and add a clearer New Game screen.

- **The model rebuild was smaller than the v1.1.0 handoff claimed.** The ratings model already resolved `DB` through the depth chart and the players master (`model/data.py#load_roster`), so `true_values.parquet` carried safeties in every season: the safety share of defensive backs is 0.43 before 2016, 0.29–0.33 in 2016–19 and 0.36–0.41 from 2020. Only the injury model used the coarse mapping. `build/injury.py` now keys every injury-report row on the season roster's resolved position (`_position_by_player`); the S rate moved 0.0261 → 0.0250 per player-game, CB 0.0274 → 0.0279.
- **Contracts parquet in the ratings model.** `model/data.py#load_contracts` reads `historical_contracts.parquet` (refreshed daily, deals through 2026, a direct `gsis_id` column) instead of the csv.gz frozen in May 2022, with the build's magnitude rule for the APY unit; six rows carrying an otc_id in the gsis column are dropped. The `apy` component of true value now sees real 2022+ market prices instead of the minimum fill. After the rebuild: calibration 2015 corr 0.855 / sd 3.13, 2023 corr 0.856 / sd 3.44 (unchanged); headless IND 2012 × 6 and SEA 2023 × 5 pass invariants; 255 Vitest and 37 pytest green.
- **Camp bodies leave the free-agent pool.** `_season_membership_mask` admitted any CUT/DEV row with a contract covering the season. From 2016 OpenTheCap records a deal for nearly every camp body — practice squad, futures, minimum tenders, the three-year minimum every undrafted rookie signs — so 840 of 2019's 1,326 day-one free agents were such rows, rated 48 on average. A contract now ties a player to the season only when it pays at least 0.6 % of the cap (`MIN_TIE_CAP_PCT`, ≈ $1.1M in 2019, $1.35M in 2023), however many years it runs. Unsigned at a fresh start: 2019 1,326 → 494, 2023 1,337 → 482, 2025 → 544; pre-2016 240–275 (was 250–330). Real released veterans stay (Frank Clark, Chandler Jones, Christian Kirksey in 2023). Data 2.31 → 2.12 MB gzipped. Documented in `DATA_CONTRACT.md`; tests in `tests/test_build.py`.
- **Injury target.** HANDOFF §6.3 now states the calibration band (0.6–1.6 total, 0.35–0.8 multi-week per team-game); the original multi-week-only wording cannot be met under the fitted duration mix. `injuryConstants.rateScale` 1.6 stays.
- **Payroll and `futurePickDiscount`.** The payroll question is moot (89–92 % of the cap since the Phase 6 salary-unit fix). `futurePickDiscount` stays at 0.92 by decision: 77 chart points a season is the price of a future-pick market that still discounts next year.
- **Prettier is clean repo-wide** (122 files reformatted, generated JSON schemas ignored, ENGINE_CONTRACT.md regenerated). ESLint remains the enforced gate.
- **Any team, any season.** `app/scripts/qa/sweep.sh` runs the headless harness for all 32 teams from 2010, 2014, 2018, 2022 and 2025, four seasons each, three at a time (about 12 minutes). 160 of 160 runs finished with `invariants: ok`; two scripted GMs won a title, the rest reached the horizon. HANDOFF §9's "any season 2010–latest with any team" is now verified by enumeration rather than sampling.
- **New Game screen.** Daniel: "there should be some visual functionality around starting a new game that is clear." Designed with the frontend-design skill inside the existing system (DESIGN.md §11 updated). The mandate plate now leads — a `plate` panel in the chosen team's colors with a 6× helmet, "Indianapolis Colts, 2025" in Pixelify 32, the mandate sentence, one line on the hindsight premise ("Every rating is what scouts believed then. You may know better.") and Start — and re-dresses as you choose. The team step is a helmet wall: 32 team-colored helmets in eight division columns (AFC row, then NFC), each tile a plate with the team's bar, the chosen one raised and bordered in its own primary. The Continue panel names the team and the phase in words instead of an enum with a middle dot. Verified in a browser at 1280 and 390 px; the E2E smoke flow passes unchanged.

### Known follow-ups (v2), updated
- A "cut to 53 / get under the cap" helper for the user's preseason (kept; next feature).
- Deferred by decision: dead money past the data; Season Recap bracket connectors; comp picks past the data; MVP-style awards.
- The theme toggle labels its target from the stored choice, so "system" on a light OS reads "Light theme"; resolve the label from the effective theme.
- A team-in-year preview on the mandate plate (top consensus players, cap room) would make the pick informed; it needs the store to load a season chunk on selection.

## 2026-09-20 — Settings tab and start over

Daniel: once a team is chosen there was no way back to the New Game screen; add a Settings tab that also lets you adjust some settings.

- **Settings screen** (`app/src/screens/Settings`). Appearance: theme as Dark / Light / System pressed buttons. This game: trade strictness, AI offer frequency and injuries, the same fields New Game uses (`screens/shared/GameSettingsFields`). Then the run plate with Start over. Settings changes reach the running league at once: the trade AI reads `state.settings.tradeStrictness` when it evaluates, offers read `aiOfferFrequency` when they are generated, the sim reads `injuries` each week. Settings live in `LeagueState`, so a change is an input like a trade and determinism holds.
- **Start over keeps the save.** Daniel's call between deleting the `default` slot and keeping it: keep. `startOver` writes any pending debounced autosave first, clears `state` and what hangs off it (selected player, trade offers, suggestions, dismissed ids, alerts), re-reads the slot metadata and routes to `new-game`, where the Continue panel offers the old run until a new Start overwrites the slot, as a fresh visit does. The confirm Modal says so. Delete was rejected: one slot, and a misclick after the confirm would cost the run.
- `autosave` returns its promise so `startOver` can await the flush; the fire-and-forget call sites are `void`. The debounce timer clears its handle when it fires, so a pending write is detectable.
- Rail: Settings before About; both under More on the tab bar. Form controls got system styling (`.gg-field`), which New Game's selects inherit.
- **Panels never stacked on phones.** Checking Settings at 390 px showed the two half-width panels side by side. `frame.css` declared the ≤ 720 px `span 12` rule before the base `.gg-col-*` rules; same specificity, so the base rules won and DESIGN §4's "stack to 12 at ≤ 720px" never applied on any screen. The media query now follows the base rules.
- Tests: store (`updateSettings` merges; `startOver` clears, keeps the save, flushes exactly one pending autosave and writes nothing after), UI (theme and settings report at once; the confirm gates Start over), and a final start-over step on the E2E smoke flow.

## 2026-09-20 — Cutdown helper (cut to 53, get under the cap)

Daniel's go on the feature kept since the Phase 6 QA playthrough ("11–13 releases by hand each year"). Design approved in chat before the build.

- **Engine.** `fa.suggestCutdown(state, teamId, ctx, protect?)` is a pure, deterministic plan: to the roster limit by lowest consensus ovr, then under the cap by most net savings per rating point above 40 (net savings = APY minus the dead-money charge), never dropping a position below `STARTER_TEMPLATE` or the roster below 46, never suggesting a protected player. The cap-stage rule is the scripted GM's, proven over the 160-run sweep; "most expensive first" (the AI's rule) was rejected for the user because it cuts a costly starter when two cheap backups free the same room. The plan simulates with the module's own release so dead money matches what a real release books. Returns `ok: false` at the 46-man floor when the cap is still out of reach.
- **No history anchoring for the user.** AI cutdowns prefer the real opening-day roster (§6.8). Suggesting exactly who the real team cut would hand the player the future, so the user's plan reads consensus and contracts only. The hindsight rule holds.
- **UI.** A `Cutdown` panel leads the Roster screen only while the team fails the PRESEASON gate (over the limit or over the cap in a cap-gated phase): status line, checked list of suggested cuts with dead money and savings, kept rows stay visible unchecked, summary of where the roster lands, one `Release N players` button. Unchecking recomputes the plan with that player protected. No confirm modal: the checklist is the review, and single releases have none. The per-row Release button stays.
- **Store.** `releaseMany` releases in order and toasts once; `cutdownPlan(protect)` is a pure getter like `teamNeeds`.
- **E2E.** The smoke flow's two hand-rolled cutdown loops are replaced by the panel, which is the real user flow.
- The headless scripted GM keeps its own cutdown policy so sweep results stay comparable.

## 2026-09-20 — Season Recap bracket and awards, save export/import

Daniel picked three items from the v1.3.0 follow-ups: bracket connectors, MVP-style awards on the Season Recap, and a save export/import screen. Design in chat, five decisions locked before building.

- **Contract (additive, no schema version bump).** `Award` gains optional `id` (`MVP | OPOY | DPOY | OROY | DROY | COY`), `playerName` and `pos`; `SeasonSummary` gains optional `bracket: PlayoffBracket`. Majors carry an `id`, stat leaders do not, so the UI can split them without matching names. Name and position ride on the award so a past recap renders after the player retires. Every existing save still parses; summaries from before this change simply have no bracket and fall back to the old text list.
- **Bracket.** `summarizeSeason` stores the bracket it already builds. The recap draws one CSS grid, four columns by eight rows: in both eras the postseason is a binary tree with eight leaves once bye seeds count as leaves (2020+: one bye and three games per conference; through 2019: two byes and two games). Wild card leaves are ordered so each divisional game sits between its two feeders, resolved from results, so reseeding never crosses a line. Connectors are pure CSS (2px `--line` stubs and a 25%–75% vertical bar per non-leaf cell); no SVG.
- **Awards are stats and records only, never truth.** Season totals from the regular-season box scores every game already carries (`GameResult.box`, all 32 teams), team records from `state.teams`, consensus only for coach of the year. Offensive score = pass yds/25 + pass TD×4 − INT×2 + rush yds/10 + rush TD×6 + rec yds/10 + rec TD×6; defensive score = sacks×4 + INT×5 + FF×3 + PD + tackles×0.4 + def TD×6. MVP = offensive score × (0.5 + team win pct), so production on a winner beats slightly more of it on a loser. OPOY = best offensive score excluding the MVP (otherwise the same QB wins both most years). DPOY = best defensive score. **Rookie of the year is split** into offensive and defensive (Daniel's call): the two scores do not share a scale. A player's team is the one he played the most games for, not end-of-season roster membership, so traded players are credited correctly. Ties: score, then team wins, then player id; every iteration is over sorted keys. Weights live in `engine/league/constants.ts`.
- **Coach of the year = wins over consensus expectation** (Daniel's call; the only consensus-legal definition). Expectation: rank the 32 teams by the mean consensus ovr of their auto depth chart starters, map rank linearly to a projected win pct (0.72 at 1 down to 0.28 at 32) times games played. Computed at season end from the end-of-season roster. Consensus is frozen during a season (only lifecycle and draft prospects write `scouting`), so this equals a preseason snapshot except for trades, signings and injured starters; the snapshot variant would need a new state field and a migration and was not worth it.
- **Save file.** No contract change: `persistence.exportJson` / `importJson` already validate, migrate and hydrate. Export downloads `gridiron-gm-<team>-<season>-w<week>.json`. **Import overwrites the `default` autosave immediately** (Daniel's call): otherwise a reload resurrects the replaced game. A pending debounced autosave from the old game is cancelled, not flushed. **Import lives on Settings and on New Game** (Daniel's call): the main use is a fresh browser or another device, where no game is loaded. Settings always confirms in a Modal; New Game confirms only when a saved game would be replaced. A bad file toasts the readable error from `importJson` and changes nothing.
- Tests: league (awards on a hand-built season, determinism, bracket on the summary; headless IND 2012 ×6 still `invariants: ok`), UI (bracket headers, byes per era, feeder order, NamePlate majors, old-summary fallback; Settings and New Game import flows), store (export round-trip, bad import leaves state untouched, import saves once and cancels the pending autosave), and an E2E step asserting Export save produces a download.

## 2026-09-20 — v1.3.0

The Settings tab and the cutdown helper above, plus the phone-width panel stacking fix. Tagged `v1.3.0`.

### Known follow-ups (v2), updated
- Deferred by decision: dead money past the data; Season Recap bracket connectors; comp picks past the data; MVP-style awards.
- The Strip theme toggle labels its target from the stored choice, so "system" on a light OS reads "Light theme"; resolve from the effective theme (the Settings screen shows the stored choice explicitly, so the toggle is the only place this shows).
- A team-in-year preview on the mandate plate (top consensus players, cap room); needs the store to load a season chunk on selection.
- Export / import of the save as JSON: `persistence.exportJson` / `importJson` exist, no screen uses them. A natural Settings addition.
- Refilling a roster left short of 46 by retirements is still a trip to Free agency; the cutdown helper only cuts.

## 2026-09-20 — Opening offseason (v1.5.0)

- **A new game opens at its own draft.** Daniel: "If I take over a team in 2013, before starting the
  season I should have the 2013 draft." `league.newGame` now defaults to `startAt: 'DRAFT'`: the start
  class (`draft.prospects` of the start chunk) is filtered out of the chunk before anything is built, picks
  are owned for S, S+1 and S+2 with the real S numbers, and the state opens at `season = S − 1`,
  `phase = 'DRAFT'`. The draft-year convention (season X drafts X+1) is unchanged, so draft, trade
  discounting, anchoring and cutdowns needed no changes. The TRAINING_CAMP rollover into S skips
  contract ticking, progression, retirements and the consensus refresh when `isOpeningOffseason(state)`
  (`season < startSeason`); dead money is zeroed, the snap, picks and schedule run as usual. No schema
  change, no save-version bump. Spec: `docs/superpowers/specs/2026-09-20-opening-offseason-design.md`.
- `startAt: 'PRESEASON'` is the old opening-day start; calibration, the sim sweep and the 2014 redraft
  fixture pin it so their measurements do not move (2015 calibration: real-win correlation 0.855, sd of
  wins 3.13, unchanged).
- Cap and market age lag one year during the opening offseason, the same convention every later
  offseason already follows (`capFor` clamps below the table, so a 2010 start prices off the 2010 cap).
  `trade.seasonStartOvr` is empty before the first season and never reads the S − 1 chunk; the store's
  chunk loader skips seasons the manifest does not list.
- **UI:** offseason phases are labelled by the season they prepare ("2013 offseason · Draft"), which
  also ends the "2013 · draft while the 2014 class is on the board" confusion. New Game copy says you
  take over before the draft; the Dashboard leads its alerts with "The 2013 draft is waiting / under way";
  offer text shows pick numbers when the order is set ("2013 R1 #24 (IND)"), only when known.
- Headless plays the opening offseason first (IND 2012 ×6: the scripted GM drafts at IND's ten real 2012 slots,
  AI rosters match real 2012 opening day at 100 % mean / 98 % min after the opening rollover, `invariants: ok`;
  a 2010 start proves nothing needs a 2009 chunk); the E2E smoke drafts before it sims. New realData test:
  2015 start, scripted GM through the opening offseason, every roster legal on opening day, AI rosters
  ≥ 90 % real.

## 2026-09-28 — Draft resumes after a mid-draft trade

- Daniel: after accepting an offer in the Draft Room the draft did not resume. Root cause was in the
  store, not the engine: `trade.submit` moves the on-clock pick to the AI team (in `state.picks` and
  `draftRoom.order`), and `draft.advance` re-syncs owners and runs the AI on, but nothing called
  `advance` — the room sat at the same index with an AI team on the clock until "Sim to my pick".
  Reproduced on real 2013 data (ARI, pick 45 to LAC: index 44 → 44, log unchanged; `advance` on that
  state ran to the user's next slot at index 68 with fresh offers).
- The store now runs the draft on after any accepted trade that leaves someone other than the user on
  the clock (`resumeDraftAfterTrade`, used by `respondToOffer` and `proposeTrade`): the same call
  "Sim to my pick" makes, so the user lands on their next pick with new offers, or on "Draft complete".
  A trade that keeps the user on the clock (a player deal from the Trade Center) leaves the room and
  its remaining offers untouched — re-running `advance` there would regenerate declined offers, since
  draft offers are seeded by pick index. Engine untouched; no contract change.
- Test: three store cases with the real `trade.execute` and a spied `draft.advance` (offer accepted
  in the room, player deal that keeps the user on the clock, user-initiated pick trade from the Trade
  Center). 323 tests.

## 2026-09-28 — Display numerals from Oxanium

- Daniel: the numbers are hard to read. Pixelify Sans digits blur at data sizes (a rating of 72 reads
  as τ2, a 5 as S, $123.0M as $183.0M). Candidates compared on the app's real numbers at 13/16/24/32px
  in both themes: Oxanium, Saira Semi Condensed, Barlow Semi Condensed, Big Shoulders, Jersey 10,
  Chakra Petch. Oxanium won: squared forms that sit on the pixel grid, all ten digits one width (so
  table columns align without `tnum`), clear at 13px. Chakra Petch was close, but its digits are
  proportional. Barlow Semi Condensed is legible but drops the game voice.
- Implementation: a `GG Numerals` `@font-face` in `tokens.css` over the Oxanium variable file,
  `unicode-range` limited to digits and `$ % + , - . / – −`, first in `--font-display`. Every number
  in display type switches at once, letters stay pixel, and no component changed. Weight range 600–800,
  so regular display text gets 600 numerals that hold up beside the pixel strokes. New dev dependency
  `@fontsource-variable/oxanium` (OFL, self-hosted). Barlow body numbers were already legible and are
  unchanged.

## 2026-09-28 — QA sweep fixes

- Eight read-only QA agents covered the engine on real data, the store, every screen in a browser,
  persistence and the deploy. Daniel's calls on the design-level findings: the hidden true values stay
  on the client as they are; free-agency offer retries and the two trade loopholes (a cosmetic
  sweetener gets a fresh accept roll; the two-firsts-per-deal limit can be split across deals) stay
  as they are; End Game offers "Keep playing" after a title.
- Injuries: the injury report drops a player once he goes on reserve, so the fitted durations topped
  out at 11 weeks and nothing was season-ending. `build/injury.py` now extends a report episode
  through the player's weekly-roster `RES` run (nflverse `weekly_rosters`), which makes 53 % of
  injuries last 2+ weeks, 8.5 % 8+ weeks, and 12.5 % run to season end. Occurrence is unchanged.
  `injuryConstants.rateScale` 1.6 → 1.1 keeps multi-week injuries at ≈ 0.59 per team-game (the
  shipped level) with 1.12 total (2015 and 2023, 100 sims; the earlier entry's "1.64 is inside the
  0.6–1.6 band" was wrong). `permanentLoss.p` is fit as the share of 8+-week episodes but applied
  as the chance of a loss given one; that pre-existing mismatch now means 8.6 % of long injuries
  cost 1–3 rating points instead of 0.25 %.
- Sim: postseason games that roll a tie play on to a field goal or touchdown. About 5.5 % of
  touchdowns become defensive or return touchdowns (taken from rushing TDs; `passTdShare` 0.62 →
  0.656 keeps passing TDs level) and two-point conversions and safeties are credited, so every box
  score sums to the final score; with no kicker dressed the punter kicks (the NO 2013 and 2015
  kickers are missing from the shipped players.json — a pipeline follow-up).
- Standings break pct ties by groups: head-to-head among the tied teams only, then point
  differential, then team id, recursing within any group still tied, so a 3-way cycle can't
  contradict itself. `fa.resign` requires OFFSEASON_RESIGN and an expiring contract; `resign` and
  `offer` validate the contract against `ContractSchema`.
- Store: in-flight guards on newGame/continueGame and busy guards on advancePhase/importSave/startOver
  (new `busy.startOver`); saves check the stored `savedAt` against the tab's own and a tab that fell
  behind stays blocked until reload; imports outside the shipped seasons are refused before they
  overwrite; selectors log unexpected errors; "Sim to my pick" is disabled while the user is on the
  clock (offers are seeded by pick index, so re-advancing would resurrect declined ones).
- UI: grid columns and stat tiles get `min-width: 0` (the Dashboard cap tiles forced 884px at a 768px
  viewport) and the Strip scrolls internally; the 720px rail breakpoint is unchanged.

## 2026-09-28 — Pick board in the Draft Room

- The Draft Room's "Draft board" panel has two tabs: Prospects (the available-prospects table, the
  default) and Pick board, the league-wide board DESIGN §5.3 always described. The board shows one
  round at a time (R1–R7 buttons), follows the clock into each new round unless the user picked a
  round, and lists every pick with its owner, "from XXX" on traded picks, and the player taken with
  consensus Ovr/Pot. The pick on the clock and the user's picks are tinted through a row-level
  `rowTone` hook on the Table primitive. Coming on the clock switches back to Prospects, where the
  pick is made. Consensus only; no engine or contract change.

## 2026-09-28 — The user's move history

- New saved `state.transactions`: every move by the user's team, logged by the engine where it
  happens: trades it is part of (`trade.execute`), each pick it makes, auto-picks included
  (`draft`), UDFA signings (`runUdfa`), accepted free-agent offers, re-signings and releases
  (`fa`). AI-only moves are never logged. Each entry keeps the consensus ovr of its players at the
  time (`ovrAtMove`) so Recap can show "then → now" from `state.scouting`, never truth.
- The field defaults to `[]`, so `SAVE_SCHEMA_VERSION` stays 1. A save made before the log existed
  gets DRAFT entries backfilled from `players[id].draft` for the user's team from `startSeason` on,
  with no "then" rating; other kinds can't be recovered. Entries keep the raw `state.season`; Recap
  files offseason-phase moves under the next league year, as the header reads them ("2012
  offseason" is season 2011), so a backfilled pick is stored as season = class − 1, phase DRAFT.
  Signings read "2y $7.0M/yr".
- Recap has two views: Season (unchanged) and Your moves, which lists every year newest first with
  a count line and filters (All / Trades / Draft / Signings / Releases). It works before the first
  season finishes. Built without a separate spec file at Daniel's request; this entry is the record.
- The headless harness checks that the log only grows, parses, and involves the user's team, and
  prints counts by kind.

## 2026-09-28 — Trade valuation: stars on big deals and old QBs

- Daniel saw 2017 AI deals offering Cam Newton for Rashawn Scott and Tom Brady for Neville Hewitt
  and a 7th, both labelled "Fair", with the Brady deal at 47 % even on ruthless. Causes: the full
  contract cost was subtracted from talent and floored at 0.25, so Newton (talent 20.9, cost 38.4)
  was worth the same as Scott; QBs lost 7 % a year past 31, leaving a 40-year-old Brady below
  Brian Hoyer; `suggestTrades` and `generateAiOffers` protected a team's most *valuable* player at
  a position, which after the first two could be a cheap backup; and with a fixed sigmoid scale of
  12, any deal between small values read ≈ 50 % whatever the gap or the strictness.
- Fixes (Daniel's calls): contract cost is capped at half of talent (`maxCostShareOfTalent` 0.5);
  QBs decline 0.04 a year past peak (`declinePerYearPastPeakByPos`); suggestions and offers never
  send a team's top-consensus player at a position; and the sigmoid scale is
  clamp(0.2 × max(valueIn, valueOut), 1, 12), amending HANDOFF §6.5's fixed scale. The AI's own
  p for the Brady deal is now 4.2 / 2.8 / 1.7 / 0.8 % (lenient → ruthless) and for the Newton deal
  0.9 → 0.2 %. Top-player-for-scraps suggestions over 2016–18 went 12/320 → 0, incoming offers
  6/160 → 0, and the hindsight exploit check stays inside its 15 % target (strict: 2.2 % in 2015,
  −4.6 % in 2017).
- The meter on AI-initiated cards (Trade Center suggestions and offers, Draft Room offers) now
  shows `trade.fairness`: what the user gets ÷ (gets + gives) by consensus value, 0.5 = even,
  labelled Against you / Fair / Favors you. The user's own proposals still show the AI's accept
  chance.
- Left as is at Daniel's call: an extreme lowball does not raise annoyance, so it can land on a
  retry (≈ 1 % after these fixes). Noted for the ratings pipeline: Newton's consensus falls
  91.5 → 71.5 between 2016 and 2017 (resolved in the next entry).

## 2026-09-28 — Consensus blends the last three seasons

- Root cause of Newton's 91.5 → 71.5: a veteran's consensus `ovr` was exactly last season's true
  value (HANDOFF §6.2), true for all 24,457 returning player-seasons. One season decided the
  rating, and a missed season (true value ≈ 41.5 with no games) crashed it: Luck 2018 and Watson
  2022 read 42.7. 7.7 % of veterans moved 20+ points a year. No future leakage was involved.
- Daniel's call: consensus `ovr` = the last three seasons' true values weighted 0.6 / 0.3 / 0.1 by
  recency and by the share of games played; with under 0.05 total weight, the latest season's
  value as before. True value stays single-season, so the sim and hindsight are unchanged; pot and
  confidence formulas are unchanged. HANDOFF §6.2 is amended.
- Same rule in the pipeline (`model/consensus.py#blended_prior_value`) and in the refresh past the
  data (`lifecycle` `blendedConsensusValue`, weights in `constants.ts`). `trajectories.json` gains
  `avail[]` parallel to `values`, copied to `TrueTrajectory.availBySeason`, so a real season missed
  just before the data ends still counts little (72 players with a 2024 value ≥ 70 played under 4
  games in 2025). Old saves have no `availBySeason` and count every season as fully played. File
  size 904 → 1,220 kB raw, 178 → 189 kB gzipped.
- Results: Newton 2017 71.5 → 78.1, Brady 2019 71.8 → 78.7, Luck 2018 42.7 → 80.7, Watson 2022
  42.7 → 85.7. Share moving 20+ points (players on a roster the two prior seasons) 8.5 % → 2.3 %.
- Knock-ons: opening-day 53s are filled by consensus, so veterans back from a missed season now
  keep spots that went to UDFAs (2014: 56 → 50 real UDFAs on opening rosters). The UDFA anchoring
  test now checks a share (> 90 %) instead of a fixed count of 50. The E2E trade step accepts a
  counter-offer toast, which is what the smoke deal now draws.
- A drafted player who has not played meaningful snaps yet fell back to his 0-game season value
  (≈ 41) the next year; resolved in the next entry.

## 2026-09-28 — Draft picks who have not played keep their draft grade

- A draft pick with zero games in every season so far is scouted with the draft-based rookie view
  (slot, combine, age, less 2 points per season since the draft) instead of his 0-game true value
  (`model/consensus.py#drafted_without_games`). One to three games stay on the blend, since that
  true value is already shrunk toward the position mean. Undrafted players are unchanged.
- Results: McCarthy 2025 41.7 → 72.1, Etienne 2022 41.9 → 68.6, Jonah Williams 2020 41.3 → 70.5;
  623 rows switch (28 among top-64 picks, none of which now sit below 50). Share moving 20+ points
  2.3 % → 2.0 %.
- Side effect, accepted: the rookie age bonus now compares a prospect with his own draft class's
  median age at his position, not the whole season's rookie group, so adding these players does not
  move everyone else's pot (295 rookie rows in 2010–17 move by ≤ 0.8 pot).
- Past the data, the refresh keeps a drafted real player's existing view while every real season
  on record has zero availability (`lifecycle` `hasNotPlayedYet`).
- Open: a veteran back from a long absence (Blackmon 2017–20, Bridgewater 2025) still falls to his
  0-game value when the three-season window holds no games; falling back to the last season with
  games would fix it. Late-round picks who sat for years scout at about 52–56.

## 2026-10-05 — Draft order follows the sim season

- Every draft after the opening one is ordered from the previous **sim** season's standings
  (worst record first, playoff teams after, runner-up then champion last), 7 × 32, in history or
  not. Pick numbers stay unset until the draft starts. Previously real-season drafts copied the
  real order two drafts ahead, so a team's slot ignored its sim record.
- The opening draft (`season === startSeason` in a game that opens at the draft) keeps the real
  order, comp picks and real ownership: no sim season precedes it.
- Real-life comp picks and real-life pick trades are dropped for later drafts; ownership moves
  only through in-game trades.
- History anchoring follows the slot: the AI at overall #N leans toward the player who really went
  #N.
- Old saves: at draft start a non-opening draft is rebuilt as 7 × 32 own-round picks
  (`draft/order.ts#simOrderPicks`), keeping in-game trade owners and dropping comp/extra picks.
  `SAVE_SCHEMA_VERSION` stays 1; a draft already in progress finishes on its old order.
- Known minor gaps: an old-save transaction that names a real pick number may not link to the
  drafted player in the season recap, and a pending proposal naming an old pick number won't match
  after renumbering.

## 2026-10-06 — Fixes from the 2017 Dolphins playthrough QA

A playthrough agent played MIA from the 2017 draft (titles in 2018 and 2019). A QA agent reviewed each season. Daniel picked which findings to fix.

- **Draft room pauses on every pick** (supersedes the 2026-09-18 note "startDraft runs AI picks until the
  user is on the clock").
  - `startDraft` and `makePick` no longer run the AI ahead.
  - `DraftModule.advance` takes `{ single: true }` for "Sim next pick".
  - While an AI team is on the clock, the user can trade for that pick.
- **Vetoed draft anchors stay in contention** in sim-order drafts. Later slots take an overdue real prospect, so real top-64 picks land within about ±8 of their slot. Opening drafts are unchanged.
- **History snap never adds players to the user's roster.** Draftees of picks the user traded stay with the team that used the pick.
  - Open (backlog): the snap still moves AI draftees to their real teams, so the AI draft is cosmetic.
- **Real absences become announced injuries.** A consensus starter whose real availability for the season is under 0.5 starts the season injured for the share of games he really missed. `LifecycleModule.applyHistoricalAbsences` does this; lifecycle reads truth, and the depth chart only sees an ordinary injury. Calibration win correlation vs real seasons went from 0.76 to 0.83–0.87.
- **Injuries cost the full number of weeks rolled.** Injuries tick before new ones apply, and a bye counts as a week served. Injuries carried into the offseason heal at camp for every team; before this, only AI players' injuries healed, because the snap rebuilt their roster slots.
- **Contract `years` = seasons the player will actually play.** Offseason deals are stamped `signedSeason = season + 1`, and the camp rollover skips them. `fa.seasonsLeft` / `fa.isExpiringDeal` encode the rule. Synthesized contracts end by age 36 (QB/K/P: 39).
- **AI rosters stay legal.** Cutdowns keep position minimums (2 QB, 1 K, 1 P, …), weigh value against net cap savings, and keep year-1 R1–R3 rookies. AI teams refill holes from FA at cutdown and before each in-season week.
- **Trade valuation:**
  - An AI team charges for the lineup drop when it gives up a starter (`starterLossShare` 0.5).
  - Incoming non-starters count at half (`fillerShare` 0.5); R1–R2 rookies are exempt.
  - Rookies are anchored at ≥ 80% of their slot value, fading over two years.
  - Value scales with seasons of control, and a buying AI charges salary in full, so bad contracts are negative.
  - Players signed in free agency can't be traded until week 1 (in-season: 4 weeks).
  - The cap check runs in every phase. Offseason trades are checked against next season's books.
  - Suggestions never ask for a user starter.
  - tradeExploit (strict) pooled true surplus went from 18.6% to −4.3%.
- **Fairness bar** is never "Fair" below an even deal: <40% Against you, 40–50% Slightly against you, 50–60% Fair, >60% Favors you.
- **Awards score players relative to their position.** Each score is a ratio to the position's top N, times a position weight; MVP adds a team-record factor. MVP was a QB in 71 of 72 seeded seasons.
- **Box score** splits pass and rush at real NFL rates. It draws from its own RNG stream, so outcomes are unchanged.
- **Data:**
  - Opening rosters take players who actually played (availability ≥ 0.5) and the season's draftees first.
  - Players who never play again are dropped from season chunks unless just drafted.
  - `retiresAfter` is the last season with a game.
  - Real fullbacks carry `role: 'FB'` (`pos` stays RB).
- **In-season AI offers** reach the Trades screen. The store generates them after each sim with the same generator and seed as "Check for offers".

## 2026-10-06 — Second QA fix batch

- **The offseason signing gate uses next season's books.** In offseason phases, `fa.resign` and `fa.offer` compare `capFor(season + 1)` with the deals still on the books (`seasonsLeft ≥ 1`), which is the same rule as trade's `capBook`. The user-facing cap tiles show that gate ("Cap next season").
  - Asks display rounded up to $0.1M, and re-signs accept $0.05M under (`faConstants.askTolerance`).
  - `fa.offer` returns an optional plain-words `reason`.
  - Still open: AI free agency and AI re-signing gate on this season's cap. Changing it shifts balance, so it is deferred.
- **A trade appends to the user's depth chart.** It does not re-sort the user's chart. AI charts still sort by consensus. The Roster screen has "Reset to consensus" (whole chart, injured players last).
- **Capital C comes from Tiny5.** Pixelify Sans draws C as a notched O. A one-glyph Tiny5 face (OFL; 532 B, inlined) supplies U+0043 ahead of it. Standings cards span the row from 721–1199px and show abbreviations at phone width.
- **Unlabelled DBs resolve to S or CB** (build and model, `build/db_career.py`). Order: the row or draft label, then the combine, then a career vote across rosters, depth charts, players and NGS, then 202 lb. League S:CB is 0.72–0.89.
- **True value rework (`model/truevalue.py`):**
  - Production per game or try, shrunk to the pool.
  - Snap share z-scored, not ranked.
  - Pay counts only post-debut deals, imputed when missing, ranked within sub-groups.
  - QB rushing counts like passing, and RBs have their own rushing measures.
  - Units are position-specific.
  - K is distance-adjusted; P uses net average and inside-20 rate.
  - Seasons under 4 games lean on the player's previous full season.

  Regulars' year-over-year correlation went from 0.570 to 0.667. Win correlation vs real seasons (2015/2017/2019) is 0.839 / 0.845 / 0.802. The 2014 redraft is 95.3% historical.
  - **`PRIOR_SEASON_GAMES = 2` is on (Daniel's call, same day; HANDOFF §2 player-value row and §6.2 amended).** Every season carries two games' worth of the player's previous full season, so a 16-game season keeps 16/18 of itself, and nothing reads a later season. Results:
    - Regulars' year-over-year r: 0.667 → 0.738 (QB 0.60, RB 0.82, K 0.60, P 0.69, OL 0.66).
    - Win correlation vs real: 0.834 / 0.840 / 0.812 for 2015 / 2017 / 2019.
    - 2014 redraft: 94.9% historical; fingerprints re-recorded.
- **Draft-class position-mix test pools five seeded classes.** One class's L1 swings 0.08–0.21 by seed.
- **Weeks without a game explain themselves** (`screens/shared/scheduleNotes.ts`). The reported "week 2 after break camp" was the Dashboard's next-opponent line: the 2017 Dolphins had no week-1 game. The real disruptions in 2010–2025 are:
  - 2017 MIA/TB, week 1 (Hurricane Irma; played in week 11)
  - 2022 BUF/CIN, week 17 (canceled after Damar Hamlin's cardiac arrest)

  Any other week off reads as a bye. A test scans every shipped schedule.

## 2026-10-08 — Jets playthrough QA fix round

A normal-fan playthrough of the 2017–2018 Jets and a QA review of each season (findings in that session's
scratchpad, `qa/findings-2017.md`, `qa/findings-2018.md`). Daniel picked the fixes and made the calls below.

- **Real absences by real week (2017 H1/M6, 2018 M5).** Each season chunk carries each player's missed regular-season weeks as
  `{from, to, reason}`: injury, suspension, out of football, or benched (`build/absences.py`). Lifecycle publishes the
  coming season's board as `state.absences` at new game, at the Super Bowl and each week. It marks every rostered player
  injured for exactly those weeks: bench players, in-season signings and trades included. This replaces the
  starter-only availability threshold.
  - The UI shows "Out wk 6–17 · injury" / "Out of football in 2017" on FA rows, the offer panel, Roster and the player
    card. Daniel accepted that this reveals future injuries.
  - Out-of-football players count as absent (Daniel's call). Healthy scratches don't count; practice squad counts as out.
  - Benched (a healthy consensus starter who took no snaps while a lower-rated teammate played; RG3 2015) applies to AI
    teams only and shows "Benched wk 2–17". The user's team may play anyone.
  - AI teams sign a healthy free agent when a position group has no healthy player. AI FA valuation is unchanged, so the AI
    can still sign a whole-year absentee.
  - Real seasons roll random injuries at `realSeasonRateScale` 0.15 (procedural seasons keep 1.1), since real absences
    already carry rostered players' injuries. Missed weeks match the real weeks of the players the sim rosters within
    about 6%.
- **The user's depth chart order sticks (2017 H2, 2018 M7/L1).** This replaces the 2026-10-06 "a trade appends" rule.
  - Injured players keep their slot, and the sim plays the next healthy man.
  - Reset to consensus ignores injuries.
  - Draft, UDFA, FA, trade and waiver arrivals land at the slot their consensus earns, without re-sorting anyone else,
    and a toast names the slot ("Adams placed at S1"). An arrival can land ahead of a hand-placed lower-rated player
    (Daniel: keep).
  - AI charts are unchanged.
- **Starter trades cost about a 2nd (2017 M1).** The starter-loss charge is capped at 25% of the departing players' value.
  QBs stay uncapped (Daniel: keep), so a starting QB still costs well over a 2nd.
  - `trade.evaluate` returns `priceHint`, and the acceptance bar reads "They'd want about a 2nd."
  - Cheapest pick that lands a 72–80 starter (2017): R1 37% → 22%, R2 34% → 39%, R3 14% → 24%.
- **Consensus refreshes when the Super Bowl ends (2017 M4)**, for season + 1, instead of at the camp roll. The Recap,
  re-signing, FA, trades and the draft all price on it.
- **Departures at the roll (2018 M3).** Real players with no later season show "Leaving football" and can't be re-signed by
  the user or the AI. The user's departures file a `LEFT_LEAGUE` move and a notice.
- **Offseason dead money (2018 H1/M1).** A release after the Super Bowl books its dead money on the next league year
  (`TeamState.carriedDeadMoney`), which survives the roll, so offseason cuts are no longer free. The Dashboard, the
  Roster cutdown panel, Finances and the trade AI's offseason cap book read next season's books. The over-cap alert only
  claims a block where the engine blocks.
- **NFL tiebreaks (2018 M2)** (`league/tiebreak.ts`): division and wild-card procedures through strength of schedule,
  then point differential and team id. Real 2017 and 2018 seeds replay exactly.
- **New Game asks before replacing a save (2017 L1).**
- **Lineman true values (2017 L4).** DL rate mostly on their own pass rush. OL rate on full-time starting, the line unit
  shared by snaps, penalties, a fading draft-slot prior, and pay at .34 instead of .48. Nose tackles lose 5–8 points.
  Solder and Kelce 2018 can't be read from nflverse.
- **Contracts with no usable id** now match by name plus draft slot or birth date (`build/contract_ids.py`, shared by the
  roster build and the model). This affects about 186 roster-seasons, mostly OL (Joe Thomas 2017: $0.5M → $11.5M).
- **Real contract hints carry years left** (`year_signed + years − season`), not total length. Before, 59% of hinted
  opening-roster contracts reset to full length every year. AI re-sign volume rose about 50%.
- **DROY weights** were refit to real voting (LB .95, CB .8, S .75). Real box scores now pick DBs 23% of the time, matching
  the voters.
- **Calibration after all of it:** win correlation vs real 0.812 / 0.835 / 0.806 (2015 / 2017 / 2019). All stat bands are in
  range except the 2015 rushing leader (1282, unchanged from before). 2014 redraft 94.5%.
