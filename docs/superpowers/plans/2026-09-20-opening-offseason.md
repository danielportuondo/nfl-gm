# Opening Offseason Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new game at season S opens at the DRAFT phase of the offseason before S, with the S class on the board and the real S order in place; calibration keeps the old PRESEASON start.

**Architecture:** `league.newGame` gets `startAt: 'DRAFT' | 'PRESEASON'` (default DRAFT). The DRAFT path filters the S class out of the season chunk before building, seeds picks for S, S+1, S+2 and sets `season = S − 1`, `phase = 'DRAFT'`. The one special case is the TRAINING_CAMP → PRESEASON rollover, which skips player-state mutations when `isOpeningOffseason(state)` (`season < startSeason`). Draft, pick discounting, anchoring and cutdowns are untouched. The UI labels offseason phases by the upcoming year.

**Tech Stack:** TypeScript strict, React 19, Zustand, Vitest (node; UI tests `// @vitest-environment jsdom`), Playwright, pnpm. Prettier: no semicolons, single quotes, 100 cols.

**Spec:** `docs/superpowers/specs/2026-09-20-opening-offseason-design.md`

## Global Constraints

- Orchestrator-only files: `app/src/contracts/`, `docs/*_CONTRACT.md`, `package.json`, `pnpm-lock.yaml`, `pyproject.toml`, `uv.lock`, `CLAUDE.md`, `.claude/`, `.github/`. Subagents put contract needs under **CONTRACT REQUESTS** in their report.
- Nothing under `app/src/screens` or `app/src/ui` reads `state.truth` (ESLint + `tests/truthIsolation.test.ts`).
- Engine modules are pure: never mutate an input `LeagueState`; all randomness through `engine/rng`; sort before iterating anything unordered.
- No `git stash` in any task. Subagents do not commit; the orchestrator commits after each task lands.
- Copy in the UI: plain verbs, sentence case. Comments only for non-obvious WHY.
- Commands run from `app/`: `pnpm typecheck`, `pnpm test <path>`, `pnpm lint`, `pnpm exec prettier --check .`; from the repo root `pnpm check` runs everything.
- Header text after this plan: `2013 offseason · Draft` during the opening offseason of a 2013 start; `2013 · Preseason`, `2013 · Regular season · week 5` in season.

---

### Task 1: Contract — `startAt` and `isOpeningOffseason` (orchestrator)

**Files:**
- Modify: `app/src/contracts/engine/league.ts:25-32` (NewGameOptions) and `:40-49`, `:60-70` (doc comments)
- Regenerate: `docs/ENGINE_CONTRACT.md` via `pnpm gen:contracts`

**Interfaces:**
- Produces: `NewGameOptions.startAt?: 'DRAFT' | 'PRESEASON'`; `isOpeningOffseason(state: LeagueState): boolean`, exported from `@contracts/index` (the `engine` barrel re-exports `league.ts`).

- [ ] **Step 1: Add the option and the predicate**

```ts
export interface NewGameOptions {
  seed: string
  startSeason: Season
  userTeam: TeamId
  /** Number of seasons to win it all in (1–10). horizonEnd = startSeason + horizonSeasons − 1. */
  horizonSeasons: number
  settings: GameSettings
  /**
   * Where the game opens. 'DRAFT' (default): the offseason before `startSeason`, at the draft of the
   * startSeason class — `season` is startSeason − 1 until the TRAINING_CAMP rollover. 'PRESEASON':
   * opening day of `startSeason` with that year's rookies already rostered (calibration harnesses).
   */
  startAt?: 'DRAFT' | 'PRESEASON'
}

/**
 * True between newGame(startAt: 'DRAFT') and the first TRAINING_CAMP → PRESEASON rollover: the state
 * describes `startSeason` (rosters, contracts, consensus, truth) while `season` is still startSeason − 1
 * so the draft-year convention (season X drafts the X+1 class) needs no special case.
 */
export function isOpeningOffseason(state: LeagueState): boolean {
  return state.season < state.startSeason
}
```

- [ ] **Step 2: Update the `newGame` and `advancePhase` doc comments**

`newGame`: replace "real pick ownership for the next 2 drafts (… startSeason+1 and +2 …), real schedule, phase PRESEASON" with: "By default (startAt 'DRAFT') the startSeason class is removed from rosters and players, picks are owned for startSeason, +1 and +2, `season` is startSeason − 1, phase DRAFT and no schedule yet; with startAt 'PRESEASON' the rookies stay rostered, picks are +1 and +2, the real schedule is built and the phase is PRESEASON."

`advancePhase`, TRAINING_CAMP line: append "— except in the opening offseason (`isOpeningOffseason`), where contracts, progression, retirements and the consensus refresh are skipped because the state already describes the new season; dead money is zeroed and the snap, picks and schedule still run."

- [ ] **Step 3: Regenerate and verify**

Run: `cd /Users/daniel.portuondo/nfl-gm && pnpm gen:contracts && cd app && pnpm typecheck`
Expected: `docs/ENGINE_CONTRACT.md` changes; typecheck clean (the option is optional, so no caller breaks).

- [ ] **Step 4: Commit**

```bash
git add app/src/contracts/engine/league.ts docs/ENGINE_CONTRACT.md
git commit -m "feat(contracts): NewGameOptions.startAt and isOpeningOffseason"
```

---

### Task 2: `league.newGame` opens at the draft (league-engine)

**Files:**
- Modify: `app/src/engine/league/index.ts:870-946` (`newGameImpl`)
- Test: `app/tests/engine/league/league.test.ts`

**Interfaces:**
- Consumes: `NewGameOptions.startAt` (Task 1), `ctx.modules.draft.buildDraftOrder(state, season, ctx)`.
- Produces: `league.newGame` default → `{ season: S − 1, phase: 'DRAFT', schedule: [], picks: S ∪ S+1 ∪ S+2, no class member in players/rosters/freeAgents }`; `startAt: 'PRESEASON'` → today's state exactly.

- [ ] **Step 1: Write the failing tests**

Add to `app/tests/engine/league/league.test.ts` (imports already include `SavedLeagueSchema`, `TEAM_IDS`, `toSaved`, `mockBundle`, `league`, `makeFakeContext`):

```ts
/** A mock 2015 bundle with one member of the 2015 class already on IND's opening-day roster. */
function bundleWithRosteredRookie() {
  const bundle = mockBundle({ season: 2015 })
  const sd = bundle.seasons[2015]!
  const rookie = sd.draft.prospects[0]!
  sd.players.players.push({ ...rookie, trueValue: rookie.scouting.ovr, team: 'IND' })
  sd.rosters.rosters.IND!.push({ playerId: rookie.id, apy: 1, years: 4, depth: 99 })
  return { bundle, rookie }
}

describe('league.newGame opening offseason', () => {
  it('opens at the DRAFT phase of the season before, with the start class off the rosters', () => {
    const { bundle, rookie } = bundleWithRosteredRookie()
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts(), ctx)

    expect(state.season).toBe(2014)
    expect(state.startSeason).toBe(2015)
    expect(state.phase).toBe('DRAFT')
    expect(state.week).toBe(0)
    expect(state.schedule).toHaveLength(0)
    expect(state.draftRoom).toBeNull()

    expect(state.players[rookie.id]).toBeUndefined()
    expect(state.scouting[rookie.id]).toBeUndefined()
    expect(state.truth[rookie.id]).toBeUndefined()
    expect(state.freeAgents).not.toContain(rookie.id)
    for (const id of TEAM_IDS)
      expect(state.teams[id]!.roster.some((r) => r.playerId === rookie.id), id).toBe(false)
    expect(state.teams.IND!.roster).toHaveLength(53)

    const seasons = new Set(state.picks.map((p) => p.season))
    expect(seasons).toEqual(new Set([2015, 2016, 2017]))
    const classPicks = state.picks.filter((p) => p.season === 2015)
    expect(classPicks.length).toBeGreaterThan(0)
    expect(classPicks.every((p) => p.pick !== null)).toBe(true)

    const parsed = SavedLeagueSchema.safeParse(toSaved(state))
    expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 5), null, 2)).toBe(true)
  })

  it("startAt 'PRESEASON' keeps opening day: rookies rostered, picks for +1/+2, schedule built", () => {
    const { bundle, rookie } = bundleWithRosteredRookie()
    const ctx = makeFakeContext(bundle)
    const state = league.newGame(newGameOpts({ startAt: 'PRESEASON' }), ctx)

    expect(state.season).toBe(2015)
    expect(state.phase).toBe('PRESEASON')
    expect(state.players[rookie.id]).toBeDefined()
    expect(state.teams.IND!.roster.some((r) => r.playerId === rookie.id)).toBe(true)
    expect(new Set(state.picks.map((p) => p.season))).toEqual(new Set([2016, 2017]))
    expect(state.schedule.length).toBeGreaterThan(0)
  })

  it('is deterministic for a seed', () => {
    const ctx = makeFakeContext(mockBundle({ season: 2015 }))
    const a = league.newGame(newGameOpts({ seed: 'open-a' }), ctx)
    const b = league.newGame(newGameOpts({ seed: 'open-a' }), ctx)
    expect(toSaved(a)).toEqual(toSaved(b))
  })
})
```

Also change the existing `'produces a SavedLeagueSchema-valid state with 32x53 rosters and the real schedule'` test to call `league.newGame(newGameOpts({ startAt: 'PRESEASON' }), ctx)` — it asserts opening-day shape. Leave the other existing tests alone for now; the `league season loop (fakes)` tests start from `newGame` and will be revisited in Task 3.

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/league/league.test.ts`
Expected: the two new opening tests FAIL (`season` is 2015, `phase` PRESEASON); the PRESEASON test PASSES.

- [ ] **Step 3: Implement**

Replace `newGameImpl` in `app/src/engine/league/index.ts` with:

```ts
/**
 * The season chunk with the start class removed. Class members re-enter through
 * draft.startDraft → loadClass with pre-draft scouting and `draft: null`, exactly like every later
 * class; the class is the data's own definition (`draft.prospects`), not a rookieSeason heuristic.
 */
function withoutClass(sd: SeasonData): SeasonData {
  const classIds = new Set(sd.draft.prospects.map((p) => p.id))
  const rosters: SeasonData['rosters']['rosters'] = {}
  for (const teamId of Object.keys(sd.rosters.rosters).sort()) {
    rosters[teamId] = (sd.rosters.rosters[teamId] ?? []).filter((e) => !classIds.has(e.playerId))
  }
  return {
    ...sd,
    players: { ...sd.players, players: sd.players.players.filter((p) => !classIds.has(p.id)) },
    rosters: { ...sd.rosters, rosters },
  }
}

/** Opening day of startSeason from a (possibly filtered) chunk: players, rosters, contracts, cap fit. */
function buildOpeningDay(opts: NewGameOptions, ctx: EngineContext, sd: SeasonData): LeagueState {
  const { players, scouting, truth } = buildPlayersFromSeason(
    sd.players.players,
    ctx.trajectories,
    opts.startSeason,
  )

  let draft: LeagueState = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    seed: opts.seed,
    season: opts.startSeason,
    week: 0,
    phase: 'PRESEASON',
    userTeam: opts.userTeam,
    horizonEnd: opts.startSeason + opts.horizonSeasons - 1,
    startSeason: opts.startSeason,
    settings: opts.settings,
    teams: {},
    players,
    scouting,
    truth,
    picks: [],
    schedule: [],
    results: [],
    history: [],
    divergence: new Set<PlayerId>(),
    freeAgents: sd.players.players.filter((p) => p.team === null).map((p) => p.id),
    draftRoom: null,
    snapLog: [],
    outcome: 'IN_PROGRESS',
    savedAt: EPOCH,
  }

  const teams: Record<TeamId, TeamState> = {}
  for (const teamId of TEAM_IDS) {
    const entries = sd.rosters.rosters[teamId] ?? []
    const roster: RosterSlot[] = entries.map((e) => ({
      playerId: e.playerId,
      teamId,
      contract: ctx.modules.fa.synthesizeContract(
        { ...draft, teams },
        e.playerId,
        opts.startSeason,
        ctx,
        { apy: e.apy, years: e.years },
      ),
    }))
    teams[teamId] = {
      id: teamId,
      roster,
      depthChart: buildDepthChartFrom(roster, scouting, players),
      record: { ...ZERO_RECORD },
      deadMoney: 0,
      tradeAnnoyance: 0,
      userControlled: teamId === opts.userTeam,
    }
  }
  draft = { ...draft, teams }
  for (const teamId of TEAM_IDS) draft = fitPayrollToCap(draft, teamId, ctx)
  return draft
}

function newGameImpl(opts: NewGameOptions, ctx: EngineContext): LeagueState {
  const loaded = ctx.seasonData(opts.startSeason)
  if (!loaded) throw new SeasonNotLoadedError(opts.startSeason)
  const startAt = opts.startAt ?? 'DRAFT'
  const S = opts.startSeason

  if (startAt === 'PRESEASON') {
    // The startSeason draft already happened (its rookies are on the rosters); the next two drafts
    // are the S+1 and S+2 classes (draft-year convention in contracts/engine/draft.ts).
    let state = buildOpeningDay(opts, ctx, loaded)
    const picks = [
      ...ctx.modules.draft.buildDraftOrder(state, S + 1, ctx),
      ...ctx.modules.draft.buildDraftOrder(state, S + 2, ctx),
    ]
    state = { ...state, picks }
    return { ...state, schedule: buildScheduleImpl(state, ctx) }
  }

  // Opening offseason: the S class is on the board and the real S order is in place. `season` is
  // S − 1 so season X's DRAFT phase drafting the X+1 class holds without a special case; the
  // TRAINING_CAMP rollover into S skips progression and contract ticks (isOpeningOffseason).
  let state = buildOpeningDay(opts, ctx, withoutClass(loaded))
  const picks = [S, S + 1, S + 2].flatMap((season) =>
    ctx.modules.draft.buildDraftOrder(state, season, ctx),
  )
  state = { ...state, picks, season: S - 1, phase: 'DRAFT' }
  return state
}
```

Add `SeasonData` to the `@contracts/index` type import at the top of the file if it is not there.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/league/league.test.ts && pnpm typecheck`
Expected: the three opening tests and the PRESEASON test PASS. The `league season loop (fakes)` tests may now fail because they start from `newGame` expecting PRESEASON — that is Task 3's job; note which ones.

- [ ] **Step 5: Orchestrator commits**

```bash
git add app/src/engine/league/index.ts app/tests/engine/league/league.test.ts
git commit -m "feat(league): newGame opens at the draft of the start class (startAt 'DRAFT')"
```

---

### Task 3: The opening rollover (league-engine)

**Files:**
- Modify: `app/src/engine/league/index.ts:815-835` (`case 'TRAINING_CAMP'`)
- Test: `app/tests/engine/league/league.test.ts`

**Interfaces:**
- Consumes: `isOpeningOffseason` from `@contracts/index` (Task 1).
- Produces: after the opening rollover `season === startSeason`, `phase === 'PRESEASON'`, contracts and scouting unchanged, `deadMoney` 0 on every team, schedule for `startSeason` built.

- [ ] **Step 1: Write the failing tests**

Add to `app/tests/engine/league/league.test.ts` (add `vi` to the vitest import and `fakeFa`, `fakeLifecycle` to the `../fakes` import):

```ts
function snapshotContracts(state: LeagueState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const id of TEAM_IDS)
    for (const slot of state.teams[id]!.roster) out[`${id}:${slot.playerId}`] = slot.contract
  return out
}

/** DRAFT → UDFA → FREE_AGENCY → TRAINING_CAMP → PRESEASON with the draft fakes. */
function playOpeningOffseason(state: LeagueState, ctx: ReturnType<typeof makeFakeContext>) {
  let s = ctx.modules.draft.startDraft(state, ctx)
  s = ctx.modules.draft.autoDraftToEnd(s, ctx)
  s = league.advancePhase(s, ctx) // -> UDFA
  s = league.advancePhase(s, ctx) // -> FREE_AGENCY
  s = league.advancePhase(s, ctx) // -> TRAINING_CAMP
  s = league.advancePhase(s, ctx) // -> PRESEASON (opening rollover)
  return s
}

describe('league opening rollover', () => {
  it('rolls into startSeason without ticking contracts, progressing or retiring anyone', () => {
    const rollover = vi.fn(fakeFa.rolloverContracts)
    const progress = vi.fn(fakeLifecycle.progressSeason)
    const retire = vi.fn(fakeLifecycle.retirements)
    const refresh = vi.fn(fakeLifecycle.refreshScouting)
    const bundle = mockBundle({ season: 2015 })
    const ctx = makeFakeContext(bundle, {
      fa: { ...fakeFa, rolloverContracts: rollover },
      lifecycle: { ...fakeLifecycle, progressSeason: progress, retirements: retire, refreshScouting: refresh },
    })
    const opening = league.newGame(newGameOpts(), ctx)
    const withDeadMoney: LeagueState = {
      ...opening,
      teams: { ...opening.teams, IND: { ...opening.teams.IND!, deadMoney: 5 } },
    }
    const before = snapshotContracts(withDeadMoney)

    const s = playOpeningOffseason(withDeadMoney, ctx)

    expect(s.season).toBe(2015)
    expect(s.phase).toBe('PRESEASON')
    expect(s.week).toBe(0)
    expect(rollover).not.toHaveBeenCalled()
    expect(progress).not.toHaveBeenCalled()
    expect(retire).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(snapshotContracts(s)).toEqual(before)
    expect(s.scouting).toEqual(opening.scouting)
    for (const id of TEAM_IDS) expect(s.teams[id]!.deadMoney, id).toBe(0)
    expect(s.schedule.length).toBe(
      bundle.seasons[2015]!.schedule.games.filter((g) => g.type === 'REG').length,
    )
    expect(new Set(s.picks.map((p) => p.season))).toEqual(new Set([2015, 2016, 2017]))
  })

  it('runs the normal rollover after the first season is played', () => {
    const rollover = vi.fn(fakeFa.rolloverContracts)
    const progress = vi.fn(fakeLifecycle.progressSeason)
    const ctx = makeFakeContext(mockBundle({ season: 2015 }), {
      fa: { ...fakeFa, rolloverContracts: rollover },
      lifecycle: { ...fakeLifecycle, progressSeason: progress },
    })
    let s = playOpeningOffseason(league.newGame(newGameOpts(), ctx), ctx)
    s = league.advancePhase(s, ctx) // PRESEASON -> REGULAR
    s = playSeason(s, ctx)
    expect(s.phase).toBe('OFFSEASON_RESIGN')
    s = playOffseason(s, ctx)
    expect(s.season).toBe(2016)
    expect(rollover).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledTimes(1)
  })

  it('is deterministic through the opening offseason', () => {
    const run = () => {
      const ctx = makeFakeContext(mockBundle({ season: 2015 }))
      return toSaved(playOpeningOffseason(league.newGame(newGameOpts({ seed: 'roll-a' }), ctx), ctx))
    }
    expect(run()).toEqual(run())
  })
})
```

`playSeason` and `playOffseason` already exist in this file (`playOffseason` expects `OFFSEASON_RESIGN` and drives to REGULAR week 1 of the next season; read it and adapt the `expect(s.season)` if it returns at a different point). Then fix the `league season loop (fakes)` tests broken by Task 2: they should start from `league.newGame(newGameOpts({ startAt: 'PRESEASON' }), ctx)` where they assert the PRESEASON → REGULAR path, or run `playOpeningOffseason` first where the point is the full cycle. Keep their assertions.

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/league/league.test.ts`
Expected: `rolls into startSeason…` FAILS (`rollover` called; contracts changed by the fake tick if the fake ticks, and `season` still becomes 2015 — read the failure, do not guess).

- [ ] **Step 3: Implement**

In `advancePhaseImpl`, replace the `case 'TRAINING_CAMP'` block:

```ts
    case 'TRAINING_CAMP': {
      const newSeason = state.season + 1
      let s: LeagueState = { ...state, season: newSeason, week: 0 }
      if (isOpeningOffseason(state)) {
        // newGame(startAt 'DRAFT') built rosters, contracts, consensus and truth from the newSeason
        // chunk already; ticking or progressing them here would move everyone a year too far.
        s = { ...s, teams: zeroDeadMoney(s.teams) }
      } else {
        const rolled = ctx.modules.fa.rolloverContracts(s, ctx)
        s = rolled.state
        const progressRng = ctx.modules.rng.fromSeed(s.seed, newSeason, 'progress')
        s = ctx.modules.lifecycle.progressSeason(s, ctx, progressRng)
        const retireRng = ctx.modules.rng.fromSeed(s.seed, newSeason, 'retirements')
        const retired = ctx.modules.lifecycle.retirements(s, ctx, retireRng)
        s = retired.state
        s = ctx.modules.lifecycle.refreshScouting(s, ctx)
      }
      if (isInHistory(ctx, newSeason)) {
        s = ctx.modules.history.snapToHistory(s, ctx)
        for (const teamId of TEAM_IDS)
          if (teamId !== s.userTeam) s = fitPayrollToCap(s, teamId, ctx)
      }
      s = { ...s, teams: resetSeasonCounters(s.teams) }
      s = ensureFuturePicks(s, ctx)
      const newGames = buildScheduleImpl(s, ctx)
      s = { ...s, schedule: [...s.schedule, ...newGames], phase: 'PRESEASON' }
      return s
    }
```

Add next to `resetSeasonCounters`:

```ts
/** The opening rollover skips fa.rolloverContracts, which is where dead money normally resets. */
function zeroDeadMoney(teams: Record<TeamId, TeamState>): Record<TeamId, TeamState> {
  return Object.fromEntries(
    Object.entries(teams).map(([id, t]) => [id, { ...t, deadMoney: 0 }]),
  )
}
```

Import `isOpeningOffseason` from `@contracts/index`.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/league && pnpm typecheck && pnpm lint`
Expected: all league tests PASS, including the repaired season-loop tests.

- [ ] **Step 5: Orchestrator commits**

```bash
git add app/src/engine/league/index.ts app/tests/engine/league/league.test.ts
git commit -m "feat(league): opening rollover keeps the start-season rosters and contracts"
```

---

### Task 4: Trade valuation ignores the missing prior chunk (trade-ai)

**Files:**
- Modify: `app/src/engine/trade/value.ts:60-68` (`seasonStartOvr`)
- Create: `app/tests/engine/trade/openingOffseason.test.ts`

**Interfaces:**
- Consumes: `isOpeningOffseason` from `@contracts/index` (Task 1).
- Produces: `seasonStartOvr(state, ctx)` returns an empty `Map` and never calls `ctx.seasonData` while `isOpeningOffseason(state)`.

- [ ] **Step 1: Write the failing test**

```ts
import { SeasonNotLoadedError, type EngineContext, type Season } from '@contracts/index'
import { seasonStartOvr } from '@engine/trade/value'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'
import { describe, expect, it } from 'vitest'
import { makeFakeContext } from '../fakes'

/** A context that, like the app and the scripts, throws for an in-history season that is not loaded. */
function strictContext(): EngineContext {
  const bundle = mockBundle({ season: 2015 })
  const ctx = makeFakeContext(bundle)
  return {
    ...ctx,
    seasonData: (season: Season) => {
      const chunk = bundle.seasons[season]
      if (chunk) return chunk
      throw new SeasonNotLoadedError(season)
    },
  }
}

describe('seasonStartOvr in the opening offseason', () => {
  it('is empty before the first season and never asks for the prior chunk', () => {
    const ctx = strictContext()
    const opening = { ...mockLeague({ season: 2015 }), season: 2014, startSeason: 2015, phase: 'DRAFT' as const }
    expect(seasonStartOvr(opening, ctx).size).toBe(0)
  })

  it('still reads the season chunk once the season is under way', () => {
    const ctx = strictContext()
    expect(seasonStartOvr(mockLeague({ season: 2015 }), ctx).size).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/trade/openingOffseason.test.ts`
Expected: first test FAILS with `SeasonNotLoadedError` for 2014.

- [ ] **Step 3: Implement**

```ts
export function seasonStartOvr(state: LeagueState, ctx: EngineContext): Map<PlayerId, number> {
  const cached = startOvrCache.get(state)
  if (cached) return cached
  const map = new Map<PlayerId, number>()
  // Before the first season there is no in-season drop to detect, and the chunk for `season`
  // (startSeason − 1) may not exist at all for a 2010 start.
  if (!isOpeningOffseason(state)) {
    const chunk = ctx.seasonData(state.season)
    for (const p of chunk?.players.players ?? []) map.set(p.id, p.scouting.ovr)
  }
  startOvrCache.set(state, map)
  return map
}
```

Add `isOpeningOffseason` to the `@contracts/index` import.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/trade && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Orchestrator commits**

```bash
git add app/src/engine/trade/value.ts app/tests/engine/trade/openingOffseason.test.ts
git commit -m "fix(trade): no season-start consensus lookup during the opening offseason"
```

---

### Task 5: Real-data integration test for the opening offseason (league-engine, after Tasks 2–4)

**Files:**
- Modify: `app/tests/integration/realData.test.ts`

**Interfaces:**
- Consumes: `league.newGame` default (Task 2), opening rollover (Task 3), trade guard (Task 4), `userDraft`, `userFreeAgency`, `userCutdowns`, `emptyLog` from `app/scripts/lib/scriptedGm.ts`.

- [ ] **Step 1: Pin the existing tests and add the opening test**

Change the `newGame` helper so existing tests keep opening-day semantics, and add the opening helpers:

```ts
import { emptyLog, userCutdowns, userDraft, userFreeAgency } from '../../scripts/lib/scriptedGm'
import { TEAM_IDS, toSaved, type EngineContext, type LeagueState } from '@contracts/index'

function newGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame(
    { seed, startSeason: SEASON, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS, startAt: 'PRESEASON' },
    ctx,
  )
}

function newOpeningGame(ctx: EngineContext, seed: string): LeagueState {
  return ctx.modules.league.newGame(
    { seed, startSeason: SEASON, userTeam: 'IND', horizonSeasons: 1, settings: SETTINGS },
    ctx,
  )
}

/** The user's opening offseason as the store drives it: draft, UDFA, free agency, camp, cutdowns. */
function playOpeningOffseason(state: LeagueState, ctx: EngineContext) {
  const { league, draft } = ctx.modules
  const log = emptyLog()
  let s = draft.startDraft(state, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx) // DRAFT → UDFA
  s = league.advancePhase(s, ctx) // UDFA → FREE_AGENCY
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx) // FREE_AGENCY → TRAINING_CAMP
  s = league.advancePhase(s, ctx) // TRAINING_CAMP → PRESEASON (opening rollover)
  s = userCutdowns(s, ctx, log)
  return { state: s, log }
}
```

New test inside the existing `describe`:

```ts
  it(`opens before the ${SEASON} draft and reaches opening day on real rosters`, () => {
    const sd = ctx.seasonData(SEASON)!
    const opening = newOpeningGame(ctx, 'real-opening')
    expect(opening.season).toBe(SEASON - 1)
    expect(opening.phase).toBe('DRAFT')
    for (const p of sd.draft.prospects) expect(opening.players[p.id], p.name).toBeUndefined()
    const classPicks = opening.picks.filter((p) => p.season === SEASON)
    expect(classPicks).toHaveLength(sd.draft.order.length)
    expect(classPicks.every((p) => p.pick !== null)).toBe(true)
    expect(new Set(opening.picks.map((p) => p.season))).toEqual(
      new Set([SEASON, SEASON + 1, SEASON + 2]),
    )

    const { state: pre, log } = playOpeningOffseason(opening, ctx)
    expect(pre.season).toBe(SEASON)
    expect(pre.phase).toBe('PRESEASON')
    expect(log.drafted.length).toBeGreaterThan(0)

    // PRESEASON → REGULAR runs AI cutdowns and validates every roster (throws otherwise).
    const s = ctx.modules.league.advancePhase(pre, ctx)
    expect(s.phase).toBe('REGULAR')
    const seen = new Map<string, string>()
    for (const teamId of TEAM_IDS) {
      const roster = s.teams[teamId]!.roster
      expect(roster.length, teamId).toBeGreaterThanOrEqual(46)
      expect(roster.length, teamId).toBeLessThanOrEqual(53)
      for (const slot of roster) {
        expect(seen.get(slot.playerId), slot.playerId).toBeUndefined()
        seen.set(slot.playerId, teamId)
      }
    }

    // The snap plus anchored cutdowns put AI teams back on their real opening-day rosters
    // (headless measures 99 % mean / 96 % min after a normal rollover).
    let sum = 0
    let n = 0
    for (const teamId of TEAM_IDS) {
      if (teamId === 'IND') continue
      const real = new Set((sd.rosters.rosters[teamId] ?? []).map((e) => e.playerId))
      const have = s.teams[teamId]!.roster.filter((r) => real.has(r.playerId)).length
      sum += have / real.size
      n++
    }
    expect(sum / n).toBeGreaterThanOrEqual(0.9)

    // The user's drafted rookies carry a draft origin for this class and a rookie contract.
    const userRoster = s.teams.IND!.roster
    const kept = log.drafted.filter((d) => userRoster.some((r) => r.playerId === d.playerId))
    expect(kept.length).toBeGreaterThan(0)
    for (const d of kept) {
      const p = s.players[d.playerId]!
      expect(p.draft?.season, p.name).toBe(SEASON)
      expect(p.draft?.team, p.name).toBe('IND')
      expect(userRoster.find((r) => r.playerId === d.playerId)!.contract.rookie).toBe(true)
    }

    const again = ctx.modules.league.advancePhase(
      playOpeningOffseason(newOpeningGame(ctx, 'real-opening'), ctx).state,
      ctx,
    )
    expect(toSaved(again)).toEqual(toSaved(s))
  })
```

- [ ] **Step 2: Run**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/integration/realData.test.ts`
Expected: all four tests PASS (the three existing ones unchanged in behaviour). If the overlap assertion fails, print the per-team shares and report the numbers instead of lowering the bar.

- [ ] **Step 3: Orchestrator commits**

```bash
git add app/tests/integration/realData.test.ts
git commit -m "test(league): opening offseason on the shipped 2015 data"
```

---

### Task 6: Store loader skips seasons the manifest does not list (ui-builder)

**Files:**
- Modify: `app/src/store/index.ts:181-197` (`ensureLoaded`)
- Test: `app/tests/ui/store.test.ts`

**Interfaces:**
- Consumes: `StoreConfig.dataSource: DataSource` (`loadManifest`, `loadStatic`, `loadSeason`, `loadTrajectories`, `clear`), `MemoryDataSource(bundle)` from `@data/index`, `mockBundle`.
- Produces: `ensureLoaded` never calls `dataSource.loadSeason(s)` for `s` not in `manifest.seasons`.

- [ ] **Step 1: Write the failing test**

```ts
import { MemoryDataSource } from '@data/index'
import { mockBundle, mockLeague } from '@fixtures/mockLeague'

async function until(pred: () => boolean, ms = 2_000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('engine-mode chunk loading', () => {
  it('never requests a season chunk the manifest does not list', async () => {
    const bundle = mockBundle({ season: 2015 })
    const source = MemoryDataSource(bundle)
    const loadSeason = vi.fn(source.loadSeason)
    const opening: LeagueState = { ...mockLeague({ season: 2015 }), season: 2014, startSeason: 2015, phase: 'DRAFT' }
    const persistence: PersistenceModule = {
      ...persistenceStub,
      load: async () => opening,
      listSaves: async () => [],
    }
    const store = createGameStore({
      mode: 'engine',
      dataSource: { ...source, loadSeason },
      persistence,
    })
    await until(() => store.getState().dataStatus === 'ready')

    await store.getState().actions.continueGame()

    expect(store.getState().state?.season).toBe(2014)
    expect(loadSeason.mock.calls.map(([s]) => s)).toEqual([2015])
  })
})
```

Check `mockStatic(seed, latestRealSeason)` in `app/tests/fixtures/mockLeague.ts` for the manifest's `seasons` array; if it lists 2014 too, build the bundle and then set `bundle.static.manifest.seasons = [2015]` before constructing the source. `persistenceStub` and `PersistenceModule` are already imported in this file.

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui/store.test.ts -t "never requests"`
Expected: FAIL — `loadSeason` was called with 2014 (and `MemoryDataSource` rejects it, so `continueGame` toasts an error).

- [ ] **Step 3: Implement**

```ts
    /** Loads trajectories once and every in-history chunk in [from, to] that exists and is not cached yet. */
    async function ensureLoaded(from: Season, to: Season): Promise<void> {
      if (!dataSource) return
      const manifest = get().data?.manifest
      const latest = manifest?.latestRealSeason ?? to
      const known = manifest?.seasons
      const wanted: Season[] = []
      for (let s = from; s <= Math.min(to, latest); s++)
        if (!chunks.has(s) && (known === undefined || known.includes(s))) wanted.push(s)
      const loads: Promise<void>[] = wanted.map((s) =>
        dataSource.loadSeason(s).then((chunk) => void chunks.set(s, chunk)),
      )
      if (!trajectoriesLoaded) {
        loads.push(
          dataSource.loadTrajectories().then((table) => {
            trajectories = table
            trajectoriesLoaded = true
          }),
        )
      }
      await Promise.all(loads)
    }
```

- [ ] **Step 4: Run**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Orchestrator commits**

```bash
git add app/src/store/index.ts app/tests/ui/store.test.ts
git commit -m "fix(store): only load season chunks the manifest lists"
```

---

### Task 7: Season label by upcoming year in the Strip, Settings and New Game (ui-builder)

**Files:**
- Modify: `app/src/screens/shared/phaseLabel.ts`
- Modify: `app/src/ui/frame/Strip.tsx` (prop `season: number` → `seasonText: string`)
- Modify: `app/src/App.tsx:36-40` (delete `formatPhase`), `:128-141` (strip props)
- Modify: `app/src/screens/Settings/Settings.tsx:54-57, 130`
- Modify: `app/src/screens/NewGame/NewGame.tsx:110-113` (Continue line)
- Create: `app/tests/ui/phaseLabel.test.ts`

**Interfaces:**
- Produces: `seasonText(season: number, phase: string): string` and `seasonPhaseLabel(season: number, phase: string): { seasonText: string; phaseText: string }` in `app/src/screens/shared/phaseLabel.ts`; `StripProps.seasonText: string` (replaces `season`).

- [ ] **Step 1: Write the failing test** (`app/tests/ui/phaseLabel.test.ts`, node environment)

```ts
import { phaseLabel, seasonPhaseLabel, seasonText } from '@screens/shared/phaseLabel'
import { describe, expect, it } from 'vitest'

describe('season and phase labels', () => {
  it('labels offseason phases by the season they prepare', () => {
    expect(seasonText(2012, 'DRAFT')).toBe('2013 offseason')
    expect(seasonText(2012, 'OFFSEASON_RESIGN')).toBe('2013 offseason')
    expect(seasonText(2012, 'TRAINING_CAMP')).toBe('2013 offseason')
    expect(seasonText(2013, 'PRESEASON')).toBe('2013')
    expect(seasonText(2013, 'REGULAR')).toBe('2013')
    expect(seasonText(2013, 'PLAYOFFS')).toBe('2013')
  })

  it('gives the Strip a capitalised phase and running copy a lowercase one', () => {
    expect(seasonPhaseLabel(2012, 'DRAFT')).toEqual({ seasonText: '2013 offseason', phaseText: 'Draft' })
    expect(seasonPhaseLabel(2013, 'REGULAR')).toEqual({ seasonText: '2013', phaseText: 'Regular season' })
    expect(seasonPhaseLabel(2013, 'UDFA')).toEqual({ seasonText: '2014 offseason', phaseText: 'UDFA' })
    expect(seasonPhaseLabel(2013, 'OFFSEASON_RESIGN').phaseText).toBe('Re-signing period')
    expect(phaseLabel('TRAINING_CAMP')).toBe('training camp')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui/phaseLabel.test.ts`
Expected: FAIL — `seasonText`/`seasonPhaseLabel` are not exported.

- [ ] **Step 3: Implement the helper**

```ts
const PHASE_LABEL: Record<string, string> = {
  PRESEASON: 'preseason',
  REGULAR: 'regular season',
  PLAYOFFS: 'playoffs',
  OFFSEASON_RESIGN: 're-signing period',
  DRAFT: 'draft',
  UDFA: 'UDFA',
  FREE_AGENCY: 'free agency',
  TRAINING_CAMP: 'training camp',
}

const OFFSEASON_PHASES = new Set(['OFFSEASON_RESIGN', 'DRAFT', 'UDFA', 'FREE_AGENCY', 'TRAINING_CAMP'])

/** A phase in the user's words for running copy: "Continue as the Colts: 2015, preseason." */
export function phaseLabel(phase: string): string {
  return PHASE_LABEL[phase] ?? phase.replace(/_/g, ' ').toLowerCase()
}

/**
 * The offseason belongs to the season it prepares: season 2012's DRAFT phase drafts the 2013 class,
 * so it reads "2013 offseason" (and a new game opens in exactly that state).
 */
export function seasonText(season: number, phase: string): string {
  return OFFSEASON_PHASES.has(phase) ? `${season + 1} offseason` : String(season)
}

/** Strip readout parts: "2013 offseason · Draft", "2013 · Regular season". */
export function seasonPhaseLabel(
  season: number,
  phase: string,
): { seasonText: string; phaseText: string } {
  const label = phaseLabel(phase)
  const phaseText = label === 'UDFA' ? label : label.charAt(0).toUpperCase() + label.slice(1)
  return { seasonText: seasonText(season, phase), phaseText }
}
```

- [ ] **Step 4: Wire the Strip, App, Settings and New Game**

Strip: rename the prop and render it.

```ts
export interface StripProps {
  teamAbbr: string
  teamColors: TeamColors
  /** "2013 offseason" during an offseason, "2013" in season (screens/shared/phaseLabel.ts). */
  seasonText: string
  week: number
  phaseLabel: string
  // … unchanged
}
// render:
          <span className="gg-strip__item tabular-nums">
            {seasonText} · {phaseLabel} {inSeason && week > 0 ? `· week ${week}` : ''}
          </span>
```

App.tsx: delete `formatPhase`, import `seasonPhaseLabel` from `@screens/shared/phaseLabel` (check how other shared helpers are imported in App.tsx and match), then:

```ts
  const { seasonText, phaseText } = seasonPhaseLabel(state.season, state.phase)
  // in strip={{ … }}:
        seasonText,
        week: state.week,
        phaseLabel: phaseText,
```

Settings.tsx line 130: `{teamName}, {state.season}` → `{teamName}, {seasonText(state.season, state.phase)}`; import `seasonText` next to `phaseLabel`. `where` (line 54) keeps `phaseLabel(state.phase)` (lowercase running copy). `index` (line 52) already clamps to 1 during the opening offseason.

NewGame.tsx Continue line:

```tsx
                Continue as the {savedTeam?.name ?? savedGame.userTeam}:{' '}
                {seasonText(savedGame.season, savedGame.phase)}, {phaseLabel(savedGame.phase)}.
```

Fix any UI test that asserted the old Strip prop or header text (`pnpm test tests/ui` will tell you).

- [ ] **Step 5: Run**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Orchestrator commits**

```bash
git add app/src/screens/shared/phaseLabel.ts app/src/ui/frame/Strip.tsx app/src/App.tsx app/src/screens/Settings/Settings.tsx app/src/screens/NewGame/NewGame.tsx app/tests/ui/phaseLabel.test.ts
git commit -m "feat(ui): offseason phases read as the season they prepare"
```

---

### Task 8: New Game copy, Dashboard draft alert, pick numbers on offers (ui-builder)

**Files:**
- Modify: `app/src/screens/NewGame/NewGame.tsx:158-161` (mandate note)
- Modify: `app/src/screens/Dashboard/Dashboard.tsx:84-89` (alerts)
- Create: `app/src/screens/shared/pickLabel.ts`
- Modify: `app/src/screens/TradeCenter/TradeCenter.tsx:43-55` and `app/src/screens/DraftRoom/DraftRoom.tsx:55-65` (`describeSide`)
- Create: `app/tests/ui/pickLabel.test.ts`; extend `app/tests/ui/screens.test.tsx` (Dashboard describe, line 281+)

**Interfaces:**
- Produces: `describePick(data: StaticData, pick: Pick<PickRef, 'season' | 'round' | 'originalTeam' | 'pick'>): string`.

- [ ] **Step 1: Write the failing tests**

`app/tests/ui/pickLabel.test.ts` (node):

```ts
import { mockStatic } from '@fixtures/mockLeague'
import { describePick } from '@screens/shared/pickLabel'
import { describe, expect, it } from 'vitest'

describe('describePick', () => {
  const data = mockStatic()
  it('shows the overall number once the order is set', () => {
    expect(describePick(data, { season: 2013, round: 1, originalTeam: 'IND', pick: 24 })).toBe(
      `2013 R1 #24 (${data.teams.IND!.abbr})`,
    )
  })
  it('omits the number while the order is unknown', () => {
    expect(describePick(data, { season: 2015, round: 1, originalTeam: 'IND', pick: null })).toBe(
      `2015 R1 (${data.teams.IND!.abbr})`,
    )
    expect(describePick(data, { season: 2015, round: 2, originalTeam: 'IND' })).toBe(
      `2015 R2 (${data.teams.IND!.abbr})`,
    )
  })
})
```

Dashboard, in the existing `describe('Dashboard', …)` of `app/tests/ui/screens.test.tsx` (copy the props the neighbouring tests pass; the render below shows only what matters):

```tsx
  it('points at the Draft room while a draft is waiting or under way', () => {
    const onNavigate = vi.fn()
    const base = mockLeague()
    render(
      <Dashboard
        state={{ ...base, phase: 'DRAFT', draftRoom: null }}
        data={mockStatic()}
        cap={150}
        onSimWeek={vi.fn()}
        onAdvancePhase={vi.fn()}
        onNavigate={onNavigate}
      />,
    )
    fireEvent.click(screen.getByText('The 2016 draft is waiting.'))
    expect(onNavigate).toHaveBeenCalledWith('draft')
  })
```

(`mockLeague()` is season 2015, so its DRAFT phase is the 2016 draft.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui/pickLabel.test.ts tests/ui/screens.test.tsx`
Expected: FAIL — module not found; alert text absent.

- [ ] **Step 3: Implement**

`app/src/screens/shared/pickLabel.ts`:

```ts
import type { PickRef, StaticData } from '@contracts/index'

/** "2013 R1 #24 (IND)" once the order is set; "2015 R1 (IND)" while `pick` is still unknown. */
export function describePick(
  data: StaticData,
  pick: Pick<PickRef, 'season' | 'round' | 'originalTeam' | 'pick'>,
): string {
  const team = data.teams[pick.originalTeam]?.abbr ?? pick.originalTeam
  const number = pick.pick != null ? ` #${pick.pick}` : ''
  return `${pick.season} R${pick.round}${number} (${team})`
}
```

In both `describeSide` functions replace the template line with `parts.push(describePick(data, pick))` and import `describePick` from `'../shared/pickLabel'`. Remove `teamAbbr` in DraftRoom only if nothing else uses it.

Dashboard, right after `const draftPending = …`:

```ts
  const alerts: Alert[] = []
  if (draftPending) {
    const year = state.draftRoom?.season ?? state.season + 1
    alerts.push(
      state.draftRoom
        ? { text: `The ${year} draft is under way.`, detail: 'Finish it in the Draft room.', screen: 'draft' }
        : { text: `The ${year} draft is waiting.`, detail: 'Start it in the Draft room.', screen: 'draft' },
    )
  }
```

(Move the existing `const alerts: Alert[] = []` line up so this is the first alert.)

New Game mandate note:

```tsx
                  <p className="gg-mandate__note">
                    You take over before the {startSeason} draft: the roster as it stood entering that
                    offseason, with the {startSeason} class on the board. Every rating is what scouts
                    believed then. You may know better.
                  </p>
```

- [ ] **Step 4: Run**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/ui && pnpm typecheck && pnpm lint && pnpm exec prettier --check .`
Expected: PASS.

- [ ] **Step 5: Orchestrator commits**

```bash
git add app/src/screens/shared/pickLabel.ts app/src/screens/TradeCenter/TradeCenter.tsx app/src/screens/DraftRoom/DraftRoom.tsx app/src/screens/Dashboard/Dashboard.tsx app/src/screens/NewGame/NewGame.tsx app/tests/ui/pickLabel.test.ts app/tests/ui/screens.test.tsx
git commit -m "feat(ui): draft alert, new-game copy for the opening draft, pick numbers on offers"
```

---

### Task 9: Pin harnesses and the redraft fixture to opening day (orchestrator)

**Files:**
- Modify: `app/scripts/calibrate.ts:53-61`, `app/scripts/qa/simSweep.ts:29-32`, `app/tests/engine/draft/fixture.ts:38-49`

- [ ] **Step 1: Add `startAt: 'PRESEASON'` to the three `newGame` calls**

calibrate.ts / simSweep.ts: `{ seed, startSeason: season, userTeam: 'IND', horizonSeasons: 1, settings: …, startAt: 'PRESEASON' }` with the comment `// Calibration measures the sim from the real opening-day rosters.` on the line above.

fixture.ts: update the header comment to "Draft-year convention: a game at PRESEASON of 2013 drafts the 2014 class in its DRAFT phase (`startAt: 'PRESEASON'` keeps the 2014 redraft measuring what it always measured)." and pass `startAt: 'PRESEASON'` in `stateAtDraft`.

- [ ] **Step 2: Verify**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm test tests/engine/draft && pnpm typecheck && pnpm calibrate -- --season 2015`
Expected: draft tests PASS with the redraft ≥ 85 % (same figure as before the change, 93.8 %); calibration inside the §6.3 bands.

- [ ] **Step 3: Commit**

```bash
git add app/scripts/calibrate.ts app/scripts/qa/simSweep.ts app/tests/engine/draft/fixture.ts
git commit -m "test: calibration and the redraft fixture keep the opening-day start"
```

---

### Task 10: Headless harness plays the opening offseason (orchestrator, after Tasks 2–5)

**Files:**
- Modify: `app/scripts/headless.ts:73-125` (`checkRosterInvariants` size range), `:205-218` (add `playOpeningOffseason`), `:366-381` (main)

- [ ] **Step 1: Let the invariant check accept the opening state's sizes**

```ts
function checkRosterInvariants(
  state: LeagueState,
  ctx: EngineContext,
  label: string,
  gated: readonly TeamId[] = TEAM_IDS,
  sizeRange: readonly [number, number] = [46, 53],
): void {
  // … replace the size check with:
    check(
      team.roster.length >= sizeRange[0] && team.roster.length <= sizeRange[1],
      `${label}: ${teamId} roster has ${team.roster.length} players`,
    )
```

- [ ] **Step 2: Add the opening offseason next to `playOffseason`**

```ts
/** The opening offseason (newGame default): the start class is on the board; there is no re-signing phase. */
function playOpeningOffseason(state: LeagueState, ctx: EngineContext, log: OffseasonLog): LeagueState {
  const { league, draft } = ctx.modules
  let s = draft.startDraft(state, ctx)
  s = userDraft(s, ctx, log)
  s = league.advancePhase(s, ctx) // DRAFT → UDFA
  s = league.advancePhase(s, ctx) // UDFA → FREE_AGENCY (AI UDFA signings)
  s = userFreeAgency(s, ctx, log)
  s = league.advancePhase(s, ctx) // FREE_AGENCY → TRAINING_CAMP (AI free agency)
  s = league.advancePhase(s, ctx) // TRAINING_CAMP → PRESEASON (opening rollover: no progression, no contract tick)
  s = userCutdowns(s, ctx, log)
  return s
}
```

- [ ] **Step 3: Drive it from `main`**

After the `new game:` log line, replace `checkRosterInvariants(state, ctx, 'newGame', [])` with:

```ts
  checkRosterInvariants(state, ctx, 'newGame', [], [0, 53])
  let offseason: OffseasonLog | null = null
  if (state.phase === 'DRAFT') {
    offseason = emptyLog()
    state = playOpeningOffseason(state, ctx, offseason)
    const user = state.teams[state.userTeam]!
    console.log(
      `opening offseason: drafted ${offseason.drafted.length}, signed ${offseason.signed.length}, cut ${offseason.cut.length} → ` +
        `${state.season} preseason, user roster ${user.roster.length}`,
    )
    check(
      user.roster.length >= 46 && user.roster.length <= 53,
      `${state.season} preseason: user roster has ${user.roster.length} players`,
    )
    check(
      ctx.modules.fa.validateRoster(state, state.userTeam, ctx).ok,
      `${state.season} preseason: user roster invalid — ${ctx.modules.fa.validateRoster(state, state.userTeam, ctx).errors.join(', ')}`,
    )
  }
```

and delete the later `let offseason: OffseasonLog | null = null` declaration. The first `seasonReport(state, ctx, season, offseason)` then prints the opening log under the first season.

- [ ] **Step 4: Verify**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm typecheck && pnpm headless -- --team IND --start 2012 --seasons 6 --quiet && pnpm headless -- --team IND --start 2010 --seasons 2 --quiet`
Expected: both end with `invariants: ok`; the 2010 start proves no lookup needs a 2009 chunk.

- [ ] **Step 5: Commit**

```bash
git add app/scripts/headless.ts
git commit -m "test(headless): play the opening offseason before the first season"
```

---

### Task 11: E2E smoke drafts first (devops-tests, after Tasks 7–8 and 10)

**Files:**
- Modify: `app/tests/e2e/smoke.spec.ts:38-121`

- [ ] **Step 1: Rewrite the steps between `new game` and `sim 4 weeks`**

```ts
test('new game -> opening draft with a trade -> season start -> sim 4 weeks -> reload persists', async ({ page }) => {
  await test.step('new game opens in the offseason before the start year', async () => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Pick your start year' })).toBeVisible()
    await page.getByRole('button', { name: '2012', exact: true }).click()
    await page.getByRole('button', { name: 'Indianapolis Colts' }).click()
    await page.getByRole('button', { name: 'Start' }).click()
    // A 2012 start opens at the 2012 draft (docs/superpowers/specs/2026-09-20-opening-offseason-design.md).
    await expect(HEADER(page)).toContainText('2012 offseason', { timeout: 15_000 })
    await expect(HEADER(page)).toContainText('Draft')
  })

  let rosterCaption = ''

  await test.step('draft round one: a pick and a trade', async () => {
    await goTo(page, 'Draft')
    const startButton = page.getByRole('button', { name: 'Start draft' })
    if (await startButton.isVisible()) await startButton.click()

    const onClockHeading = page.getByRole('main').getByText('ON THE CLOCK')
    for (let i = 0; i < 32 && !(await onClockHeading.isVisible()); i++) {
      await page.getByRole('button', { name: 'Sim to my pick' }).click()
      await page.waitForTimeout(100)
    }
    await expect(onClockHeading).toBeVisible({ timeout: 15_000 })

    await page.screenshot({ path: '../docs/screenshots/draft-room.png' })

    const board = page.getByRole('table', { name: /Available prospects/ })
    await board.getByRole('row').nth(1).click()
    await page.getByRole('button', { name: 'Make pick' }).click()
    await expect(page.getByText(/Pick \d+ \(IND\)/)).toBeVisible({ timeout: 15_000 })
  })

  // (the existing 'propose a trade in the Trade Center' step stays exactly as it is)

  await test.step('finish the draft, run the offseason and start the season', async () => {
    await goTo(page, 'Draft')
    const finishButton = page.getByRole('button', { name: 'Finish draft' })
    if (await finishButton.isEnabled()) await finishButton.click()

    await clickAdvance(page, 'Leave the draft')
    await clickAdvance(page, 'Close UDFA signings')
    await clickAdvance(page, 'Close free agency')
    await clickAdvance(page, 'Break camp')
    await expect(HEADER(page)).toContainText('2012 · Preseason', { timeout: 15_000 })
    await cutdownForPreseason(page)
    await clickAdvance(page, 'Start the season')
    await expect(page.getByRole('button', { name: 'Sim week' })).toBeVisible({ timeout: 15_000 })
  })
```

Delete the old `'sim the first season and reach the draft'` step and the old `'finish the draft and start the new season'` step. Keep `'sim 4 weeks'` and everything after it unchanged (`week 5` is still the reload check).

- [ ] **Step 2: Run**

Run: `cd /Users/daniel.portuondo/nfl-gm/app && pnpm build && pnpm e2e`
Expected: 1 passed. If the user's roster is below 46 at PRESEASON so "Start the season" stays disabled, report the roster count from the Dashboard alert instead of adding free-agency clicks — that is a design question for the orchestrator.

- [ ] **Step 3: Orchestrator commits** (after `git checkout -- docs/screenshots` from the repo root, screenshots are regenerated on every run)

```bash
git add app/tests/e2e/smoke.spec.ts
git commit -m "test(e2e): smoke flow drafts the opening class before the first season"
```

---

### Task 12: Docs and release v1.5.0 (orchestrator)

**Files:**
- Modify: `docs/DECISIONS.md` (append), `docs/HANDOFF.md:11`, `docs/DESIGN.md:183-186, 293-300, 313-316`, `CHANGELOG.md`, `package.json`, `app/package.json`, `pipeline/pyproject.toml`, `pipeline/uv.lock`

- [ ] **Step 1: DECISIONS entry**

```markdown
## 2026-09-20 — Opening offseason (v1.5.0)

- **A new game opens at its own draft.** Daniel: "If I take over a team in 2013, before starting the
  season I should have the 2013 draft." `league.newGame` now defaults to `startAt: 'DRAFT'`: the start
  class (`draft.prospects` of the start chunk) is filtered out of the chunk before anything is built, picks
  are owned for S, S+1 and S+2 with the real S numbers, and the state opens at `season = S − 1`,
  `phase = 'DRAFT'`. The draft-year convention (season X drafts X+1) is unchanged, so draft, trade
  discounting, anchoring and cutdowns needed no changes. The TRAINING_CAMP rollover into S skips
  contract ticking, progression, retirements and the consensus refresh when `isOpeningOffseason(state)`
  (`season < startSeason`); dead money is zeroed, the snap, picks and schedule run as usual. No schema
  change, no save-version bump.
- `startAt: 'PRESEASON'` is today's opening-day start; calibration, the sim sweep and the 2014 redraft
  fixture pin it so their measurements do not move.
- Cap and market age lag one year during the opening offseason, the same convention every later
  offseason already follows (`capFor` clamps below the table, so a 2010 start prices off the 2010 cap).
  `trade.seasonStartOvr` is empty before the first season and never reads the S − 1 chunk.
- **UI:** offseason phases are labelled by the season they prepare ("2013 offseason · Draft"), which
  also ends the "2013 · draft while the 2014 class is on the board" confusion. New Game copy says you
  take over before the draft; the Dashboard carries a "draft is waiting / under way" alert; offer text
  shows pick numbers when the order is set ("2013 R1 #24 (IND)").
- Headless plays the opening offseason first; E2E drafts before it sims. New realData test: 2015 start,
  scripted GM through the opening offseason, every roster legal on opening day, AI rosters ≥ 90 % real.
```

Update the "Known follow-ups" list: strike "pick numbers on offers" if present; keep the rest.

- [ ] **Step 2: HANDOFF §1 and DESIGN**

HANDOFF line 11: change "You take over that team's real roster in that year and act as GM" to "You take over that team before its draft that year — its real roster as it entered the offseason, with that year's class on the board — and act as GM".

DESIGN §4 Strip bullet: after "team plate, season and week" add "(offseason phases read as the season they prepare: `2013 offseason · Draft`)". §11 New Game bullet: "the mandate sentence, one quiet line on the hindsight premise" → "the mandate sentence, one line that you take over before that year's draft, the hindsight premise". §11 Dashboard bullet: add "; a draft alert during the DRAFT phase" after "alerts list". §11 Trade Center / Draft Room: add "offer text names picks with their overall number once the order is set".

- [ ] **Step 3: CHANGELOG and versions**

```markdown
## 1.5.0 — 2026-09-20

### Changed
- A new game opens at the draft of the year you pick: take over the 2013 Colts and you run the 2013
  draft, sign undrafted rookies, work free agency and break camp before the 2013 season. Saves from
  earlier versions continue unchanged.
- The header labels offseason phases by the season they prepare ("2013 offseason · Draft").

### Added
- Dashboard alert while a draft is waiting or under way.
- Trade offers name picks with their overall number once the order is set ("2013 R1 #24 (IND)").
```

Bump `"version": "1.5.0"` in `package.json` and `app/package.json`, `version = "1.5.0"` in `pipeline/pyproject.toml`, then `cd pipeline && uv lock`.

- [ ] **Step 4: Full verification**

Run from the repo root: `pnpm check` and `cd app && pnpm build && pnpm e2e && pnpm headless -- --team IND --start 2012 --seasons 6 --quiet`; then `git checkout -- docs/screenshots`.
Expected: everything green; `invariants: ok`.

- [ ] **Step 5: Commit, tag, push**

```bash
git add -A docs CHANGELOG.md package.json app/package.json pipeline/pyproject.toml pipeline/uv.lock
git commit -m "chore: release v1.5.0"
git tag v1.5.0 && git push && git push --tags
gh run list --branch main --limit 2
```
