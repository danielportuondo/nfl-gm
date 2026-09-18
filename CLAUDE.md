# Gridiron GM — project conventions

Browser NFL general-manager sim with a hindsight twist. The full brief, locked decisions, specs, and
phase plan are in **`docs/HANDOFF.md`** — read the sections your task cites. The orchestrator (main
session) owns integration; subagents own the directories in their brief. Decisions made during the build
are appended to `docs/DECISIONS.md`.

## Layout

- `app/` — Vite + React 19 + TypeScript (strict). `src/contracts` (types, zod schemas, engine
  interfaces — **orchestrator-only**), `src/engine/*` (pure, deterministic, no React), `src/data`
  (loaders), `src/store` (Zustand bridge), `src/ui` (design system), `src/screens/*`.
- `pipeline/` — Python 3.12 / pandas 3 / uv. `gridiron_pipeline/{ingest,build,model,export}`.
- `docs/` — `HANDOFF.md`, `DATA_CONTRACT.md`, `ENGINE_CONTRACT.md` (generated), `DESIGN.md`, `DECISIONS.md`.
- Path aliases: `@contracts/*`, `@engine/*`, `@data/*`, `@store/*`, `@ui/*`, `@screens/*`, `@fixtures/*`.

## Ownership (HANDOFF §3)

Orchestrator-only: `app/src/contracts/`, `docs/*_CONTRACT.md`, `package.json`, `pnpm-lock.yaml`,
`pyproject.toml`, `uv.lock`, `CLAUDE.md`, `.claude/`, `.github/`. Subagents edit only the directories in
their brief and put contract changes / dependency needs under **CONTRACT REQUESTS** in their report.
Subagents do not commit; the orchestrator commits after each fan-out with conventional commit messages.

## The hindsight rule

`LeagueState.scouting` is what everyone in the game knows. `LeagueState.truth` (and the
`trajectories` table) is what really happened. **Nothing under `app/src/screens` or `app/src/ui` reads
truth** — ESLint (`no-restricted-imports`, `no-restricted-properties`) and `tests/truthIsolation.test.ts`
enforce it. Only `engine/sim` (game strength) and `engine/lifecycle` (progression) may read truth. The
draft, trade and FA AIs rank by consensus only.

## Engine conventions

- Modules are objects of pure functions implementing the interfaces in `app/src/contracts/engine/*`.
  Never mutate an input `LeagueState`; return a new one. Cross-module calls go through `ctx.modules`.
- All randomness through `engine/rng`, seeded from `state.seed` + scope (`fromSeed(seed, season,
  week, gameId)`). No `Math.random`, no `Date.now`. Sort before iterating anything unordered.
- Tunables live in a `constants.ts` per module so the balance pass can tune without touching logic.
- Money is $M as a number; ratings are 40–99; seasons are integers; object keys that are seasons are strings.

## Commands

```sh
pnpm install && pnpm -r typecheck && pnpm -r test && pnpm -r lint   # app
pnpm gen:contracts                                                   # regenerate JSON schemas + ENGINE_CONTRACT.md
pnpm --filter app headless -- --team IND --start 2012 --seasons 6    # integration harness (Phase 2+)
pnpm --filter app calibrate -- --season 2015                          # sim calibration (Phase 1D+)
cd pipeline && uv sync && uv run pytest -q && uv run ruff check .    # pipeline
cd pipeline && make data                                             # full data build (idempotent)
pnpm check                                                           # everything the orchestrator runs after a fan-out
```

## Testing philosophy

Light but real. What we test: **determinism** (same seed ⇒ identical league), **truth isolation**
(lint + grep test), the **calibration harness** (win-total correlation, sd of wins, home win %, totals,
ties against real seasons), the **headless multi-season run** (6 seasons, no errors, cap and roster
invariants hold), **a few targeted unit tests per module** that prove that module's acceptance criteria
(hand-written trade scenarios with expected p bands; 2014 redraft ≥ 85% historical; cap invariants over
5 offseasons; consensus never leaks the future), and **one Playwright E2E smoke flow**. No coverage
thresholds. Do not write tests for trivial code. A test that asserts a distribution beats ten that
assert shapes. Vitest default environment is `node`; UI tests add `// @vitest-environment jsdom`.

## Style

TypeScript strict, `noUncheckedIndexedAccess` on. Small pure functions, well-named identifiers,
comments only for non-obvious WHY. Prettier (no semicolons, single quotes, 100 cols). Python: ruff,
type hints, pandas idioms, no notebooks required. Copy in the UI: plain verbs, sentence case.

## Commit style

Conventional commits: `feat(sim): …`, `fix(draft): …`, `chore: …`, `docs: …`, `test(league): …`.
One commit per logical unit. Commit after every phase and every integration fix. Tags: `v0.5-alpha`
after Phase 4, `v1.0.0` at ship.

## Data ethics (non-negotiable)

nflverse data under CC BY 4.0 with attribution in every generated file and in the About screen. No
player photos, no team logos or wordmarks, no code from ZenGM/Football GM or any other game, no ads or
payments. See `DATA_LICENSE.md`.
