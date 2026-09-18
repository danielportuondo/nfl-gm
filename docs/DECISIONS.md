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
