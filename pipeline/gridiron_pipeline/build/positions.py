"""Fine-grained nflverse position -> the 11 position groups (docs/DATA_CONTRACT.md conventions)."""

from __future__ import annotations

import logging
from collections.abc import Mapping

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
}

# "DB" is deliberately absent: it says nothing about corner versus safety, and guessing CB is what
# left whole draft classes and UDFA pools without safeties (see `resolve_player_position`).
_UNSPECIFIED_DB = "DB"

_SAFETY_LABELS: frozenset[str] = frozenset({"S", "FS", "SS", "SAF", "WS"})
_CORNER_LABELS: frozenset[str] = frozenset({"CB", "LCB", "RCB", "NCB", "MCB", "NB", "NKL"})

# Last-resort split for a defensive back no source pins down. Safeties average ~206 lb and corners
# ~194 lb among players nflverse does label (sd ~8.5 lb each, height does not separate them); 202 lb
# is the best single cut (78% accurate) and tags ~38% of unresolved DBs as safeties against ~40% of
# labelled DBs, so the S:CB ratio stays realistic. Unknown weight stays CB, the more common group.
SAFETY_MIN_WEIGHT_LB = 202.0


# Labels nflverse rosters use as a whole unit from 2016 on (`position` = "DB" for every safety and
# corner, "OL"/"DL"/"LB" likewise). The finer `depth_chart_position` still says FS/SS/T/G/DE/ILB.
_COARSE: frozenset[str] = frozenset({"DB", "OL", "DL", "LB"})


def db_group(label: object) -> str | None:
    """S or CB when the label pins a defensive back down; None otherwise, bare "DB" included."""
    if not isinstance(label, str):
        return None
    code = label.strip().upper()
    if code in _SAFETY_LABELS:
        return "S"
    if code in _CORNER_LABELS:
        return "CB"
    return None


def is_unspecified_db(label: object) -> bool:
    return isinstance(label, str) and label.strip().upper() == _UNSPECIFIED_DB


def fallback_db_group(weight_lb: object) -> str:
    weight = _as_float(weight_lb)
    return "S" if weight is not None and weight >= SAFETY_MIN_WEIGHT_LB else "CB"


def resolve_position(position: object, fine: object = None) -> str | None:
    """Position group for a roster row: the fine label wins when the main one is a whole unit.

    Returns None for a defensive back neither label pins down; `resolve_player_position` settles
    those. Without the fine label every 2016+ safety read as a corner, so the league had no
    safeties: every team needed one, the 53-man template's S slots went unfilled, and the draft and
    trade AIs chased a position nobody could supply.
    """
    code = str(position).strip().upper() if position is not None else ""
    if code in _COARSE and fine is not None and not _is_missing(fine):
        fine_code = str(fine).strip().upper()
        group = db_group(fine_code) if code == _UNSPECIFIED_DB else _MAP.get(fine_code)
        if group is not None:
            return group
    return map_position_group(position)


def resolve_player_position(
    position: object,
    fine: object,
    gsis_id: object,
    weight_lb: object = None,
    career: Mapping[str, str] | None = None,
) -> str | None:
    """`resolve_position`, then for an unspecified DB: the player's career label, then weight."""
    group = resolve_position(position, fine)
    if group is not None or not is_unspecified_db(position):
        return group
    if career is None:
        from gridiron_pipeline.build.db_career import db_career

        career = db_career()
    return career.get(gsis_id) or fallback_db_group(weight_lb)  # type: ignore[arg-type]


def resolve_roster_row_position(row: object) -> str | None:
    """`resolve_player_position` for an itertuples row of a nflverse roster file."""
    return resolve_player_position(
        getattr(row, "position", None),
        getattr(row, "depth_chart_position", None),
        getattr(row, "gsis_id", None),
        getattr(row, "weight", None),
    )


def _as_float(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return None if number != number else number


def _is_missing(value: object) -> bool:
    return value is None or value != value  # NaN


def map_position_group(pos: object) -> str | None:
    """Map a fine-grained nflverse position code to one of the 11 position groups, or None."""
    if pos is None or is_unspecified_db(pos):
        return None
    code = str(pos).strip().upper()
    group = _MAP.get(code)
    if group is None:
        log.warning("unknown position code %r, dropping", pos)
        return None
    return group
