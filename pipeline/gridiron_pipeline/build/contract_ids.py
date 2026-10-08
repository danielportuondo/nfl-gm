"""Attach a gsis_id to contract rows that carry none the players table can resolve.

Shared by the game's roster build and the ratings model so both read the same deals.
"""

from __future__ import annotations

import pandas as pd


def _gsis_by_identity(contracts: pd.DataFrame, players: pd.DataFrame) -> pd.Series:
    right = pd.DataFrame(
        {
            "name": players["display_name"],
            "draft_year": pd.to_numeric(players["draft_year"], errors="coerce"),
            "pick": pd.to_numeric(players["draft_pick"], errors="coerce"),
            "born": pd.to_datetime(players["birth_date"], errors="coerce", format="mixed"),
            "gsis_id": players["gsis_id"],
        }
    )
    left = pd.DataFrame(
        {
            "name": contracts["player"],
            "draft_year": pd.to_numeric(contracts["draft_year"], errors="coerce"),
            "pick": pd.to_numeric(contracts["draft_overall"], errors="coerce"),
            "born": pd.to_datetime(contracts["date_of_birth"], errors="coerce", format="mixed"),
        }
    )
    out = pd.Series(pd.NA, index=contracts.index, dtype="object")
    for key in (["name", "draft_year", "pick"], ["name", "born"]):
        unique = right.dropna(subset=key).drop_duplicates(key, keep=False)
        lookup = unique.set_index(key)["gsis_id"]
        found = lookup.reindex(pd.MultiIndex.from_frame(left[key])).to_numpy()
        out = out.where(out.notna(), pd.Series(found, index=contracts.index))
    return out


def fill_gsis_by_identity(
    gsis: pd.Series, contracts: pd.DataFrame, players: pd.DataFrame
) -> pd.Series:
    """Keep every real gsis_id; fill the rest from name + draft year + overall pick, else name +
    birth date, where the players table has exactly one such player.

    Retired players' contract rows often carry neither a gsis_id nor an otc_id the players table
    knows (Joe Thomas's 2011 extension is one), so they would silently read as "no deal". A handful
    of rows carry the otc_id in the gsis column; those count as missing too.
    """
    known = gsis.astype("string").str.startswith("00-").fillna(False).astype(bool)
    return gsis.where(known, _gsis_by_identity(contracts, players))
