"""Fullback tagging: nflverse folds FB into RB, which hands a pass-catching fullback the RB1 job.

The roster file labels fullbacks `position == "FB"` through 2015 and `depth_chart_position == "FB"`
from 2016 (with `position` = RB). Those labels miss some real fullbacks (Juszczyk 2018 and Ingold
2019 read RB/RB), but the depth charts' per-player `position` still says FB, so both count.
"""

from __future__ import annotations

import pandas as pd

from gridiron_pipeline.ingest.load import load_depth_charts

FULLBACK = "FB"

_DEPTH_CHART_COLS = {"game_type", "gsis_id", "position"}


def label_is_fb(value: object) -> bool:
    return isinstance(value, str) and value.strip().upper() == FULLBACK


def _depth_chart_fullbacks(season: int) -> set[str]:
    dc = load_depth_charts(season)
    if dc is None or not _DEPTH_CHART_COLS.issubset(dc.columns):
        return set()
    reg = dc[(dc["game_type"] == "REG") & dc["gsis_id"].notna()]
    share = (reg["position"].map(label_is_fb)).groupby(reg["gsis_id"]).mean()
    return set(share[share >= 0.5].index)


def season_fullback_ids(season: int, start: pd.DataFrame) -> set[str]:
    """gsis_ids nflverse lists as FB in `season`: start-of-season roster row or depth chart."""
    fine = start["depth_chart_position"] if "depth_chart_position" in start.columns else None
    labelled = start["position"].map(label_is_fb)
    if fine is not None:
        labelled = labelled | fine.map(label_is_fb)
    return set(start.loc[labelled, "gsis_id"]) | _depth_chart_fullbacks(season)


def tag_fullback(record: dict, fullback_ids: set[str]) -> None:
    """Set `role: 'FB'` on a player record that is an RB-group fullback (pos is never changed)."""
    if record["pos"] == "RB" and record["id"] in fullback_ids:
        record["role"] = FULLBACK
