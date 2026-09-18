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
