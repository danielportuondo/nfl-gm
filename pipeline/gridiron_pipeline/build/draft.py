"""Real draft order, drafted prospects, and real UDFA pools for one season."""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.build.db_career import db_career
from gridiron_pipeline.build.fullbacks import label_is_fb, season_fullback_ids, tag_fullback
from gridiron_pipeline.build.players import PlayerMaster, birth_year, make_player_record
from gridiron_pipeline.build.positions import (
    db_group,
    fallback_db_group,
    is_unspecified_db,
    map_position_group,
    resolve_position,
    resolve_roster_row_position,
)
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.teams import ATTRIBUTION, canonical_team_id
from gridiron_pipeline.ingest.load import load_combine, load_draft_picks
from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)

_COMBINE_NUMERIC_COLS = ("forty", "bench", "vertical", "broad_jump", "cone", "shuttle")


def _height_to_inches(ht: object) -> float | None:
    if ht is None or (isinstance(ht, float) and pd.isna(ht)):
        return None
    s = str(ht)
    if "-" not in s:
        return None
    feet, inches = s.split("-", 1)
    try:
        return float(feet) * 12 + float(inches)
    except ValueError:
        return None


def _combine_index(master: PlayerMaster) -> dict[str, dict]:
    combine = load_combine()
    out: dict[str, dict] = {}
    for row in combine.itertuples(index=False):
        gsis_id = master.pfr_to_gsis.get(row.pfr_id)
        if gsis_id is None:
            continue
        vals: dict[str, float] = {}
        for col in _COMBINE_NUMERIC_COLS:
            v = getattr(row, col, None)
            if v is not None and not (isinstance(v, float) and pd.isna(v)):
                vals[col] = float(v)
        ht_in = _height_to_inches(row.ht)
        if ht_in is not None:
            vals["heightIn"] = ht_in
        if row.wt is not None and not pd.isna(row.wt):
            vals["weightLb"] = float(row.wt)
        if vals:
            out[gsis_id] = vals
    return out


def _combine_db_groups(master: PlayerMaster) -> dict[str, str]:
    """gsis_id -> "S"/"CB" from the combine's own position label (nflverse draft_picks often only
    says "DB" for classes 2012-2014 and 2021-2024)."""
    combine = load_combine()
    labelled = combine.assign(group=combine["pos"].map(db_group))
    labelled = labelled[labelled["group"].notna()]
    out: dict[str, str] = {}
    for pfr_id, group in zip(labelled["pfr_id"], labelled["group"], strict=True):
        gsis_id = master.pfr_to_gsis.get(pfr_id)
        if gsis_id is not None:
            out[gsis_id] = group
    return out


def _prospect_position(
    gsis_id: str,
    pick_position: object,
    master_position: object,
    combine_db: dict[str, str],
    weight_lb: object,
) -> str | None:
    """Position group of a draft prospect. Defensive backs resolve, in order, from the draft pick's
    own label, the combine, the player's later rosters/depth charts, then a weight cut."""
    pick_group = db_group(pick_position)
    if pick_group is not None:
        return pick_group
    base = master_position if pd.notna(master_position) else pick_position
    if not (is_unspecified_db(base) or is_unspecified_db(pick_position)):
        return map_position_group(base)
    return combine_db.get(gsis_id) or db_career().get(gsis_id) or fallback_db_group(weight_lb)


def _resolve_gsis(row, master: PlayerMaster) -> str | None:
    gsis_id = row.gsis_id
    if pd.isna(gsis_id):
        gsis_id = master.pfr_to_gsis.get(row.pfr_player_id)
    return None if gsis_id is None or (isinstance(gsis_id, float) and pd.isna(gsis_id)) else gsis_id


def build_season_draft(
    season: int,
    master: PlayerMaster,
    ratings: Ratings,
    season_start_roster: pd.DataFrame,
) -> dict:
    picks = load_draft_picks()
    picks = picks[picks["season"] == season].sort_values("pick")
    combine_idx = _combine_index(master)
    combine_db = _combine_db_groups(master)
    fullback_ids = (
        season_fullback_ids(season, season_start_roster)
        if season_start_roster is not None and not season_start_roster.empty
        else set()
    )

    order = []
    prospects = []
    seen_ids: set[str] = set()
    for row in picks.itertuples(index=False):
        team = canonical_team_id(row.team)
        gsis_id = _resolve_gsis(row, master)
        order.append(
            {
                "round": int(row.round),
                "pick": int(row.pick),
                "team": team or str(row.team),
                "originalTeam": team or str(row.team),  # nflverse gives no original-team column
                "playerId": gsis_id,
            }
        )
        if gsis_id is None or team is None or gsis_id in seen_ids:
            continue
        seen_ids.add(gsis_id)

        master_row = master.players.loc[gsis_id] if gsis_id in master.players.index else None
        master_name = master_row["display_name"] if master_row is not None else None
        name = master_name or row.pfr_player_name
        master_pos = master_row["position"] if master_row is not None else None
        by = birth_year(master_row["birth_date"]) if master_row is not None else None
        college = master_row["college_name"] if master_row is not None else row.college
        height_in = master_row["height"] if master_row is not None else None
        weight_lb = master_row["weight"] if master_row is not None else None
        pos_group = _prospect_position(gsis_id, row.position, master_pos, combine_db, weight_lb)

        rec = make_player_record(
            gsis_id=gsis_id,
            name=name,
            pos_group=pos_group,
            birth_year_=by,
            college=college,
            height_in=height_in,
            weight_lb=weight_lb,
            draft={"season": season, "round": int(row.round), "pick": int(row.pick), "team": team},
            rookie_season=season,
        )
        if rec is None:
            continue
        tag_fullback(rec, fullback_ids | ({gsis_id} if label_is_fb(row.position) else set()))
        rec["scouting"] = ratings.prospect_scouting(gsis_id, season, int(row.round), int(row.pick))
        combine = combine_idx.get(gsis_id)
        if combine:
            rec["combine"] = combine
        prospects.append(rec)

    udfa_ids: list[str] = []
    if season_start_roster is not None and not season_start_roster.empty:
        is_rookie = season_start_roster["rookie_year"] == season
        not_drafted = ~season_start_roster["gsis_id"].isin(seen_ids)
        udfa_rows = season_start_roster[is_rookie & not_drafted]
        udfa_rows = udfa_rows[udfa_rows["draft_club"].isna()]
        for row in udfa_rows.itertuples(index=False):
            if row.gsis_id in seen_ids:
                continue
            pos_group = (
                resolve_position(row.position, getattr(row, "depth_chart_position", None))
                or combine_db.get(row.gsis_id)
                or resolve_roster_row_position(row)
            )
            rec = make_player_record(
                gsis_id=row.gsis_id,
                name=row.full_name,
                pos_group=pos_group,
                birth_year_=birth_year(row.birth_date),
                college=row.college,
                height_in=row.height,
                weight_lb=row.weight,
                draft=None,
                rookie_season=season,
            )
            if rec is None:
                continue
            tag_fullback(rec, fullback_ids)
            rec["scouting"] = ratings.udfa_scouting(row.gsis_id, season)
            combine = combine_idx.get(row.gsis_id)
            if combine:
                rec["combine"] = combine
            prospects.append(rec)
            seen_ids.add(row.gsis_id)
            udfa_ids.append(row.gsis_id)

    obj = {
        "attribution": ATTRIBUTION,
        "season": season,
        "order": order,
        "prospects": prospects,
        "udfa": udfa_ids,
    }
    validate("seasonDraft", obj)
    return obj
