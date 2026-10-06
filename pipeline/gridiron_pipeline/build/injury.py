"""Injury rate/duration model fit from injuries_{season}.csv (2012+ for clean coverage).

`report_status == "Out"` weeks are treated as games missed to injury; consecutive Out weeks for a
player collapse into one episode, and its occurrence (which position, how many episodes) is counted
from the report alone. This under-states *duration*, though: the weekly practice/game report stops
listing a player once they move to injured reserve (they no longer practice or dress), so a
season-ending injury shows only the few "Out" weeks before the player drops off the report. To
recover the true length, each report episode's end week is extended through any `RES` (reserve —
IR/PUP/NFI) run for that player in `roster_weekly_{season}.csv` (nflverse's weekly roster snapshot,
distinct from the season-stint file `rosters/roster_{season}.csv` used elsewhere in build/) that
starts within `RES_MATCH_MAX_GAP` weeks of it. Occurrence is deliberately left alone — a player with
an RES run but no matching report episode (e.g. hurt before the reporting window opens) is not
turned into a new episode, so `ratePerPlayerGame` (and the sim's calibrated occurrence rate) is
unaffected; only the shape of the `duration` distribution changes.
"""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.build.positions import (
    POSITION_GROUPS,
    resolve_player_position,
    resolve_roster_row_position,
)
from gridiron_pipeline.build.rosters import season_roster_stints, season_start_roster
from gridiron_pipeline.build.teams import ATTRIBUTION
from gridiron_pipeline.ingest.load import load_injuries, load_weekly_roster
from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)

# Mirrors app/src/contracts/teams.ts ROSTER_TEMPLATE_53 (denominator for player-games).
ROSTER_TEMPLATE_53: dict[str, int] = {
    "QB": 3,
    "RB": 4,
    "WR": 6,
    "TE": 3,
    "OL": 9,
    "DL": 9,
    "LB": 7,
    "CB": 6,
    "S": 4,
    "K": 1,
    "P": 1,
}

# Mirrors app/src/engine/sim/constants.ts injuryConstants.maxWeeksOut. The engine already clamps a
# sampled `weeksOut` to this ceiling, so capping the fit at the same number keeps both ends of the
# pipe in lockstep. A regular-season-length cap (16-18 games depending on era) would be arbitrary
# here: the fit pools 2012-2025 seasons of varying length, and the longest observed episode (11
# weeks — a player who never reappeared as healthy before that season's report ended) sits well
# under either ceiling anyway. The report-based method (consecutive "Out" weeks) structurally can't
# see a true season-ending run past where the weekly report stops, so 22 costs nothing today and
# avoids silently reintroducing a mismatch if a future season's data produces a longer run.
DURATION_CAP_WEEKS = 22
# Independent of DURATION_CAP_WEEKS: "permanent loss" means 8+ weeks out, regardless of where the
# duration distribution itself is capped.
PERMANENT_LOSS_MIN_WEEKS = 8

RES_STATUS = "RES"
# The injury report normally stops a week or two before the roster move to reserve is recorded (or,
# rarely, the other way around); a small gap still counts as the same injury, a large one does not.
RES_MATCH_MAX_GAP = 2


def _res_runs_by_player(season: int) -> dict[str, list[list[int]]]:
    """gsis_id -> that player's `RES`-status weeks that season, merged into consecutive runs.

    Mirrors the report episode merge below (weeks with a gap of at most 1 belong to the same run).
    """
    df = load_weekly_roster(season)
    if df is None:
        return {}
    res = df[df["status"] == RES_STATUS].copy()
    if res.empty:
        return {}
    runs: dict[str, list[list[int]]] = {}
    for gsis_id, group in res.groupby("gsis_id"):
        weeks = sorted(group["week"].dropna().unique().tolist())
        if not weeks:
            continue
        player_runs: list[list[int]] = []
        run = [weeks[0]]
        for w in weeks[1:]:
            if w - run[-1] <= 1:
                run.append(w)
            else:
                player_runs.append(run)
                run = [w]
        player_runs.append(run)
        runs[gsis_id] = player_runs
    return runs


def _extend_with_res(report_last_week: int, res_runs: list[list[int]]) -> int:
    """Chain any `RES` runs onto a report episode's last week, greedily extending forward."""
    end = report_last_week
    changed = True
    while changed:
        changed = False
        for run in res_runs:
            if run[0] - end <= RES_MATCH_MAX_GAP and run[-1] > end:
                end = run[-1]
                changed = True
    return end


def _position_by_player(season: int) -> dict[str, str]:
    """gsis_id -> position group from the season roster's fine `depth_chart_position`.

    The injury report only carries the coarse `position`, which from 2016 is "DB" for every safety
    and corner; keyed on the roster, safeties are fit as safeties.
    """
    start = season_start_roster(season_roster_stints(season))
    groups: dict[str, str] = {}
    for row in start.itertuples(index=False):
        group = resolve_roster_row_position(row)
        if group is not None:
            groups[row.gsis_id] = group
    return groups


def _episodes(season: int, use_res_extension: bool = False) -> list[dict]:
    """`use_res_extension=True` recovers true season-ending duration (see module docstring). The
    export uses it; `injuryConstants.rateScale` in app/src/engine/sim/constants.ts is tuned against
    the resulting duration mix, so flipping it back requires a retune there.
    """
    df = load_injuries(season)
    if df is None:
        return []
    out = df[df["report_status"] == "Out"].copy()
    if out.empty:
        return []
    fine = _position_by_player(season)
    reported = pd.Series(
        [
            resolve_player_position(pos, None, gid)
            for pos, gid in zip(out["position"], out["gsis_id"], strict=True)
        ],
        index=out.index,
    )
    out["pos_group"] = out["gsis_id"].map(fine).fillna(reported)
    out = out[out["pos_group"].notna()]

    res_runs_by_player = _res_runs_by_player(season) if use_res_extension else {}

    def kind_at(group: pd.DataFrame, week: int) -> object:
        return group[group["week"] == week]["report_primary_injury"].iloc[0]

    def emit(pos_group: str, run: list[int], run_kind: object, gsis_id: str) -> dict:
        end = _extend_with_res(run[-1], res_runs_by_player.get(gsis_id, []))
        return {"pos": pos_group, "weeks": end - run[0] + 1, "kind": run_kind}

    episodes = []
    for (gsis_id, pos_group), group in out.groupby(["gsis_id", "pos_group"]):
        weeks = sorted(group["week"].dropna().unique().tolist())
        if not weeks:
            continue
        run: list[int] = [weeks[0]]
        run_kind = kind_at(group, weeks[0])
        for w in weeks[1:]:
            if w - run[-1] <= 1:
                run.append(w)
            else:
                episodes.append(emit(pos_group, run, run_kind, gsis_id))
                run = [w]
                run_kind = kind_at(group, w)
        episodes.append(emit(pos_group, run, run_kind, gsis_id))
    return episodes


def build_injury_model(seasons: list[int], use_res_extension: bool = False) -> dict:
    fit_seasons = [s for s in seasons if s >= 2012]
    if not fit_seasons:
        fit_seasons = seasons

    all_episodes: list[dict] = []
    for season in fit_seasons:
        all_episodes.extend(_episodes(season, use_res_extension=use_res_extension))

    counts_by_pos: dict[str, int] = dict.fromkeys(POSITION_GROUPS, 0)
    duration_counts: dict[int, int] = {}
    kind_counts: dict[str, int] = {}
    for ep in all_episodes:
        counts_by_pos[ep["pos"]] = counts_by_pos.get(ep["pos"], 0) + 1
        bucket = min(ep["weeks"], DURATION_CAP_WEEKS)
        duration_counts[bucket] = duration_counts.get(bucket, 0) + 1
        kind = str(ep["kind"]).strip() if ep["kind"] and not pd.isna(ep["kind"]) else "Unspecified"
        kind_counts[kind] = kind_counts.get(kind, 0) + 1

    total_player_games: dict[str, int] = {}
    for season in fit_seasons:
        games_per_team = 17 if season >= 2021 else 16
        for pos, roster_n in ROSTER_TEMPLATE_53.items():
            games_for_pos = 32 * games_per_team * roster_n
            total_player_games[pos] = total_player_games.get(pos, 0) + games_for_pos

    rate_per_player_game = {
        pos: round(min(1.0, counts_by_pos.get(pos, 0) / total_player_games.get(pos, 1)), 4)
        for pos in POSITION_GROUPS
    }

    total_episodes = sum(duration_counts.values()) or 1
    duration = [
        {"weeks": weeks, "p": round(count / total_episodes, 4)}
        for weeks, count in sorted(duration_counts.items())
    ]

    total_kinds = sum(kind_counts.values()) or 1
    top_kinds = sorted(kind_counts.items(), key=lambda kv: -kv[1])[:15]
    kinds = [{"kind": kind, "p": round(count / total_kinds, 4)} for kind, count in top_kinds]

    long_episodes = sum(1 for ep in all_episodes if ep["weeks"] >= PERMANENT_LOSS_MIN_WEEKS)
    permanent_loss = {
        "minWeeks": PERMANENT_LOSS_MIN_WEEKS,
        "p": round(long_episodes / total_episodes, 4),
        # Rating-point loss after a long injury (HANDOFF §6.7); not in the source data.
        "lossRange": [1.0, 3.0],
    }

    obj = {
        "attribution": ATTRIBUTION,
        "fitSeasons": [min(fit_seasons), max(fit_seasons)],
        "ratePerPlayerGame": rate_per_player_game,
        "duration": duration,
        "kinds": kinds,
        "permanentLoss": permanent_loss,
    }
    validate("injuryModel", obj)
    return obj
