"""Injury rate/duration model fit from injuries_{season}.csv (2012+ for clean coverage).

`report_status == "Out"` weeks are treated as games missed to injury; consecutive Out weeks for a
player collapse into one episode. This is an approximation of true injury duration (the source is
a weekly practice/game report, not a start/end injury log) — documented as an assumption.
"""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.build.positions import POSITION_GROUPS, map_position_group
from gridiron_pipeline.build.teams import ATTRIBUTION
from gridiron_pipeline.ingest.load import load_injuries
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

DURATION_CAP_WEEKS = 8
PERMANENT_LOSS_MIN_WEEKS = 8


def _episodes(season: int) -> list[dict]:
    df = load_injuries(season)
    if df is None:
        return []
    out = df[df["report_status"] == "Out"].copy()
    if out.empty:
        return []
    out["pos_group"] = out["position"].map(map_position_group)
    out = out[out["pos_group"].notna()]

    def kind_at(group: pd.DataFrame, week: int) -> object:
        return group[group["week"] == week]["report_primary_injury"].iloc[0]

    episodes = []
    for (_gsis_id, pos_group), group in out.groupby(["gsis_id", "pos_group"]):
        weeks = sorted(group["week"].dropna().unique().tolist())
        if not weeks:
            continue
        run: list[int] = [weeks[0]]
        run_kind = kind_at(group, weeks[0])
        for w in weeks[1:]:
            if w - run[-1] <= 1:
                run.append(w)
            else:
                episodes.append({"pos": pos_group, "weeks": len(run), "kind": run_kind})
                run = [w]
                run_kind = kind_at(group, w)
        episodes.append({"pos": pos_group, "weeks": len(run), "kind": run_kind})
    return episodes


def build_injury_model(seasons: list[int]) -> dict:
    fit_seasons = [s for s in seasons if s >= 2012]
    if not fit_seasons:
        fit_seasons = seasons

    all_episodes: list[dict] = []
    for season in fit_seasons:
        all_episodes.extend(_episodes(season))

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
        "lossRange": [5.0, 20.0],  # rating-point loss on a season-ending injury; not in source data
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
