"""Canonical player master: gsis_id key, pfr/otc crosswalk, real draft record per player."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

from gridiron_pipeline.build.teams import canonical_team_id
from gridiron_pipeline.ingest.load import load_draft_picks, load_players

log = logging.getLogger(__name__)


@dataclass
class PlayerMaster:
    players: pd.DataFrame  # indexed by gsis_id
    pfr_to_gsis: dict[str, str]
    otc_to_gsis: dict[str, str]
    draft_by_gsis: dict[str, dict]
    unmatched_draft_picks: list[dict] = field(default_factory=list)


def birth_year(birth_date: object) -> int | None:
    if birth_date is None or (isinstance(birth_date, float) and pd.isna(birth_date)):
        return None
    try:
        return pd.Timestamp(str(birth_date)).year
    except (ValueError, TypeError):
        return None


def build_player_master() -> PlayerMaster:
    players = load_players()
    players = players[players["gsis_id"].notna()].drop_duplicates("gsis_id").set_index("gsis_id")

    pfr_to_gsis = {pfr: gsis for gsis, pfr in players["pfr_id"].dropna().items()}
    otc_to_gsis = {otc: gsis for gsis, otc in players["otc_id"].dropna().items()}

    draft = load_draft_picks()
    draft_by_gsis: dict[str, dict] = {}
    unmatched: list[dict] = []
    for row in draft.itertuples(index=False):
        gsis_id = row.gsis_id
        if pd.isna(gsis_id):
            gsis_id = pfr_to_gsis.get(row.pfr_player_id)
        if gsis_id is None or (isinstance(gsis_id, float) and pd.isna(gsis_id)):
            unmatched.append(
                {
                    "season": row.season,
                    "round": row.round,
                    "pick": row.pick,
                    "name": row.pfr_player_name,
                    "reason": "draft_pick_no_gsis_id",
                }
            )
            continue
        team = canonical_team_id(row.team)
        if team is None:
            continue
        draft_by_gsis[gsis_id] = {
            "season": int(row.season),
            "round": int(row.round),
            "pick": int(row.pick),
            "team": team,
        }

    return PlayerMaster(
        players=players,
        pfr_to_gsis=pfr_to_gsis,
        otc_to_gsis=otc_to_gsis,
        draft_by_gsis=draft_by_gsis,
        unmatched_draft_picks=unmatched,
    )


def make_player_record(
    *,
    gsis_id: str,
    name: str,
    pos_group: str,
    birth_year_: int | None,
    college: object,
    height_in: object,
    weight_lb: object,
    draft: dict | None,
    rookie_season: int,
) -> dict | None:
    """Build the shared Player fields (schema seasonPlayers/seasonDraft), or None if unusable."""
    if not name or not pos_group or birth_year_ is None:
        return None
    rec: dict = {
        "id": gsis_id,
        "name": name,
        "pos": pos_group,
        "birthYear": birth_year_,
        "draft": draft,
        "real": True,
        "rookieSeason": int(rookie_season),
    }
    if college is not None and not (isinstance(college, float) and pd.isna(college)):
        rec["college"] = str(college)
    if height_in is not None and not (isinstance(height_in, float) and pd.isna(height_in)):
        rec["heightIn"] = float(height_in)
    if weight_lb is not None and not (isinstance(weight_lb, float) and pd.isna(weight_lb)):
        rec["weightLb"] = float(weight_lb)
    return rec


def estimate_birth_year(rookie_season: int) -> int:
    """Fallback when birth_date is missing from the source: most rookies enter around age 22."""
    return rookie_season - 22


def sane_season(value: object, fallback: int) -> int:
    """nflverse occasionally has sentinel/garbage season values (e.g. rookie_year=1900)."""
    try:
        year = int(value)
    except (TypeError, ValueError):
        return fallback
    return year if 1920 <= year <= 2200 else fallback


def current_age(birth_date_str: object, as_of: date) -> float | None:
    yr = birth_year(birth_date_str)
    if yr is None:
        return None
    try:
        bd = pd.Timestamp(str(birth_date_str))
        return (as_of - bd.date()).days / 365.25
    except (ValueError, TypeError):
        return float(as_of.year - yr)
