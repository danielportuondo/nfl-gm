"""Real schedule + playoff results for one season, from nfldata/games.csv."""

from __future__ import annotations

import pandas as pd

from gridiron_pipeline.build.teams import ATTRIBUTION, canonical_team_id
from gridiron_pipeline.schemas import validate

_GAME_TYPE_MAP = {"REG": "REG", "WC": "WC", "DIV": "DIV", "CON": "CONF", "SB": "SB"}


def _playoff_format(season: int) -> dict:
    if season >= 2021:
        return {"teams": 14, "byesPerConf": 1, "regularSeasonGames": 17}
    if season >= 2020:
        return {"teams": 14, "byesPerConf": 1, "regularSeasonGames": 16}
    return {"teams": 12, "byesPerConf": 2, "regularSeasonGames": 16}


def _score(v: object) -> int | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    return int(v)


def build_season_schedule(season: int, games: pd.DataFrame) -> dict:
    season_games = games[games["season"] == season].copy()
    games_out = []
    for row in season_games.itertuples(index=False):
        game_type = _GAME_TYPE_MAP.get(row.game_type)
        home = canonical_team_id(row.home_team)
        away = canonical_team_id(row.away_team)
        if game_type is None or home is None or away is None:
            continue
        games_out.append(
            {
                "id": f"{season}-{game_type}-{int(row.week)}-{away}@{home}",
                "season": season,
                "week": int(row.week),
                "type": game_type,
                "home": home,
                "away": away,
                "homeScore": _score(row.home_score),
                "awayScore": _score(row.away_score),
            }
        )
    reg_weeks = season_games[season_games["game_type"] == "REG"]["week"]
    weeks = int(reg_weeks.max()) if not reg_weeks.empty else (18 if season >= 2021 else 17)

    obj = {
        "attribution": ATTRIBUTION,
        "season": season,
        "weeks": weeks,
        "playoffFormat": _playoff_format(season),
        "games": games_out,
    }
    validate("seasonSchedule", obj)
    return obj
