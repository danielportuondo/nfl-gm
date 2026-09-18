"""Per-season roster snapshot, depth order, and contract (apy/years) hints."""

from __future__ import annotations

import csv
import logging

import pandas as pd

from gridiron_pipeline import CACHE_DIR
from gridiron_pipeline.build.players import (
    PlayerMaster,
    birth_year,
    estimate_birth_year,
    make_player_record,
    sane_season,
)
from gridiron_pipeline.build.positions import map_position_group
from gridiron_pipeline.build.teams import ATTRIBUTION, canonical_team_id
from gridiron_pipeline.ingest.load import (
    load_contracts,
    load_depth_charts,
    load_roster,
    load_snap_counts,
)
from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)


def _unmatched_logger(season: int):
    """Overwrite (not append) each run, so re-running `make data` doesn't accumulate duplicates."""
    path = CACHE_DIR / f"unmatched_{season}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    f = path.open("w", newline="")
    writer = csv.writer(f)
    writer.writerow(["stage", "id_or_name", "reason"])
    return f, writer


def season_roster_stints(season: int) -> pd.DataFrame:
    """One row per (player, team) stint that season, earliest-week row kept, team canonicalized."""
    raw = load_roster(season)
    raw = raw[raw["gsis_id"].notna()].copy()
    raw["team_canon"] = raw["team"].map(canonical_team_id)
    raw = raw[raw["team_canon"].notna()]
    raw = raw.sort_values("week", na_position="last")
    stints = raw.drop_duplicates(subset=["gsis_id", "team_canon"], keep="first")
    return stints


def season_start_roster(stints: pd.DataFrame) -> pd.DataFrame:
    """One row per player: the earliest-week stint, i.e. team/status at season start."""
    return stints.sort_values("week", na_position="last").drop_duplicates("gsis_id", keep="first")


_REQUIRED_DEPTH_CHART_COLS = {"game_type", "gsis_id", "club_code", "depth_team"}


def _depth_from_depth_charts(season: int) -> dict[tuple[str, str], int]:
    dc = load_depth_charts(season)
    if dc is None:
        return {}
    if not _REQUIRED_DEPTH_CHART_COLS.issubset(dc.columns):
        # nflverse changed the depth_charts schema for the in-progress/current season at some
        # point (no game_type/week/depth_team columns). Fall back to snap-share + years_exp.
        log.warning("depth_charts_%d.csv has an unexpected schema, skipping", season)
        return {}
    dc = dc[(dc["game_type"] == "REG") & dc["gsis_id"].notna()].copy()
    dc["team_canon"] = dc["club_code"].map(canonical_team_id)
    dc = dc[dc["team_canon"].notna()]
    agg = dc.groupby(["team_canon", "gsis_id"])["depth_team"].min()
    return {(t, g): int(v) for (t, g), v in agg.items()}


def _snap_score(season: int, master: PlayerMaster) -> dict[tuple[str, str], float]:
    sc = load_snap_counts(season)
    if sc is None:
        return {}
    sc = sc.copy()
    sc["gsis_id"] = sc["pfr_player_id"].map(master.pfr_to_gsis)
    sc = sc[sc["gsis_id"].notna()]
    sc["team_canon"] = sc["team"].map(canonical_team_id)
    sc = sc[sc["team_canon"].notna()]
    sc["total_pct"] = sc[["offense_pct", "defense_pct", "st_pct"]].fillna(0).sum(axis=1)
    agg = sc.groupby(["team_canon", "gsis_id"])["total_pct"].sum()
    return {(t, g): float(v) for (t, g), v in agg.items()}


def compute_depth_ranks(
    season: int, stints: pd.DataFrame, master: PlayerMaster
) -> dict[tuple[str, str, str], int]:
    """depth rank (1 = starter) per (team, posGroup, gsis_id), for players in `stints`."""
    dc_rank = _depth_from_depth_charts(season)
    snaps = _snap_score(season, master)
    stint_keys = list(zip(stints["team_canon"], stints["gsis_id"], strict=True))
    years_exp = dict(zip(stint_keys, stints["years_exp"].fillna(0), strict=True))

    by_group: dict[tuple[str, str], list[tuple]] = {}
    for row in stints.itertuples(index=False):
        pos_group = map_position_group(row.position)
        if pos_group is None:
            continue
        key = (row.team_canon, pos_group)
        dc_key = (row.team_canon, row.gsis_id)
        sort_key = (
            dc_rank.get(dc_key, 10**6),
            -snaps.get(dc_key, 0.0),
            -years_exp.get(dc_key, 0.0),
            row.gsis_id,
        )
        by_group.setdefault(key, []).append((sort_key, row.gsis_id))

    out: dict[tuple[str, str, str], int] = {}
    for (team, pos_group), items in by_group.items():
        items.sort(key=lambda x: x[0])
        for rank, (_, gsis_id) in enumerate(items, start=1):
            out[(team, pos_group, gsis_id)] = rank
    return out


def _contract_index(master: PlayerMaster) -> dict[str, list[tuple[int, int, float]]]:
    """gsis_id -> sorted [(year_signed, years, apy)] contracts, via otc_id crosswalk."""
    try:
        contracts = load_contracts()
    except Exception:  # noqa: BLE001 - contracts are a best-effort enrichment
        log.warning("contracts data unavailable; apy/years hints will be omitted")
        return {}
    contracts = contracts[contracts["otc_id"].notna() & contracts["year_signed"].notna()]
    idx: dict[str, list[tuple[int, int, float]]] = {}
    for row in contracts.itertuples(index=False):
        gsis_id = master.otc_to_gsis.get(row.otc_id)
        if gsis_id is None or pd.isna(row.apy):
            continue
        years = int(row.years) if not pd.isna(row.years) else 1
        idx.setdefault(gsis_id, []).append((int(row.year_signed), max(years, 1), float(row.apy)))
    for v in idx.values():
        v.sort()
    return idx


def _contract_hint(idx: dict[str, list[tuple[int, int, float]]], gsis_id: str, season: int) -> dict:
    hints = {}
    for year_signed, years, apy in idx.get(gsis_id, []):
        if year_signed <= season < year_signed + years:
            hints["apy"] = round(apy / 1_000_000, 3)
            hints["years"] = years
            break
    return hints


def build_season_rosters_and_players(
    season: int, master: PlayerMaster, ratings
) -> tuple[dict, dict]:
    """Build rosters.json and players.json for one season together (they share the roster scan)."""
    stints = season_roster_stints(season)
    start = season_start_roster(stints)
    depth_ranks = compute_depth_ranks(season, stints, master)
    contract_idx = _contract_index(master)

    unmatched_file, unmatched_writer = _unmatched_logger(season)

    # Build players.json first; rosters.json is then restricted to ids that made it in, so a
    # rostered playerId always resolves in players.json (DATA_CONTRACT acceptance criterion).
    players = []
    valid_ids: set[str] = set()
    for row in start.itertuples(index=False):
        pos_group = map_position_group(row.position)
        draft = master.draft_by_gsis.get(row.gsis_id)
        fallback_rookie = draft["season"] if draft else season
        rookie_season = sane_season(row.rookie_year, fallback_rookie)
        by = birth_year(row.birth_date) or estimate_birth_year(rookie_season)
        rec = make_player_record(
            gsis_id=row.gsis_id,
            name=row.full_name,
            pos_group=pos_group,
            birth_year_=by,
            college=row.college,
            height_in=row.height,
            weight_lb=row.weight,
            draft=draft,
            rookie_season=rookie_season,
        )
        if rec is None:
            unmatched_writer.writerow(["players", row.gsis_id, "incomplete attributes"])
            continue
        depth = depth_ranks.get((row.team_canon, rec["pos"], row.gsis_id))
        is_rookie_now = rec["rookieSeason"] == season
        scouting, true_value = ratings.for_player_season(
            row.gsis_id, season, rec["pos"], depth, rookie=is_rookie_now
        )
        rec["scouting"] = scouting
        rec["trueValue"] = true_value
        rec["team"] = row.team_canon
        players.append(rec)
        valid_ids.add(row.gsis_id)

    rosters: dict[str, list[dict]] = {}
    for row in stints.itertuples(index=False):
        if row.gsis_id not in valid_ids:
            continue
        pos_group = map_position_group(row.position)
        if pos_group is None:
            unmatched_writer.writerow(["roster", row.gsis_id, f"unmapped position {row.position}"])
            continue
        entry: dict = {"playerId": row.gsis_id}
        depth = depth_ranks.get((row.team_canon, pos_group, row.gsis_id))
        if depth is not None:
            entry["depth"] = depth
        entry.update(_contract_hint(contract_idx, row.gsis_id, season))
        rosters.setdefault(row.team_canon, []).append(entry)
    for team in rosters:
        rosters[team].sort(key=lambda e: (e.get("depth", 999), e["playerId"]))
    unmatched_file.close()

    rosters_obj = {"attribution": ATTRIBUTION, "season": season, "rosters": rosters}
    players_obj = {"attribution": ATTRIBUTION, "season": season, "players": players}
    validate("seasonRosters", rosters_obj)
    validate("seasonPlayers", players_obj)
    return rosters_obj, players_obj
