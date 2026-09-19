# Data contract

Every JSON file the pipeline writes to `app/public/data/` and the save file the app writes to
IndexedDB. **The zod schemas in `app/src/contracts/schemas.ts` are the source of truth**; this document
explains them. The generated JSON Schemas (draft 2020-12) in `app/src/contracts/schemas/*.schema.json`
are what the pipeline validates against (`gridiron_pipeline.schemas.validate(name, obj)`), and
`app/tests/contracts.test.ts` fails if they drift from the zod source. Regenerate with `pnpm gen:contracts`.

Conventions:
- Every file has an `attribution` string mentioning nflverse and CC BY 4.0 (`ATTRIBUTION` in `schemas.ts`).
- Seasons are integers (`2015`). Where a season is an object key it is a string (`"2015"`), because JSON.
- `TeamId` is the canonical franchise id (`LAR`, `LAC`, `LV`, `WAS`, …; `contracts/teams.ts#TEAM_IDS`).
  The pipeline maps every historical code (`STL`, `SD`, `OAK`, `LA`, `WSH`, `JAC`) through `TEAM_ALIASES`.
- `PlayerId` is `gsis_id` for real players; procedural players use `gen-<seed>-<n>`.
- All ratings (`ovr`, `pot`, `trueValue`, trajectory values) are on one 40–99 scale that is
  position-invariant: a 90 OL is as elite within position as a 90 QB. Positional importance lives in the
  sim weights, not the ratings.
- Position groups: `QB RB WR TE OL DL LB CB S K P`. Map `T/G/C → OL`, `DE/DT/NT → DL`,
  `OLB/ILB/MLB → LB`, `FS/SS → S`, `FB → RB`, `HB → RB`, `LS → OL` (long snappers are rare; group them
  with OL rather than invent a position). From 2016 nflverse rosters label whole units in `position`
  (`DB`, `OL`, `DL`, `LB`); the finer `depth_chart_position` (`FS`/`SS`/`CB`, `T`/`G`/`C`, …) decides the
  group when it is present, and a bare `DB` falls back to `CB`.
- No `headshot_url`, no logo/wordmark URLs, anywhere. The `teams` schema has no field for them.

## Load plan and size budget (HANDOFF §6.10)

| When | Files | Budget (gzipped) |
|---|---|---|
| App start | `manifest.json`, `teams.json`, `cap.json`, `curves.json`, `injuryModel.json` (+ app shell) | ≤ 1.5 MB |
| New game / entering a season | `season/{yyyy}/{players,rosters,draft,schedule}.json` | ≤ 1 MB per season |
| New game (once) | `trajectories.json` | < 3 MB |

The pipeline records gzipped sizes in `manifest.sizesBytes`; CI (Phase 5C) fails the build when a
budget is exceeded. GitHub Pages serves gzip.

## Static files

### `manifest.json` — schema `manifest`
`schemaVersion`, `generatedAt` (ISO), `attribution`, `seasons` (every season with a chunk),
`latestRealSeason` (the last season with complete real data; the engine goes procedural after it),
optional `sizesBytes`.

### `teams.json` — schema `teams`
Exactly 32 `TeamInfo`: `id`, `city`, `name`, `abbr` (current display), `conf`, `div`, `colors`
(`primary`, `secondary`, optional `tertiary`, hex), `aliases` (all nflverse codes the franchise has
used), optional `eras[]` (`from`, `to|null`, `city`, `name`, `abbr`) so the UI shows "St. Louis Rams" in
2015 and "Los Angeles Rams" in 2016. Source: `teams_colors_logos.csv` with URL columns dropped.

### `cap.json` — schema `cap`
`bySeason` in $M keyed by season string (table in HANDOFF §4; 2010 uncapped → 123.0; verify 2026 at
build time), `growthAfterData` = 0.06.

### `curves.json` — schema `curves`
Fit from `fitSeasons` (2010–2023 unless noted). Produced by `ratings-model`.
- `aging[]` per position: `byAge` (expected true-value delta entering a season at that age) and `sd`.
- `slotGrade[]`: consensus `ovr`/`pot`/`sd` at sample overall picks (interpolate between points). Fit
  so the median pick-32 player's real year-3 value maps to the grade.
- `udfaGrade`: `ovrMean`, `ovrSd`, `potQuantiles`.
- `outcomes[]`: for each pick bucket (`1-10`, `11-32`, `33-64`, `65-105`, `106-160`, `161-260`, `UDFA`)
  × position (or `ALL`): `values[yearIdx][quantileIdx]` = true value at career year `years[yearIdx]`
  at quantile `quantiles[quantileIdx]`, plus `bustRate`. Procedural rookies sample from these.
- `retirement[]` per position: `byAge` P(retire after season) at position-mean value, `valueSlope`.
- `positionMix` (shares of a class, sums to ~1), `classSize` (`drafted` ≈ 224–260, `udfa` ≈ 200).
- `names.first[]`, `names.last[]` (≥ 50 each) for procedural players. **Never real player names.**

### `injuryModel.json` — schema `injuryModel`
`ratePerPlayerGame` per position (P(new multi-week injury) per active player per game),
`duration[]` discrete distribution of weeks out, `kinds[]`, `permanentLoss` (`minWeeks`, `p`,
`lossRange`). Fit from `injuries_{season}.csv` (2012+).

## Per-season chunks — `season/{yyyy}/`

### `players.json` — schema `seasonPlayers`
Every player with a real tie to that season: a season-start stint with an active-adjacent status
(`ACT`/`RES`/`INA`), a draft slot that season, or a covering contract paying at least 0.6 % of the cap
(`build/rosters.py#MIN_TIE_CAP_PCT`, ≈ $1.1M in 2019). From 2016 the nflverse roster snapshot and the
contracts release both include practice-squad, futures and minimum-tender churn (and the three-year
minimum every undrafted rookie signs), so a `CUT`/`DEV`-only row on a minimum deal is dropped rather than
exported as a day-one free agent: the 2019 pool fell from 1,326 to 494 unsigned players and 2023 from 1,337
to 482; pre-2016 pools are 240–275. `Player` fields (`id`, `name`, `pos`, `birthYear`, `college`,
`heightIn`, `weightLb`, `draft` = `{season, round, pick, team}` or `null` for UDFA, `real: true`,
`rookieSeason`) plus:
- `scouting` — consensus **at season start**, computed only from information public at that point.
- `trueValue` — this season's real value. The engine copies it into `state.truth`; the UI never sees it.
- `team` — the team whose opening-day roster in `rosters.json` lists the player, or `null`. The engine
  starts `null` players in the free-agent pool (`LeagueState.freeAgents`).

### `rosters.json` — schema `seasonRosters`
`rosters[TeamId][]` of `{playerId, apy?, years?, depth?}` — the **opening-day roster**: at most 53 players
per team and every player at most once league-wide, so `league.newGame` starts from a legal roster and
`history.snapToHistory` can place players without cutting. Candidates are each player's season-start
stint (nflverse `roster_{season}.csv`, earliest-week row per player); the 53 are filled by position from
`contracts/teams.ts#ROSTER_TEMPLATE_53`, then the remaining slots, both ranked by roster status
(`ACT`/`RES`/`INA` before `CUT`/`DEV`), then consensus `ovr`, then depth rank, snap share and experience.
Status and rating come before depth so a starter who spent the season on injured reserve stays on the
team that held his contract instead of surfacing as a day-one free agent. A team exports fewer than 53
only when the source has fewer. Everyone else that season appears in `players.json` with `team: null`.
`apy`/`years` are hints from the contracts data when matched (~2011+); the engine synthesizes a contract
when absent. `depth` is the depth-chart order at the player's position group (1 = starter), from
`depth_charts` (all seasons) and snap share (2012+).

### `draft.json` — schema `seasonDraft`
- `order[]`: the real draft order as it happened (`round`, `pick`, `team`, `originalTeam`, `playerId`
  or `null` if unmatched). Compensatory and traded picks are already encoded by `draft_picks.csv`.
- `prospects[]`: every drafted player **and** every real UDFA of that class (`rookie_year == season`
  and no `draft_club`), each with pre-draft `scouting` (slot/combine/age only) and optional `combine`
  percentiles. Their true values live in `trajectories.json`.
- `udfa[]`: ids of the undrafted prospects.

### `schedule.json` — schema `seasonSchedule`
`weeks` (regular-season weeks incl. byes: 17 through 2020, 18 from 2021), `playoffFormat`
(`teams` 12|14, `byesPerConf` 2|1, `regularSeasonGames` 16|17), `games[]` with `id`
(`"<season>-<type>-<week>-<away>@<home>"`), `season`, `week`, `type` (`REG|WC|DIV|CONF|SB`), `home`,
`away`, optional `neutralSite`, and the real `homeScore`/`awayScore` for calibration only. Playoff games
are included with their real participants; the engine ignores them for in-game play and regenerates
the bracket from its own standings.

## `trajectories.json` — schema `trajectories`
The only cross-season file and the only place the hidden truth is stored. `byPlayer[PlayerId]` =
`{start, values[], retiresAfter}` where `values[i]` is the true value in season `start + i`, `null`
for seasons the player was not in the league (gaps), and `retiresAfter` is the last real roster
season. Covers every player who appears in any season chunk. Compact arrays, no names.

## Save file — schema `savedLeague`
`LeagueState` serialized: `divergence` is an array (a `Set` in memory), `savedAt` is added on save,
`schemaVersion` = `SAVE_SCHEMA_VERSION`. Contains `truth` — the export is a spoiler file, and the About
screen says so. Persistence migrates older versions forward before validating.

## Validating in the pipeline

```python
from gridiron_pipeline.schemas import validate
validate("seasonPlayers", players_obj)   # raises jsonschema.ValidationError with a path
```

Validate every file before writing it; write atomically (temp file + rename); never write a file that
fails validation. Log unmatched player ids to `pipeline/.cache/unmatched_{season}.csv`.
