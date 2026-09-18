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
