"""Career-long safety/corner label per player, for defensive backs a single row cannot place.

From 2016 nflverse rosters label every defensive back "DB", and a drafted rookie or UDFA often has
no finer label on his first roster row. Hindsight is the point of this game, so the same player's
later roster rows, depth-chart slots and the players master are fair evidence: each source casts one
vote per row for "S" or "CB" and the majority wins (a tie goes to CB, the more common group).
"""

from __future__ import annotations

import logging
from functools import cache

import pandas as pd

from gridiron_pipeline.build.positions import db_group
from gridiron_pipeline.ingest.load import load_depth_charts, load_players, load_roster

log = logging.getLogger(__name__)

FIRST_CAREER_SEASON = 2008
LAST_CAREER_SEASON = 2025

_ROSTER_LABEL_COLS = ("position", "depth_chart_position")
_DEPTH_CHART_LABEL_COLS = ("depth_position", "position", "pos_abb")  # pos_abb: 2025 schema
_PLAYERS_LABEL_COLS = ("position", "pff_position")
_NGS_SAFETY = frozenset({"SAFETY", "HIGH_SAFETY"})
_NGS_CORNER = frozenset({"CB", "SLOT_CB"})


def _votes(frame: pd.DataFrame, label_cols: tuple[str, ...]) -> pd.DataFrame:
    """One (gsis_id, group) row per row-and-column label that names a safety or a corner."""
    parts = []
    for col in label_cols:
        if col not in frame.columns:
            continue
        group = frame[col].map(db_group)
        known = group.notna() & frame["gsis_id"].notna()
        parts.append(pd.DataFrame({"gsis_id": frame.loc[known, "gsis_id"], "group": group[known]}))
    return pd.concat(parts, ignore_index=True) if parts else _empty_votes()


def _empty_votes() -> pd.DataFrame:
    return pd.DataFrame({"gsis_id": pd.Series(dtype="object"), "group": pd.Series(dtype="object")})


def _ngs_votes(players: pd.DataFrame) -> pd.DataFrame:
    if "ngs_position" not in players.columns:
        return _empty_votes()
    ngs = players["ngs_position"].astype("string").str.upper()
    group = pd.Series(pd.NA, index=players.index, dtype="object")
    group[ngs.isin(_NGS_SAFETY).fillna(False)] = "S"
    group[ngs.isin(_NGS_CORNER).fillna(False)] = "CB"
    known = group.notna() & players["gsis_id"].notna()
    return pd.DataFrame({"gsis_id": players.loc[known, "gsis_id"], "group": group[known]})


@cache
def db_career(
    first_season: int = FIRST_CAREER_SEASON, last_season: int = LAST_CAREER_SEASON
) -> dict[str, str]:
    """gsis_id -> "S" or "CB", for every player any source labels as one of the two."""
    frames = []
    for season in range(first_season, last_season + 1):
        frames.append(_votes(load_roster(season), _ROSTER_LABEL_COLS))
        depth = load_depth_charts(season)
        if depth is not None:
            if "formation" in depth.columns:
                depth = depth[depth["formation"] == "Defense"]
            frames.append(_votes(depth, _DEPTH_CHART_LABEL_COLS))
    players = load_players()
    frames.append(_votes(players, _PLAYERS_LABEL_COLS))
    frames.append(_ngs_votes(players))

    votes = pd.concat(frames, ignore_index=True)
    tally = votes.groupby(["gsis_id", "group"]).size().unstack(fill_value=0)
    safeties = tally.get("S", pd.Series(0, index=tally.index))
    corners = tally.get("CB", pd.Series(0, index=tally.index))
    career = pd.Series("CB", index=tally.index).where(safeties <= corners, "S")
    log.info("career S/CB labels for %d players (%d safeties)", len(career), (career == "S").sum())
    return career.to_dict()
