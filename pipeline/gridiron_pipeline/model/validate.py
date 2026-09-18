"""Validation helpers: does the rating scale reproduce real team quality?

Used by tests/test_model.py and by the CLI's `--report` flag.
"""

from __future__ import annotations

import pandas as pd

from gridiron_pipeline.model.data import load_games
from gridiron_pipeline.model.truevalue import primary_team

# app/src/contracts/teams.ts#STARTER_TEMPLATE
STARTER_TEMPLATE: dict[str, int] = {
    "QB": 1,
    "RB": 1,
    "WR": 3,
    "TE": 1,
    "OL": 5,
    "DL": 4,
    "LB": 3,
    "CB": 3,
    "S": 2,
    "K": 1,
    "P": 1,
}


def point_differential(season: int) -> pd.Series:
    games = load_games()
    games = games[(games["season"] == season) & (games["game_type"] == "REG")]
    games = games.dropna(subset=["home_score", "away_score"])
    home = games.groupby("home_team").apply(
        lambda g: (g["home_score"] - g["away_score"]).sum(), include_groups=False
    )
    away = games.groupby("away_team").apply(
        lambda g: (g["away_score"] - g["home_score"]).sum(), include_groups=False
    )
    return home.add(away, fill_value=0.0)


def team_starter_value(true_values: pd.DataFrame, season: int) -> pd.Series:
    """Mean true value of each team's notional starting lineup for `season`."""
    season_rows = true_values[true_values["season"] == season].copy()
    if "team" not in season_rows.columns:
        season_rows["team"] = season_rows["gsis_id"].map(primary_team(season))
    season_rows = season_rows.dropna(subset=["team"])
    picks: list[pd.DataFrame] = []
    for pos, slots in STARTER_TEMPLATE.items():
        at_pos = season_rows[season_rows["pos"] == pos]
        picks.append(at_pos.sort_values("true_value", ascending=False).groupby("team").head(slots))
    starters = pd.concat(picks)
    return starters.groupby("team")["true_value"].mean()


def starter_value_correlations(true_values: pd.DataFrame, seasons: list[int]) -> pd.Series:
    out = {}
    for season in seasons:
        strength = team_starter_value(true_values, season)
        diff = point_differential(season)
        joined = pd.concat([strength.rename("value"), diff.rename("diff")], axis=1).dropna()
        out[season] = joined["value"].corr(joined["diff"])
    return pd.Series(out, name="corr")
