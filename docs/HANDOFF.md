# GRIDIRON GM — Claude Code Handoff

You are the **orchestrator** for building a browser-based NFL general-manager simulation game. This document is your complete brief: the locked product spec, the architecture, the data sources (verified), the phase plan, and the rules for when and how to fan out subagents. Read it fully before doing anything. Then execute Phase 0.

The owner is Daniel, a data scientist. This is a portfolio piece and hobby project. Optimize for: **finishing fast without breaking the architecture**, code that reads well to a reviewer, and a game that actually feels right to someone who knows football.

---

## 1. The game in one paragraph

You pick a start year (2010 to the most recent completed season), an NFL team, and a horizon of *x* seasons. Your goal: win the Super Bowl within *x* seasons. You take over that team's real roster in that year and act as GM — you never play the games. Each season you run the draft (real historical draft classes; AI teams pick roughly as they did historically, adjusted for need and for what you've changed), free agency, and trades, then the season is simulated week by week from roster strength. Every rating anyone sees is a **period-consensus scouting grade** — what was believed at the time. Underneath, real players develop along their **actual careers**. The AI drafts and trades off the consensus grades. Your edge is knowing who Tom Brady turns into. Once the simulated timeline runs past real history, draft classes and development are procedurally generated. Trades in both directions show an **acceptance-likelihood bar**, and the AI's stinginess is a configurable setting chosen at game start. Visual language: Retro Bowl (pixel type, chunky panels, limited palette), Madden-franchise depth of systems.

---

## 2. Locked decisions (do not reopen)

| Area | Decision |
|---|---|
| Start years | 2010 through latest completed season. Architecture must allow extending back later; do not build for it now. |
| Data | Real players, rosters, draft classes, UDFAs, schedules from **nflverse** (CC BY 4.0, attribution required). No other game's data or code. |
| Hindsight model | Displayed ratings = consensus (public knowledge at that point in the timeline). True trajectories follow real careers. Nobody in-game sees the future. |
| Post-history | Procedural draft classes and development once past real data. Empirically calibrated to 2010–present classes. |
| Simulation | Stat-based, no play-by-play. Outcomes driven by roster strength via a single player-value number. Box scores allocated from team results. |
| Player value | One `value` scalar per player-season drives sim contribution, trade valuation, contract cost, and AI roster decisions. **A real player's true value in in-game season S is their real NFL value in season S** — no cross-season smoothing, no invented trajectories while real data exists. |
| Design process | All UI design is driven by the `/frontend-design` skill. The orchestrator invokes it to produce `docs/DESIGN.md` in Phase 0; every UI agent invokes it before writing any screen. |
| Testing | Light but real: determinism, truth-isolation lint, calibration harness, headless multi-season run, a few targeted unit tests per module, one E2E smoke flow. No coverage targets. |
| Draft | Full 7-round draft, live trade offers both directions, acceptance bar, AI-initiated offers when you're on the clock. UDFA pool after. |
| Season | Weekly sim; trades and free-agent pickups allowed in-season under same AI-strictness settings. |
| Cap | Simplified: real league cap figures per season, synthesized contracts from value/age/position, rookie scale by pick, minimal dead-money rule. |
| Realism in v1 | Aging & retirement, injuries. **Not** in v1: coaching staff, morale/holdouts, animated highlights, pre-2010 starts, detailed contract structures. |
| Stack | React + TypeScript (Vite) client-side game; browser-local saves (IndexedDB). Python/pandas pipeline for data. |
| Art | Retro UI + team-colored generic sprites (helmet/jersey silhouettes by position). No per-player art, no real headshots, no official team logos/wordmarks. |
| Hosting | Public GitHub repo, GitHub Pages via Actions. |
| Disclaimer | "Unofficial fan-made project. Not affiliated with or endorsed by the NFL, its teams, or the NFLPA. Data courtesy of nflverse (CC BY 4.0)." In README and in-app About screen. |

### Non-negotiables
- Do **not** copy code from ZenGM/Football GM (source-available, forbids redistribution/hosting) or any other game. UX inspiration only.
- Do **not** embed or link real player photos (`headshot_url` columns must be dropped in the pipeline).
- Do **not** ship official team logos/wordmarks. Use team names, cities, and colors only.
- Every data-derived file in the repo carries the nflverse attribution. `DATA_LICENSE.md` at repo root.
- Non-commercial. No ads, no payments.

---

## 3. Repository layout & ownership

```
gridiron-gm/
├── CLAUDE.md                     # orchestrator-owned; project conventions for all agents
├── README.md                     # orchestrator-owned
├── DATA_LICENSE.md
├── .claude/
│   ├── settings.json             # model/effort config (see §5)
│   └── agents/                   # subagent definitions (see §5.4)
├── pipeline/                     # Python. Owned by data agents.
│   ├── pyproject.toml
│   ├── gridiron_pipeline/
│   │   ├── ingest/               # download + cache raw nflverse files
│   │   ├── build/                # transform to game data
│   │   ├── model/                # ratings / value / consensus / outcome-distribution models
│   │   └── export/               # write JSON chunks to app/public/data
│   ├── tests/
│   └── notebooks/                # exploratory only; not required
├── app/                          # Vite + React + TS
│   ├── public/data/              # generated JSON (committed; see §6.6 for size budget)
│   ├── src/
│   │   ├── contracts/            # *** ORCHESTRATOR-ONLY *** shared types + JSON schemas
│   │   ├── engine/               # pure TS, no React. Deterministic, testable.
│   │   │   ├── league/           # league state, season loop, standings, playoffs, schedule
│   │   │   ├── sim/              # game simulation + box scores
│   │   │   ├── draft/            # draft order, AI picking, draft-room state machine, UDFA
│   │   │   ├── trade/            # valuation, acceptance, AI offers
│   │   │   ├── fa/               # free agency, contracts, cap
│   │   │   ├── lifecycle/        # progression, aging, retirement, injuries, procedural gen
│   │   │   ├── history/          # history anchoring & divergence tracking
│   │   │   ├── rng/              # seeded PRNG
│   │   │   └── persistence/      # save/load, migrations, export/import
│   │   ├── data/                 # loaders for /public/data chunks, caching
│   │   ├── store/                # app state (Zustand), bridges UI <-> engine
│   │   ├── ui/                   # design system: tokens, primitives, sprites
│   │   ├── screens/              # one folder per screen
│   │   └── main.tsx
│   ├── tests/                    # vitest (unit) + playwright (e2e)
│   └── scripts/
│       └── headless.ts           # play N seasons with a scripted GM; the integration harness
├── docs/
│   ├── DATA_CONTRACT.md          # JSON schema for every file in public/data
│   ├── ENGINE_CONTRACT.md        # public interface of every engine module
│   ├── DESIGN.md                 # retro visual system spec
│   └── DECISIONS.md              # append-only log of decisions made during the build
└── .github/workflows/
    ├── ci.yml                    # typecheck, vitest, pytest
    └── deploy.yml                # build + Pages deploy
```

**Ownership rule:** the orchestrator owns `app/src/contracts/`, `docs/*_CONTRACT.md`, `package.json`, `pyproject.toml`, `CLAUDE.md`, `.claude/`, and all CI config. Subagents own only the directories in their brief. A subagent that needs a contract change or a new dependency **reports it back** in its summary; it does not edit those files.

---

## 4. Data sources (verified live on 2026-09-17)

All from the nflverse project. Every URL below returned HTTP 200 when checked. Cache raw downloads in `pipeline/.cache/` (gitignored); never re-download if cached.

| Dataset | URL pattern | Coverage | Use |
|---|---|---|---|
| Rosters (season) | `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{season}.csv` | 1936–2026 verified | Real rosters per season. Fields incl. `season, team, position, depth_chart_position, jersey_number, status, full_name, birth_date, height, weight, college, gsis_id, pfr_id, years_exp, entry_year, rookie_year, draft_club, headshot_url(DROP)` |
| Draft picks | `https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv` | 1980–2026 | Real draft classes with `round, pick, team, pfr_player_name, position, college, age` + career outcomes (`w_av, car_av, dr_av, probowls, allpro, seasons_started, games, to`). Career outcomes feed the ratings model and the empirical pick→outcome distribution. |
| Weekly player stats | `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv` | 1999–2025 verified | Per-week production (passing/rushing/receiving incl. EPA, defensive stats, kicking). Basis for per-season true value. `stats_player_reg_{season}.csv` also exists (season aggregates). |
| Snap counts | `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv` | 2012+ (2010–11 return 404) | Starter/usage share — critical for OL and defenders where box-score stats are thin. |
| Depth charts | `https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{season}.csv` | 2001+ | Starter identification, esp. 2010–2011 where snaps are missing. |
| Injuries | `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv` | 2009+ | Empirical injury rates & durations by position for the injury model. |
| Combine | `https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv` | 2000+ | Consensus-grade inputs for rookies. |
| Contracts | `https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.csv.gz` (also `.parquet`) | ~2011+ (from OverTheCap) | APY-at-position percentile as a market-value signal in the true-value model; calibrating the synthesized salary curve. |
| Players master | `https://github.com/nflverse/nflverse-data/releases/download/players/players.csv` | all | ID crosswalk (`gsis_id` ↔ `pfr_id` etc.), birth dates, positions. |
| Games/schedules | `https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv` | 1999–2026 | Real schedules and results per season (`season, game_type, week, away_team, home_team, scores, spread_line`). Real schedules for in-history seasons; results for sim calibration. |
| Trades | `https://raw.githubusercontent.com/nflverse/nfldata/master/data/trades.csv` | historical | Flavor + calibration of pick-value chart. Optional in v1. |
| Team colors | `https://github.com/nflverse/nflverse-data/releases/download/teams/teams_colors_logos.csv` | all | Team names, abbreviations, colors. **Drop logo/wordmark URL columns.** |

**Salary cap by season** (hardcode in `pipeline/gridiron_pipeline/build/cap.py`, in $M): 2010: uncapped year → use 123.0 for game purposes; 2011: 120.375; 2012: 120.6; 2013: 123.0; 2014: 133.0; 2015: 143.28; 2016: 155.27; 2017: 167.0; 2018: 177.2; 2019: 188.2; 2020: 198.2; 2021: 182.5; 2022: 208.2; 2023: 224.8; 2024: 255.4; 2025: 279.2; 2026: verify at build time. Beyond real data grow at 6%/yr.

**League structure by season:** 32 teams throughout. 16 games through 2020, 17 from 2021. Playoffs: 12 teams through 2019, 14 from 2020. Team relocations/renames handled via a team-identity table (STL→LA 2016, SD→LAC 2017, OAK→LV 2020, WAS renames). Bye weeks and week counts come from `games.csv`.

**ID strategy:** use `gsis_id` as the canonical player key; fall back to `pfr_id` via `players.csv` crosswalk for draft picks (which are keyed by `pfr_player_id`). Log unmatched rows; expect a small tail, do not block on 100% matching.

---

## 5. Orchestration: models, effort, and when to fan out

### 5.1 Model configuration

`.claude/settings.json`:
```json
{
  "model": "fable[1m]",
  "effortLevel": "high",
  "modelSettings": {
    "claude-fable-5-1": { "effortLevel": "xhigh" },
    "claude-opus-5":    { "effortLevel": "high" },
    "claude-sonnet-5":  { "effortLevel": "high" }
  }
}
```
Environment: `export CLAUDE_CODE_SUBAGENT_MODEL=sonnet`. If Fable is not available on this plan, use `"model": "opus[1m]"` and keep everything else.

### 5.2 Model / effort matrix

| Role | Model | Effort | Why |
|---|---|---|---|
| Orchestrator — Phase 0, integration phases (2, 4, 6) | Fable 5.1 (or Opus 5) | `xhigh` | Contracts, integration, and architecture decisions are where mistakes are most expensive. |
| Orchestrator — during fan-out phases (1, 3, 5) | same | `high` | You're dispatching and reading summaries, not reasoning hard. Drop effort to save tokens. |
| Ratings / value / consensus model | Opus 5 | `xhigh` | A real modeling problem with fuzzy validation. Quality here is the game's realism. |
| Game simulation engine + calibration | Opus 5 | `high` | Statistical design and calibration; subtle bugs don't crash, they make the game feel wrong. |
| Trade valuation & acceptance AI | Opus 5 | `high` | Adversarial: the human will try to fleece it. Needs reasoning about exploits. |
| Draft AI & draft-room state machine | Opus 5 | `high` | History-anchoring with fallbacks; many edge cases. |
| Balance & exploit pass (Phase 5) | Opus 5 | `high` | Adversarial testing. |
| Data ingestion & export pipeline | Sonnet 5 | `high` | Well-specified ETL. |
| League/season engine, persistence | Sonnet 5 | `high` | Well-specified, heavily typed. |
| Free agency, cap, contracts | Sonnet 5 | `high` | Rule implementation against a written spec. |
| Lifecycle (aging, injuries, retirement, procedural gen) | Sonnet 5 | `high` | Spec-driven; the calibration inputs come from the pipeline. |
| UI design system & screens | Sonnet 5 | `high` | Must invoke `/frontend-design` and execute a bold direction with precision; medium effort produces generic UI, which is the one thing the skill exists to prevent. |
| Tests, CI, deployment, README, one E2E smoke flow | Sonnet 5 | `medium` | Boilerplate-heavy. |

### 5.3 Fan-out rules

Fan out **only when all of these are true**:
1. The contracts the work depends on are committed (`app/src/contracts/`, `docs/*_CONTRACT.md`).
2. Each unit owns a disjoint set of directories. No two concurrent agents touch the same file.
3. Each unit has written acceptance criteria and a command it can run itself to check them (`pnpm test --filter …`, `pytest pipeline/tests/test_x.py`). Keep tests proportionate: a handful of targeted tests per module that prove the acceptance criteria, not exhaustive suites.
4. You can write the brief in under 400 words without saying "figure out the interface." If you can't, the contract isn't ready — finish it first.

Never delegate:
- Anything in the ownership list in §3.
- Integration between modules. You do it, at `xhigh`.
- Decisions that change §2. (There shouldn't be any. If one is truly forced, log it in `docs/DECISIONS.md` and continue.)

Concurrency: 4–6 subagents at a time. Run them in one message so they execute in parallel. Same working tree, disjoint directories. Use worktree isolation only for the balance/exploit agent in Phase 5, which needs to make throwaway changes.

Context hygiene:
- Subagent briefs use the template in §5.5. Ask for a **≤300-word summary** back: files created/changed, tests passing, contract changes requested, open questions. Do not ask subagents to paste code back.
- After each fan-out returns, run `pnpm -r typecheck && pnpm -r test && (cd pipeline && pytest -q)` before reading any summary in detail. Fix red first.
- Read diffs with `git diff --stat` and spot-check; read a full file only when integrating it.
- Commit after every phase and after every integration fix. Conventional commit messages. One commit per logical unit.

Effort discipline for yourself: `/effort xhigh` when entering Phases 0, 2, 4, 6. `/effort high` when entering 1, 3, 5.

### 5.4 Subagent definitions

Create these in `.claude/agents/` during Phase 0. Each file's frontmatter sets `model` and `effort` per the matrix; the body is the role description and the standing rules (ownership, report format, never edit contracts, run your tests before reporting).

```
data-ingest.md        model: sonnet   effort: high
ratings-model.md      model: opus     effort: xhigh
league-engine.md      model: sonnet   effort: high
sim-engine.md         model: opus     effort: high
draft-ai.md           model: opus     effort: high
trade-ai.md           model: opus     effort: high
fa-cap.md             model: sonnet   effort: high
lifecycle.md          model: sonnet   effort: high
ui-builder.md         model: sonnet   effort: high     # body MUST say: "Invoke /frontend-design before writing any UI. Implement docs/DESIGN.md exactly; extend it, never contradict it."
qa-balance.md         model: opus     effort: high
devops-tests.md       model: sonnet   effort: medium
```

The `/frontend-design` skill must be available in the Claude Code environment (it is an Anthropic skill in Daniel's account; if `/frontend-design` is not listed, stop and ask Daniel to enable it before Phase 0).

### 5.5 Subagent brief template

```
GOAL (2–3 sentences): what this unit produces and why it matters to the game.
OWNS: exact directories/files you may create or edit. Touch nothing else.
CONTRACTS: paths to the types/schemas you must implement against. Do not modify them.
  If you need a change, describe it under "CONTRACT REQUESTS" in your report.
SPEC: the relevant section(s) of NFL_GM_HANDOFF.md, pasted or referenced by number.
ACCEPTANCE: numbered, testable criteria. Include the exact command that verifies each.
FIXTURES: where mock/real data lives that you can run against.
DO NOT: list of things explicitly out of scope for this unit.
REPORT: ≤300 words. Files changed. Tests passing (paste the summary line). Contract requests. Open questions. Anything you had to assume.
```

---

## 6. System design specs

These are the specs the subagents build against. Where a number is given, it is a starting value to be tuned in Phase 5, not a law.

### 6.1 Core types (orchestrator writes these in Phase 0)

Minimum shape; refine while writing the actual TS.

```ts
type Season = number;                       // e.g. 2015
type TeamId = string;                       // stable identity, e.g. "LAR" for STL/LA
type PlayerId = string;                     // gsis_id or synthetic "gen-..." for procedural

interface Player {
  id: PlayerId; name: string; pos: Position; birthYear: number;
  college?: string; heightIn?: number; weightLb?: number;
  draft?: { season: Season; round: number; pick: number; team: TeamId } | null; // null = UDFA
  real: boolean;                            // false for procedurally generated
}

// What the world knows at a point in time. Recomputed each season.
interface ScoutingView {
  ovr: number;        // 40–99 consensus current ability
  pot: number;        // 40–99 consensus ceiling (age/draft-slot based; NOT from real future)
  confidence: number; // 0–1; lower for rookies/UDFA, higher for established vets
}

// The hidden truth. Never rendered. Used by sim + progression.
interface TrueTrajectory {
  bySeason: Record<Season, number>;        // true value 40–99 per season, from real career or generated
  retiresAfter: Season | null;              // real retirement season or generated
}

interface Contract { years: number; apy: number; guaranteedPct: number; signedSeason: Season; rookie: boolean }

interface RosterSlot { playerId: PlayerId; teamId: TeamId; contract: Contract; injured?: { weeksOut: number; kind: string } }

interface LeagueState {
  seed: string; season: Season; week: number; phase: Phase;
  userTeam: TeamId; horizonEnd: Season; startSeason: Season;
  settings: GameSettings;
  teams: Record<TeamId, TeamState>;
  players: Record<PlayerId, Player>;
  scouting: Record<PlayerId, ScoutingView>;
  truth: Record<PlayerId, TrueTrajectory>;   // present in state; UI must never read it
  picks: DraftPick[];                        // owned picks incl. future seasons
  schedule: Game[]; results: GameResult[];
  history: SeasonSummary[];
  divergence: Set<PlayerId>;                 // players whose ownership left the historical path
}

type Phase = 'PRESEASON' | 'REGULAR' | 'PLAYOFFS' | 'OFFSEASON_RESIGN' | 'DRAFT' | 'UDFA' | 'FREE_AGENCY' | 'TRAINING_CAMP';

interface GameSettings {
  tradeStrictness: 'lenient' | 'balanced' | 'strict' | 'ruthless';
  aiOfferFrequency: 'rare' | 'normal' | 'aggressive';
  injuries: boolean;
  difficultyNotes?: string;
}
```

Position groups: `QB RB WR TE OL DL LB CB S K P`. Map nflverse fine-grained positions (T/G/C → OL; DE/DT/NT → DL; OLB/ILB/MLB → LB; FS/SS → S) in the pipeline.

Rule enforced by lint/test: nothing under `app/src/screens/` or `app/src/ui/` imports from `engine/**/truth*` or reads `LeagueState.truth`. Add an ESLint `no-restricted-imports` rule and a unit test that greps for it.

### 6.2 Ratings, value, and consensus model (Opus, xhigh)

**Goal:** for every real player-season 2010–present, produce `trueValue ∈ [40, 99]`; for every player at every timeline point, produce a `ScoutingView` that uses only information available at that time.

**True value (per player-season):**
- Production component: position-specific value from `stats_player_week` aggregated to season (use EPA-based measures where available; fall back to yards/TD/INT composites). Convert to a within-position, within-season z-score. Positions with thin box-score stats (OL, most defenders): rely on snap share (2012+) / depth-chart starter status (2010–11), games started, and — where available — contract APY percentile at position (contracts data, ~2011+). Draft-pick career outcomes (`w_av`, `probowls`, `allpro`) are **career-level**; use them to shape the curve across a player's career, not as a per-season value.
- Availability component: games played / games possible.
- **Season S value is season S's real value. Do not smooth across seasons.** The only adjustment allowed is shrinkage toward the player's position mean when the sample is tiny (<4 games played), so an injured star isn't rated on two games. A real bad year is a real bad year; a real breakout is a real breakout, in the same season it happened.
- Map z → 40–99 with a position-invariant scale so a 90 QB and a 90 OL are equally "elite within position." Position *importance* is handled in the sim weights, not the ratings.
- For a real player's seasons **after** the latest real data, extend with the aging curve from §6.7 seeded at their last real value.

**Consensus scouting view at timeline point T:**
- Veterans (≥1 real prior season as of T): `ovr` = true value of the most recent completed season (performance is public). `pot` = age/position-based generic curve applied to `ovr`, plus a small draft-pedigree bump. `confidence` rises with seasons played.
- Rookies in season T's draft: `ovr`/`pot` from **draft slot** (pick number → grade curve, fit from 2010–2020 classes so the median pick-32 player's actual year-3 value maps to the grade), adjusted by combine percentiles and age, plus per-player deterministic noise (seeded by id) so the board isn't a straight line. **Never use the player's real future.**
- UDFAs: low `ovr`, low `confidence`, `pot` sampled from the UDFA outcome distribution.

**Empirical outcome distributions (for procedural generation):** from 2010–2020 classes, fit P(true value at years 1..8 | pick slot bucket, position). Export as compact tables. Procedural rookies sample from these; real rookies use their real trajectories.

**Acceptance criteria (pasted into the brief) — one small test file, not a suite:**
1. Sanity lists: top-10 QBs by true value in 2015 include Brady, Rodgers, Newton, Palmer, Wilson, Roethlisberger, Brees; 2012 top-5 RB includes Peterson; 2018 top-5 WR includes Hopkins, Thomas, Adams. Tolerant membership checks.
2. Team mean starter true value correlates with real point differential per season 2012–2023 at ≥ 0.55.
3. Consensus never leaks the future: 2012 Russell Wilson's consensus `pot` is well below top-10-pick consensus; 2017 Mahomes consensus is below 2017 Trubisky consensus.
4. Exported files validate against `docs/DATA_CONTRACT.md` schemas.

### 6.3 Game simulation (Opus, high)

**Team strength:** from the depth chart (auto-generated by value unless user sets it): offense = weighted starters (QB heavy: QB ~0.35 of offense, OL 5 slots ~0.25, WR/TE ~0.25, RB ~0.15), defense = DL/LB/CB/S weighted ~equal with edge for pass rush and CB, special teams small. Injured players excluded; depth quality matters via a bench factor. Produce `offRating`, `defRating`, `stRating`, `overall`.

**Game outcome:** expected margin = `k * (homeOverall − awayOverall) + HFA` with HFA ≈ 2.0 points, `k` calibrated so the spread of team win totals across a simulated season matches reality (sd of wins ≈ 3.0 in a 17-game season). Draw margin ~ Normal(expected, σ≈13.5), total ~ Normal(≈45, 10) clipped; derive scores; snap to realistic football scores (favor 3/7 combinations) with a small lookup. Overtime rule: margin within ±1 → coin-flip OT rules of the era (ties allowed at low probability).

**Box score:** allocate team passing/rushing/receiving/defensive stats to players by usage weights derived from value and position, with noise. Only needs to be plausible; it feeds player season stats and awards, not ratings.

**Injuries per game:** if enabled, sample injury events per team per game from position-specific rates fit from `injuries_{season}.csv` (target: 0.6–1.6 injuries per team-game in total, of which 0.35–0.8 last more than a week; the calibration harness enforces both bands — the earlier "1–1.5 multi-week per team per week" wording was withdrawn 2026-09-19 because it is incompatible with the fitted duration mix). Duration from an empirical distribution (1–2 wks common, long tail to season-ending).

**Playoffs:** era-correct format. Seeding rules simplified to record → head-to-head → point differential.

**Calibration harness:** `app/scripts/calibrate.ts` — given real ratings for a season, simulate that season 500×; report team win-total correlation with real (target ≥ 0.5), win sd, home win %, average total points, ties. Runs in <60s.

**Determinism:** all randomness through `engine/rng` seeded from `LeagueState.seed` + season + week + gameId. Same seed → same results. This is a testing requirement, not optional.

### 6.4 Draft system (Opus, high)

**Order:** for real seasons, the real order from `draft_picks.csv` (which encodes comp picks and traded picks as they actually happened). Ownership in-game = real ownership **unless** the pick was traded in-game (tracked in `picks[]`). For post-history seasons, generate order from reverse standings with playoff-based ordering; comp picks omitted in v1.

**Pool:** real drafted players for that season + real UDFAs (players with `rookie_year == season` and no `draft_club` on any roster that season) as the UDFA pool.

**AI picking (history-anchored with need-aware fallback):**
1. If the player the team actually picked at this slot is still available and the team's need at that position is not "saturated," pick them. (Most picks stay historical → the "follow historical results" feel.)
2. Otherwise, score available players: `consensus.pot * needWeight(pos) * ageAdj` with small seeded noise; take the best. Need weight from depth-chart gaps relative to a positional template (e.g., 1 QB, 5 OL, 3 WR…) and starter quality. Teams occasionally (10%) take best-available ignoring need.
3. The AI **never** reads `truth`. Enforced by import lint.

**Draft room state machine:** ON_CLOCK(team) → [user: pick | trade | auto] → ADVANCE. When the user is on the clock, generate 0–3 incoming trade offers (see §6.5) from teams whose top need matches the best available consensus prospect. Timer optional (off by default). Full 7 rounds, then UDFA phase where the user can sign up to a roster cap and AI teams sign the remainder using the same anchored logic.

**Acceptance:** draft 2014 with the user as an uninvolved team and no trades → ≥85% of picks match reality. Draft with the user taking Aaron Donald at #1 → subsequent AI picks remain sensible (no team drafts a 3rd QB in round 1) and Donald's real pick slot goes to a plausible alternative.

### 6.5 Trades (Opus, high)

**Asset value:** players: `v = f(consensus.ovr, consensus.pot, age, pos, contract)` — a smooth function where value rises steeply above 80 ovr, young high-`pot` players get a premium, age past the position's peak discounts, and expensive contracts subtract. Picks: a chart (start from a Rich Hill–style curve, exponential decay in pick number) discounted for future years (0.85/yr) and adjusted by the projected strength of the pick's owner.

**Acceptance probability:** `p = sigmoid((valueIn − valueOut − needAdj − margin) / scale)`, where `margin` comes from `tradeStrictness`: lenient −3%, balanced +5%, strict +15%, ruthless +30% of `valueOut`. `needAdj` rewards trades that fill the AI's top-2 needs and penalizes taking on positions it's saturated at. Cap validity and roster-size validity are hard gates (p = 0). Show `p` as the bar. On submit, roll against `p`; if the AI declines, it may counter by asking for one additional asset from the user's side.

**AI-initiated offers:** when the user is on the clock in the draft, and 2–3 random times per in-season week (`aiOfferFrequency`), generate offers where the AI's own `p` ≥ 0.5 and the value is within a plausible band. Present with the same bar (their acceptance of their own offer is 100%; the bar shows *fairness*).

**Anti-exploit:** the AI refuses to trade more than 2 first-round picks in one deal, refuses to take on injured players without a discount, and re-values a player whose consensus dropped sharply this season (fire sales don't work at last year's price). Keep a per-team "annoyance" counter: repeated declined lowballs raise that team's margin for the rest of the season.

**Acceptance:** 5–6 hand-written trade scenarios with expected `p` bands (a fair 1-for-1, an obvious fleece both directions, a pick-for-player, a cap-invalid deal); the Phase 5 exploit script cannot net >15% surplus value per trade on average across 200 random attempts at "strict."

### 6.6 Free agency, contracts, cap (Sonnet, high)

- Cap per season from §4 table. Team payroll = sum of `apy`. Must be under cap to advance phases; in-season trades must leave both teams under cap.
- Synthesized salary curve: `apy = capPct(pos, ovr, age) * cap` fit to contracts data APY-at-position percentiles (2012–2023). Rookie contracts: 4 years, `apy` from a slot table (fit to real rookie scale percentages of cap). Minimum salary ≈ 0.3% of cap.
- Re-signing phase: expiring contracts; player asks for `marketApy * (1 ± 10%)`; accept if user offers ≥ ask. AI teams re-sign their historical players when history-anchored, otherwise by value/need under cap.
- Free agency: pool = unsigned players. AI signings history-anchored (see §6.8) with value/need fallback. User signs at ask, with a 1-day simulated bidding: p(player accepts) rises with offer/ask ratio and team quality.
- Cutting: releases the player; dead money = 25% of remaining guaranteed `apy * years`, charged this season. (Simple, discourages hoarding.)
- Roster limits: 53 max, 46 min to sim a game; practice squad not modeled.

### 6.7 Lifecycle (Sonnet, high)

- **Progression at each new season:** real players inside real data → `trueValue` from trajectory. Real players beyond real data and procedural players → `prev + ageDelta(pos, age) + N(0, σ_pos)` with position curves (QB peak 28–34, RB peak 24–27 and decline fast, WR 25–30, OL 26–32, DL/LB 25–30, CB 24–29, S 25–30, K/P flat to ~38). Fit curves from the 2010–2023 true values in the pipeline; export as tables.
- **Retirement:** real players → after their last real roster season (hard fact). Otherwise P(retire) logistic in age and value, ~0 below 30 for non-RB, rising steeply after 34.
- **Injuries:** see §6.3 for occurrence; here: weekly decrement, return to roster, small chance of permanent value loss (−1 to −3) for long injuries.
- **Procedural draft class generator (post-history):** class size = real average (~257 + ~200 UDFA); position mix from 2010–2023 empirical; for each slot sample a consensus grade from the slot-grade distribution and a hidden trajectory from the pick→outcome tables (§6.2), so steals and busts happen at realistic rates. Names from a generated first/last name table (do not reuse real names).

### 6.8 History anchoring & divergence (Sonnet, high; small module)

At each new real-history season, snap AI teams' rosters and contracts toward reality: for every player **not** in `divergence` and not on the user's team, place them on their real team for that season with a synthesized contract. Players in `divergence` (anyone who has ever been acquired/released/drafted by the user, or moved in an in-game trade or FA signing involving the user's actions, plus the historical occupant displaced by a user's draft pick) stay where the game put them and are managed by value/need logic. Real players who never appear again are retired. This keeps the league realistic for as long as possible while letting the user's butterfly effects persist where they matter. Log every snap for debugging (`history/snapLog`).

### 6.9 Persistence

IndexedDB via `idb`. Save = full `LeagueState` JSON (structured-clone; `Set` → array). Autosave at every phase transition and every 4 weeks. Multiple save slots. Export/import as `.json` download. Schema version field + migration stubs.

### 6.10 Data files & size budget

`app/public/data/`:
- `manifest.json` — seasons available, schema version, attribution.
- `teams.json`, `cap.json`, `curves.json` (aging, slot-grade, outcome tables), `injuryModel.json`.
- Per season: `season/{yyyy}/players.json` (players on rosters that season with consensus at season start and true values for that season only), `season/{yyyy}/rosters.json`, `season/{yyyy}/draft.json` (class + real order + UDFA), `season/{yyyy}/schedule.json`.
- `trajectories.json` — true values by season for all players 2010+ (this is the only cross-season file; ~30k players × ~5 seasons avg; keep as compact arrays keyed by id; target <3 MB gzipped).

Budget: initial load ≤ 1.5 MB gzipped; a season load ≤ 1 MB gzipped. GitHub Pages serves gzip. Check sizes in CI.

### 6.11 UI & retro design (Sonnet, high) — driven by `/frontend-design`

**Process, not prescription.** This handoff does not dictate fonts, palette, or motion. Those come from the `/frontend-design` skill, which requires committing to one bold aesthetic direction and executing it with precision, and forbids generic choices (Inter/Roboto/system fonts, purple gradients, cookie-cutter component patterns).

In **Phase 0** the orchestrator invokes `/frontend-design` with this brief and writes the result to `docs/DESIGN.md`:

> A retro-arcade NFL general-manager sim in the spirit of Retro Bowl: pixel-era warmth, chunky tactile panels, a limited but confident palette, and data-dense screens (rosters, draft boards, cap tables) that still feel like a game, not a spreadsheet. Players are represented by team-colored generic helmet/jersey sprites — no real likenesses or logos. The single most memorable moment should be the draft room when you're on the clock and trade offers roll in. Constraints: React + TypeScript, CSS variables for all tokens, open-licensed fonts self-hosted, works at 390px wide, keyboard navigable, dark theme default with a light option. Pick the direction; don't hedge.

`DESIGN.md` must contain: the named aesthetic direction in one sentence; the token set (colors, type scale, spacing, radii, borders, shadows) as CSS variables; the two fonts and why; the motion plan (one orchestrated page-load reveal per screen, hover/focus language, the on-the-clock moment); background/texture treatment; the sprite system spec; and component primitives (panel, button, table, meter bar, badge, modal, toast).

Every `ui-builder` dispatch begins by invoking `/frontend-design`, then implements `DESIGN.md` for its assigned screens. The skill sets the bar; `DESIGN.md` keeps the fan-out consistent. If an agent believes the design needs a change, it reports it — it does not fork the aesthetic.

Screens (in build order): New Game (year → team → horizon → settings, with a "Your mandate" summary card), Dashboard (season hub: record, next game, cap, alerts, horizon countdown), Roster & Depth Chart, Player Card (consensus ratings, contract, stats history — never truth), Schedule & Results (week-by-week; sim one week / sim to next event / sim season), Standings, League Browser (every team's roster, picks, cap), Draft Room (board, your picks, on-the-clock panel, offers with acceptance bars, pick log), Trade Center (asset selectors both sides, live acceptance bar, AI counter), Free Agency (pool, asks, your offers), Finances (cap table, contracts expiring), Season Recap (awards, playoff bracket), End Game (Super Bowl win → celebration + GM report card; horizon expires → report card + "keep playing" option), About (attribution + disclaimer).

---

## 7. Phase plan

Wall-clock target: Phases 0→6 in one long orchestrator session with 3 fan-outs. Each fan-out returns before the next integration. Don't start a fan-out until the previous integration is green.

### Phase 0 — Foundations (orchestrator only, `xhigh`)
Deliverables:
1. `git init`, repo layout from §3, `pnpm` workspace for `app`, `uv`/`pip` project for `pipeline`. Vite + React + TS + Vitest + ESLint + Prettier. Python: pandas, pyarrow, pytest, requests.
2. `.claude/settings.json` (§5.1), `.claude/agents/*.md` (§5.4), `CLAUDE.md` with: conventions, ownership rules, "never read truth from UI," test commands, commit style, and a pointer to this handoff (commit this handoff as `docs/HANDOFF.md`).
3. `app/src/contracts/` — all types from §6.1 plus module interfaces for every engine folder (function signatures with doc comments; bodies `throw new Error('not implemented')`). `docs/ENGINE_CONTRACT.md` generated from these.
4. `docs/DATA_CONTRACT.md` with JSON schemas (use `zod` in TS and export JSON Schema; pipeline validates against the same JSON Schema files in `app/src/contracts/schemas/`).
5. Fixture generator `app/tests/fixtures/mockLeague.ts` producing a schema-valid fake league (32 teams, ~1,700 players) so engine and UI agents can run before real data exists.
6. Invoke `/frontend-design` with the §6.11 brief; write `docs/DESIGN.md`. `DATA_LICENSE.md`, README skeleton with disclaimer.
7. CI skeleton that runs typecheck + tests (empty is fine).
8. A short "Testing philosophy" section in `CLAUDE.md`: determinism tests, truth-isolation lint, calibration harness, headless run, a few targeted unit tests per module, one E2E smoke flow. No coverage thresholds; do not write tests for trivial code.
Exit: `pnpm -r typecheck` and `pytest` green on empty; commit `chore: scaffold`.

### Phase 1 — Fan-out #1 (5 agents in parallel; orchestrator at `high`)
| Unit | Agent | Owns | Spec | Key acceptance |
|---|---|---|---|---|
| 1A Ingest & build | data-ingest | `pipeline/.../ingest`, `build`, `export`, `pipeline/tests` | §4, §6.10 | All raw files cached; season chunks 2010–latest exported and schema-valid; sizes within budget; `make data` idempotent |
| 1B Ratings model | ratings-model | `pipeline/.../model` | §6.2 | Acceptance list in §6.2; writes `trajectories.json`, consensus per season, curves and outcome tables |
| 1C League engine + persistence | league-engine | `engine/league`, `engine/rng`, `engine/persistence`, `data/` loaders | §6.1, §6.3 (playoffs), §6.9 | Season loop runs on mock fixture across 3 seasons deterministically; save/load round-trips; era-correct playoff formats tested |
| 1D Sim engine | sim-engine | `engine/sim`, `app/scripts/calibrate.ts` | §6.3 | Deterministic; calibration harness runs on mock; box scores sum to team totals |
| 1E UI foundation | ui-builder | `app/src/ui`, `app/src/store`, `screens/NewGame`, `screens/Dashboard`, `screens/Roster`, `screens/PlayerCard`, `screens/About` | §6.11, `docs/DESIGN.md` | Invokes `/frontend-design` first; implements tokens + primitives + sprite system exactly per DESIGN.md; renders against mock fixture; lint rule blocks truth imports; works at 390px |

1B depends on 1A's cached raw files only — have 1A commit the ingest step first (tell 1A to commit `ingest` within its first 20 minutes and message you), or have 1B do its own ingest into the same cache dir using the same URL table. Prefer the latter for speed: both agents write only to `.cache/` (gitignored) and their own directories.

### Phase 2 — Integration #1 (orchestrator, `xhigh`)
1. Run pipeline end-to-end; load real 2015 into the league engine; simulate the 2015 season 500× via calibration harness; check §6.3 targets. Tune `k`, `σ`, weights only if grossly off; otherwise leave for Phase 5.
2. Reconcile contract drift reported by agents. Update `contracts/` + docs; re-run everything.
3. Write interface **stubs** (signatures + docs, `not implemented` bodies) for `draft`, `trade`, `fa`, `lifecycle`, `history` so Phase 3 UI work can proceed against them.
4. Extend `headless.ts` to: new game → sim a season → print standings. Commit.

### Phase 3 — Fan-out #2 (5 agents; orchestrator `high`)
| Unit | Agent | Owns | Spec | Key acceptance |
|---|---|---|---|---|
| 3A Draft | draft-ai | `engine/draft` | §6.4 | §6.4 acceptance; deterministic; never imports truth |
| 3B Trades | trade-ai | `engine/trade` | §6.5 | §6.5 acceptance suite |
| 3C FA, contracts, cap + history anchoring | fa-cap | `engine/fa`, `engine/history` | §6.6, §6.8 | Cap invariants hold across 5 simulated offseasons on real data; anchoring keeps ≥90% of non-diverged players on real teams in 2016 after a 2015 start |
| 3D Lifecycle | lifecycle | `engine/lifecycle` | §6.7 | Progression equals real season values inside data; procedural classes look like real ones on a quick distribution comparison (eyeball + one summary-stat test); retirement rates by age plausible |
| 3E UI batch 2 | ui-builder | `screens/DraftRoom`, `screens/TradeCenter`, `screens/FreeAgency`, `screens/Schedule`, `screens/Standings`, `screens/LeagueBrowser` | §6.11, `docs/DESIGN.md` | Invokes `/frontend-design` first; the on-the-clock moment is the showcase; acceptance-bar component; offers panel; renders against stubs + mock; works at 390px |

### Phase 4 — Integration #2 (orchestrator, `xhigh`)
1. Wire draft/trade/FA/lifecycle/history into the season loop; full offseason → season → offseason cycle.
2. `headless.ts`: scripted GM plays 2012 Colts (or any team) for 6 seasons with a simple policy (draft best-available consensus, no trades). Must complete without error, under cap, roster sizes legal, standings plausible, real players appearing on real teams in-history, procedural rookies appearing once past data. Print a per-season report.
3. Hook UI screens to the real store. Play one full season in the browser yourself (use Playwright headless if needed) and fix what breaks.
4. Commit; tag `v0.5-alpha`.

### Phase 5 — Fan-out #3 (3 agents; orchestrator `high`)
| Unit | Agent | Owns | Spec | Key acceptance |
|---|---|---|---|---|
| 5A UI completion & polish | ui-builder | `screens/Finances`, `screens/SeasonRecap`, `screens/EndGame`, polish pass across all screens per DESIGN.md motion plan | §6.11, `docs/DESIGN.md` | Invokes `/frontend-design` first; every screen implemented; end-game report card; page-load reveals; keyboard nav works |
| 5B Balance & exploits (worktree) | qa-balance | read everything; may edit `engine/**` constants files only, and must report every change | §6.3, §6.5, §6.7 | Calibration targets met; exploit script results; recommended constant changes with evidence |
| 5C CI, deploy, docs, one E2E | devops-tests | `.github/workflows`, `README.md` body, `app/tests/e2e` | §3, §2 disclaimer | CI green; Pages deploy workflow; data size check; README with attribution, disclaimer, architecture, hindsight-model explanation; one Playwright smoke flow: new game → draft one round with a trade → sim 4 weeks → save → reload → state persists |

### Phase 6 — Ship (orchestrator, `xhigh`)
1. Merge 5B's constant changes after reviewing evidence. Re-run calibration and headless.
2. Full QA playthrough: 2010 start, 3-season horizon, one deliberate hindsight move (e.g., trade up for a known late-round star), confirm the experience matches §1.
3. Enable Pages, deploy, verify live URL. Screenshots into README.
4. Tag `v1.0.0`. Write `docs/DECISIONS.md` final entries and a `CHANGELOG.md`.
5. Final report to Daniel: live URL, repo, what's tuned, known simplifications, v2 backlog (§8).

---

## 8. Known simplifications (v1) and v2 backlog

Simplifications, documented in README: a real player's value in season S is their real season-S value regardless of which team they're on in-game (a QB you draft into a great offense performs as they actually did); comp picks not generated post-history; no practice squad; simplified cap without restructures/void years; single injury model across positions with position scaling; playoff tiebreakers simplified; schedules post-history generated by a simplified formula.

v2 backlog: coaching staff & schemes; morale/holdouts; drive-by-drive highlights with pixel field; pre-2010 start years (rosters back to 1936 exist; per-season stats end 1999; draft 1980); detailed contracts (OTC data); multiple-user leagues; achievements; shareable "GM résumé" export.

---

## 9. Definition of done

- Live on GitHub Pages; public repo; CI green.
- A player can start in any season 2010–latest with any team and any horizon 1–10, complete the horizon, and see the end-game report card.
- Determinism: same seed and same inputs reproduce the same league.
- Calibration targets in §6.2 and §6.3 met; exploit test in §6.5 passes at `strict`. The headless 6-season run completes clean.
- No file under `screens/` or `ui/` reads truth; lint enforces it.
- The UI visibly follows `docs/DESIGN.md` — one coherent aesthetic, not a default component-library look.
- No real photos, no official logos; attribution + disclaimer present in repo and app.
- README explains the hindsight model, the data pipeline, and the architecture clearly enough for a hiring manager to follow in five minutes.

Start now with Phase 0. When Phase 0 is committed, set `/effort high`, dispatch Phase 1 in a single message, and proceed.

You are free to commit and push in this project and you should do so in a structured way so there is clean version control and history. 