"""trajectories.json — the hidden real careers, one compact array per player."""

from __future__ import annotations

import pandas as pd

from gridiron_pipeline.model.data import availability


def _last_season_on_the_field(avail_by_season: dict[int, float], latest: int) -> int:
    """Last season with a game played, or the last roster season if that runs to the data's end.

    Roster rows outlive careers: a veteran released in camp or retiring in August (Anquan Boldin,
    2017) still has a roster row and a zero-game season, which used to make `retiresAfter` a year
    late and left him signable in the final year's pool. A player with no game at all keeps his
    first roster season so he stays covered.
    """
    first, last = min(avail_by_season), max(avail_by_season)
    if last >= latest:
        return last
    played = [season for season, avail in avail_by_season.items() if avail > 0]
    return max(played) if played else first


def build_trajectories(
    true_values: pd.DataFrame, seasons: list[int], attribution: str
) -> dict[str, object]:
    latest = max(seasons)
    by_player: dict[str, object] = {}
    rows = true_values[true_values["season"].isin(seasons)]
    rows = rows.assign(avail=availability(rows))
    for gsis_id, group in rows.groupby("gsis_id", sort=True):
        seasons_played = group["season"].astype(int)
        value_by_season = dict(zip(seasons_played, group["true_value"].astype(float), strict=True))
        avail_by_season = dict(zip(seasons_played, group["avail"].astype(float), strict=True))
        start = min(value_by_season)
        last = _last_season_on_the_field(avail_by_season, latest)
        span = range(start, last + 1)
        by_player[str(gsis_id)] = {
            "start": start,
            "values": [
                round(value_by_season[s], 1) if s in value_by_season else None for s in span
            ],
            # Lets the in-game refresh tell a missed real season from a bad one.
            "avail": [round(avail_by_season[s], 2) if s in avail_by_season else None for s in span],
            # A player still on a roster in the last season of real data has not retired.
            "retiresAfter": None if last >= latest else last,
        }
    return {
        "attribution": attribution,
        "seasons": [min(seasons), latest],
        "byPlayer": by_player,
    }
