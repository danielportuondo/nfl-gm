"""Real draft order, drafted prospects, and real UDFA pools for one season."""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.build.players import PlayerMaster, birth_year, make_player_record
from gridiron_pipeline.build.positions import map_position_group
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
        pos_source = master_pos if master_row is not None and pd.notna(master_pos) else row.position
        pos_group = map_position_group(pos_source)
        by = birth_year(master_row["birth_date"]) if master_row is not None else None
        college = master_row["college_name"] if master_row is not None else row.college
        height_in = master_row["height"] if master_row is not None else None
        weight_lb = master_row["weight"] if master_row is not None else None

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
            pos_group = map_position_group(row.position)
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
