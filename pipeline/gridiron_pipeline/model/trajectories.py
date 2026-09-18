"""trajectories.json — the hidden real careers, one compact array per player."""

from __future__ import annotations

import pandas as pd


def build_trajectories(
    true_values: pd.DataFrame, seasons: list[int], attribution: str
) -> dict[str, object]:
    latest = max(seasons)
    by_player: dict[str, object] = {}
    rows = true_values[true_values["season"].isin(seasons)]
    for gsis_id, group in rows.groupby("gsis_id", sort=True):
        by_season = dict(
            zip(group["season"].astype(int), group["true_value"].astype(float), strict=True)
        )
        start = min(by_season)
        last = max(by_season)
        values: list[float | None] = [
            round(by_season[season], 1) if season in by_season else None
            for season in range(start, last + 1)
        ]
        by_player[str(gsis_id)] = {
            "start": start,
            "values": values,
            # A player still on a roster in the last season of real data has not retired.
            "retiresAfter": None if last >= latest else last,
        }
    return {
        "attribution": attribution,
        "seasons": [min(seasons), latest],
        "byPlayer": by_player,
    }
