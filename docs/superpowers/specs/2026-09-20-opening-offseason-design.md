# Opening offseason — a new game starts at its own draft

**Date:** 2026-09-20 · **Status:** approved in chat, awaiting spec review · **Release:** v1.5.0

## Context

A game started at season S currently opens at `PRESEASON` of S with that year's opening-day 53 on every
roster, rookies included. The first draft the user runs is the S+1 class, after the season. This was a
deliberate Phase 2 fix (DECISIONS "Draft-year convention"): the earlier S-start re-drafted rookies who
were already rostered. Daniel's call: taking over a team in 2013 must mean running the 2013 draft
before the 2013 season.

The data already supports it: `season/{S}/draft.json` carries the real S order (`order[]`, pick numbers,
comp and traded picks) and every S draftee and real UDFA (`prospects[]`, `udfa[]`) with pre-draft
scouting. Their careers are in `trajectories.json` like everyone else's.

## Goal

A new game at S opens in the offseason before S, at the `DRAFT` phase, with the S class on the board and
the real S order in place. The user drafts, signs UDFAs, runs free agency, breaks camp, then plays S.
Calibration and other harnesses can still build the old PRESEASON-start league.

## Non-goals

- A re-signing phase before the opening draft. The S opening-day roster already embodies that year's
  re-signings and free-agent moves; the game's FA phase after the draft offers the leftover pool.
- Renumbering `state.season` to NFL league years. `season` stays "the last completed / current season".
- Starting after the latest real season (a procedural 2026 draft first). The New Game range is unchanged.
- Projected slots for picks whose order is not set.

## Model — Approach A (approved)

**Definition.** The *opening offseason* is the state where `state.season < state.startSeason`
(exactly `startSeason − 1`). Helper `isOpeningOffseason(state)` in `app/src/contracts/engine/league.ts`.
No schema change, no save-version bump: every existing save has `season ≥ startSeason`.

Every existing rule holds unchanged: the draft run in season X's `DRAFT` phase is the X+1 class, so
season S−1 drafts S; pick discounts, pick numbers, history anchoring, cutdowns and the loaders' "S..S+2"
windows all follow from that. The one special case is the rollover into S.

### `league.newGame(opts)` — `opts.startAt: 'DRAFT' | 'PRESEASON'`, default `'DRAFT'`

`'PRESEASON'` is today's behaviour byte for byte (rookies rostered, picks S+1 and S+2, S schedule built,
`phase: 'PRESEASON'`, `season: S`). Calibration depends on it.

`'DRAFT'`:

1. Read chunk S. Let `classIds = new Set(sd.draft.prospects.map(p => p.id))` — the S class is defined by
   the data, not by `rookieSeason` heuristics.
2. Filter the inputs before building anything: `sd.players.players` minus `classIds`,
   `sd.rosters.rosters[team]` minus `classIds`. Then build players/scouting/truth, rosters with
   synthesized contracts, depth charts and the cap fit exactly as today. Class members are therefore never
   in `state.players`, on a roster or in `freeAgents`; `draft.startDraft` → `loadClass(S)` adds them with
   pre-draft scouting and `draft: null`, as it does for every later class.
3. `picks = buildDraftOrder(S) ++ buildDraftOrder(S+1) ++ buildDraftOrder(S+2)`. The S order comes from the
   chunk with real pick numbers; owners are the real `team` (no in-game trades yet).
4. `season: S − 1`, `phase: 'DRAFT'`, `week: 0`, `schedule: []` (built at the rollover, as for every
   later season), `draftRoom: null`, `history: []`. `startSeason: S` and `horizonEnd` unchanged.

The user's roster opens at roughly 44–46 (53 minus that year's draftees and rookie UDFAs). The draft,
UDFA and free agency bring it to the 46–53 window `PRESEASON` requires; the Dashboard's existing alerts
guide that.

### `league.advancePhase(TRAINING_CAMP)` when `isOpeningOffseason(state)`

The state already carries S consensus, S contracts and S truth, so the player-state mutations are
skipped and the season bookkeeping runs as usual:

| Step | Normal rollover | Opening rollover |
|---|---|---|
| `season = season + 1`, `week = 0` | yes | yes (→ S) |
| `fa.rolloverContracts` (tick years, expire, zero dead money) | yes | **skip tick/expire**; zero `deadMoney` |
| `lifecycle.progressSeason` | yes | **skip** |
| `lifecycle.retirements` | yes | **skip** |
| `lifecycle.refreshScouting` | yes | **skip** |
| `history.snapToHistory` (in history) + AI cap fit | yes | yes |
| `resetSeasonCounters`, `ensureFuturePicks`, schedule build, `phase: 'PRESEASON'` | yes | yes |

The snap is what puts AI teams back on their real S opening-day rosters (a real S rookie the AI drafted to
the wrong team goes where he really went; the user's own picks and the occupants they displaced are
already in `divergence` and stay put). `PRESEASON → REGULAR` then fills and cuts AI rosters to the real
53 as it does every year.

### Other engine touch points

- **trade** `seasonStartOvr` returns an empty map when `isOpeningOffseason(state)`: there is no in-season
  movement to detect yet, and it must not read chunk S−1 (which may not exist for a 2010 start).
- **fa**: nothing. `capFor` already clamps seasons before the table to the first known cap, and using
  the prior year's cap during an offseason is the game's existing convention (the offseason after 2013
  runs on the 2013 cap while building 2014 rosters).
- **draft, lifecycle, history**: nothing.

### Store

- `ensureLoaded(from, to)` skips seasons absent from `manifest.seasons`, so continuing or importing a
  save parked at season 2009 (a 2010 start) never requests a chunk that does not exist. `newGame` keeps
  loading S..S+2; `advancePhase` already loads `season+1..season+3`.
- New game still lands on the Dashboard.

### UI (ui-builder)

- **Season label.** `app/src/screens/shared/phaseLabel.ts` gains
  `seasonPhaseLabel(season, phase): { seasonText: string; phaseText: string }`. Offseason phases
  (`OFFSEASON_RESIGN`, `DRAFT`, `UDFA`, `FREE_AGENCY`, `TRAINING_CAMP`) are labelled by the upcoming
  year: `{ seasonText: '2013 offseason', phaseText: 'draft' }`; in-season and preseason phases give
  `{ seasonText: '2013', phaseText: 'regular season' }`. The Strip's `season: number` prop becomes
  `seasonText: string` and it renders `{seasonText} · {phaseText}` plus `· week N` in season, so the
  header reads `2013 offseason · draft` and later `2013 · regular season · week 5`. The Settings run plate
  and the New Game "Continue as…" line use the same helper. This also fixes the pre-existing confusion
  where the header read "2013 · draft" while the 2014 class was on the board.
- **New Game copy.** Mandate note becomes: "You take over before the {S} draft: the roster as it stood
  entering that offseason, with the {S} class on the board. Every rating is what scouts believed then. You
  may know better."
- **Dashboard.** When `phase === 'DRAFT'` and the room is not complete, add an alert "The {S} draft is
  waiting." (detail "Start it in the Draft room.", target `draft`). The existing disabled "Leave the
  draft" button and its hint stay.
- **Pick numbers on offers** (agreed separately, ships in the same release): shared
  `describePick(data, pick)` in `app/src/screens/shared/pickLabel.ts` → `2013 R1 #24 (IND)` when
  `pick.pick` is set, `2015 R1 (IND)` otherwise. Both `describeSide` copies (Trade Center, Draft Room)
  use it.

### Harnesses and tests

- `app/scripts/calibrate.ts` and `app/scripts/qa/simSweep.ts` pass `startAt: 'PRESEASON'`.
- `app/scripts/headless.ts` uses the default and runs the opening offseason first: `draft.startDraft` →
  `userDraft` → advance (DRAFT→UDFA) → advance (UDFA→FA) → `userFreeAgency` → advance (FA→CAMP) →
  advance (CAMP→PRESEASON) → `userCutdowns`, then the season loop as today. Prints an "opening offseason"
  line. `--seasons N` still counts played seasons.
- `app/tests/engine/draft/fixture.ts` pins `startAt: 'PRESEASON'` so the 2014 redraft acceptance test
  measures exactly what it measures today.
- `app/tests/engine/league/league.test.ts` (fakes): default `newGame` → `season = S−1`, `phase = 'DRAFT'`,
  picks for S, S+1, S+2 with S numbers set, no class member rostered or in `players`; `'PRESEASON'`
  preserves today's shape; the opening rollover leaves every contract and scouting row identical, sets
  season S / `PRESEASON`, builds the S schedule; same seed ⇒ identical state through the opening rollover.
- `app/tests/integration/realData.test.ts`: existing tests keep `startAt: 'PRESEASON'`. New test on the
  shipped data: default `newGame(2015, IND)` → scripted GM through the opening offseason → at `PRESEASON`
  every roster is 46–53 and cap-legal, no player is in two places, `season === 2015`, and AI teams
  overlap their real 2015 opening-day rosters at ≥ 90 % (the snap plus anchored cutdowns; the headless
  harness measures 99 % mean, 96 % minimum after the first rollover today).
- One small UI test file for `seasonPhaseLabel` and `describePick`.
- E2E smoke reorders to: start 2012 → header contains "2012 offseason" → Draft: Start draft, sim to my
  pick, make pick → trade in the Trade Center → finish draft → Leave the draft → Close UDFA signings →
  Close free agency → Break camp → cutdown if needed → Start the season → sim 4 weeks → reload persists →
  start over. It no longer has to sim a whole season to reach a draft.

### Contract changes (orchestrator)

- `NewGameOptions.startAt?: 'DRAFT' | 'PRESEASON'` (default `'DRAFT'`), doc comments on `newGame` and
  `advancePhase` updated.
- `isOpeningOffseason(state: LeagueState): boolean` exported from `contracts/engine/league.ts`.
- `pnpm gen:contracts` regenerates `docs/ENGINE_CONTRACT.md`. No zod schema changes.

### Docs

- `docs/DECISIONS.md`: entry "2026-09-20 — Opening offseason" amending the draft-year convention.
- `docs/HANDOFF.md` §1: "You take over that team before its draft that year" wording.
- `docs/DESIGN.md` §4 (Strip label rule) and §11 (New Game, Dashboard alert, offer pick numbers).
- `CHANGELOG.md` 1.5.0; versions in root/app `package.json`, `pipeline/pyproject.toml`, `uv lock`.

## Ownership

| Work | Owner |
|---|---|
| contracts, `gen:contracts`, calibrate/simSweep `startAt`, headless, draft fixture pin, docs, release | orchestrator |
| `engine/league` newGame + rollover, `tests/engine/league`, `tests/integration/realData` | league-engine |
| `engine/trade` `seasonStartOvr` guard + test | trade-ai |
| store loader guard, season label, New Game copy, Dashboard alert, `describePick`, UI tests | ui-builder |
| E2E smoke | devops-tests |

Briefs say "no git stash" (v1.4.0 lesson) and TDD.

## Acceptance

1. New game 2013 IND (real data, browser): header "2013 offseason · draft"; Draft room shows the 2013
   class with real pick numbers; user drafts; after Break camp the header reads "2013 · preseason" and
   the roster shows the drafted rookies with rookie contracts.
2. `pnpm headless -- --team IND --start 2012 --seasons 6 --quiet` → `invariants: ok`.
3. `pnpm calibrate -- --season 2015` unchanged within noise (it still starts at PRESEASON).
4. 2014 redraft test still ≥ 85 % historical; new opening-offseason realData test passes.
5. `pnpm check` clean; E2E passes; a v1.4.0 save imports and continues.

## Risks

- **User roster short at PRESEASON.** Existing alert and cutdown/FA flows handle it; the headless scripted
  GM already fills to 46.
- **Cap and age lag one year during the opening offseason.** Same convention as every later offseason.
- **`TradeProposal.season` is S−1 for opening-offseason trades.** Cosmetic; the trade log is by id.
- **A class member missing from `prospects[]`.** The class set is the data's own definition, so a roster
  rookie outside it (a player drafted earlier who debuted in S) is correctly kept.
