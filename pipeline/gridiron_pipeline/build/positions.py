"""Fine-grained nflverse position -> the 11 position groups (docs/DATA_CONTRACT.md conventions)."""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

POSITION_GROUPS: tuple[str, ...] = ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P")

_MAP: dict[str, str] = {
    "QB": "QB",
    "RB": "RB",
    "HB": "RB",
    "FB": "RB",
    "WR": "WR",
    "TE": "TE",
    "OL": "OL",
    "T": "OL",
    "OT": "OL",
    "G": "OL",
    "OG": "OL",
    "C": "OL",
    "LS": "OL",
    "DL": "DL",
    "DE": "DL",
    "DT": "DL",
    "NT": "DL",
    "LB": "LB",
    "OLB": "LB",
    "ILB": "LB",
    "MLB": "LB",
    "CB": "CB",
    "S": "S",
    "FS": "S",
    "SS": "S",
    "SAF": "S",
    "K": "K",
    "PK": "K",
    "P": "P",
    # Ambiguous in some nflverse sources (draft_picks.csv especially); default to the more common
    # outcome for this generic label rather than invent a 12th group.
    "DB": "CB",
}


# Labels nflverse rosters use as a whole unit from 2016 on (`position` = "DB" for every safety and
# corner, "OL"/"DL"/"LB" likewise). The finer `depth_chart_position` still says FS/SS/T/G/DE/ILB.
_COARSE: frozenset[str] = frozenset({"DB", "OL", "DL", "LB"})


def resolve_position(position: object, fine: object = None) -> str | None:
    """Position group for a roster row: the fine label wins when the main one is a whole unit.

    Without this every 2016+ safety maps to CB (the "DB" default), so the league had no safeties:
    every team read as needing one, the 53-man template's S slots went unfilled, and the draft and
    trade AIs chased a position nobody could supply.
    """
    code = str(position).strip().upper() if position is not None else ""
    if code in _COARSE and fine is not None and not _is_missing(fine):
        group = _MAP.get(str(fine).strip().upper())
        if group is not None:
            return group
    return map_position_group(position)


def _is_missing(value: object) -> bool:
    return value is None or value != value  # NaN


def map_position_group(pos: object) -> str | None:
    """Map a fine-grained nflverse position code to one of the 11 position groups, or None."""
    if pos is None:
        return None
    code = str(pos).strip().upper()
    group = _MAP.get(code)
    if group is None:
        log.warning("unknown position code %r, dropping", pos)
        return None
    return group
