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

# Mirrors app/src/contracts/teams.ts#ROSTER_TEMPLATE_53 (contract; not owned by this agent, copied
# exactly). Sums to 53.
ROSTER_TEMPLATE_53: dict[str, int] = {
    "QB": 3,
    "RB": 4,
    "WR": 6,
    "TE": 3,
    "OL": 9,
    "DL": 9,
    "LB": 7,
    "CB": 6,
    "S": 4,
    "K": 1,
    "P": 1,
}
assert sum(ROSTER_TEMPLATE_53.values()) == 53

# roster_{season}.csv `status` values, tiebreak priority for the 53-man cut: players plausibly
# active or on the active-adjacent list (ACT/RES/INA) beat everyone else (CUT/DEV/SUS/RSN/RSR/NWT/
# RET/TRC/TRD/E14/TRT/...). Never used to drop a player from players.json, only to order fill.
_STATUS_PRIORITY_GOOD = frozenset({"ACT", "RES", "INA"})


def _status_priority(status: object) -> int:
    if status is None or (isinstance(status, float) and pd.isna(status)):
        return 1
    return 0 if str(status).strip().upper() in _STATUS_PRIORITY_GOOD else 1


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
    season: int, start: pd.DataFrame, master: PlayerMaster, snaps: dict[tuple[str, str], float]
) -> dict[tuple[str, str, str], int]:
    """depth rank (1 = starter) per (team, posGroup, gsis_id), for players in `start`.

    Ranks are computed over the season-start roster (one row per player) so they come out
    contiguous per (team, posGroup) — a prerequisite for filling the 53-man template in rank order.
    """
    dc_rank = _depth_from_depth_charts(season)

    by_group: dict[tuple[str, str], list[tuple]] = {}
    for row in start.itertuples(index=False):
        pos_group = map_position_group(row.position)
        if pos_group is None:
            continue
        key = (row.team_canon, pos_group)
        dc_key = (row.team_canon, row.gsis_id)
        raw_exp = row.years_exp
        years_exp = float(raw_exp) if raw_exp is not None and not pd.isna(raw_exp) else 0.0
        sort_key = (
            dc_rank.get(dc_key, 10**6),
            -snaps.get(dc_key, 0.0),
            -float(years_exp),
            row.gsis_id,
        )
        by_group.setdefault(key, []).append((sort_key, row.gsis_id))

    out: dict[tuple[str, str, str], int] = {}
    for (team, pos_group), items in by_group.items():
        items.sort(key=lambda x: x[0])
        for rank, (_, gsis_id) in enumerate(items, start=1):
            out[(team, pos_group, gsis_id)] = rank
    return out


def _select_rosters(
    start: pd.DataFrame,
    pos_group_by_id: dict[str, str],
    depth_ranks: dict[tuple[str, str, str], int],
    snaps: dict[tuple[str, str], float],
) -> dict[str, list[str]]:
    """Opening-day 53 per team: fill ROSTER_TEMPLATE_53 by depth rank, then top up to 53.

    Candidates are each team's rows in `start` (season-start stint), restricted to
    `pos_group_by_id` (players that made it into players.json). Every player is a candidate for at
    most one team, since `start` has one row per player league-wide.
    """
    by_team: dict[str, list[dict]] = {}
    for row in start.itertuples(index=False):
        pos_group = pos_group_by_id.get(row.gsis_id)
        if pos_group is None:
            continue
        key = (row.team_canon, row.gsis_id)
        raw_exp = row.years_exp
        years_exp = float(raw_exp) if raw_exp is not None and not pd.isna(raw_exp) else 0.0
        by_team.setdefault(row.team_canon, []).append(
            {
                "gsis_id": row.gsis_id,
                "pos_group": pos_group,
                "depth": depth_ranks.get((row.team_canon, pos_group, row.gsis_id), 10**6),
                "status_priority": _status_priority(row.status),
                "snap": snaps.get(key, 0.0),
                "years_exp": float(years_exp),
            }
        )

    rosters: dict[str, list[str]] = {}
    for team, candidates in by_team.items():
        by_pos: dict[str, list[dict]] = {}
        for c in candidates:
            by_pos.setdefault(c["pos_group"], []).append(c)

        selected: list[str] = []
        selected_ids: set[str] = set()
        for pos_group, count in ROSTER_TEMPLATE_53.items():
            pool = sorted(by_pos.get(pos_group, []), key=lambda c: (c["depth"], c["gsis_id"]))
            for c in pool[:count]:
                selected.append(c["gsis_id"])
                selected_ids.add(c["gsis_id"])

        leftover = [c for c in candidates if c["gsis_id"] not in selected_ids]
        leftover.sort(
            key=lambda c: (
                c["depth"],
                c["status_priority"],
                -c["snap"],
                -c["years_exp"],
                c["gsis_id"],
            )
        )
        slots = max(53 - len(selected), 0)
        for c in leftover[:slots]:
            selected.append(c["gsis_id"])

        rosters[team] = selected
    return rosters


def _contract_index(master: PlayerMaster) -> dict[str, list[tuple[int, int, float]]]:
    """gsis_id -> sorted [(year_signed, years, apy)] contracts.

    The current contracts release carries a direct `gsis_id` column; fall back to the otc_id
    crosswalk for older rows (or a release without it) so matching degrades gracefully.
    """
    try:
        contracts = load_contracts()
    except Exception:  # noqa: BLE001 - contracts are a best-effort enrichment
        log.warning("contracts data unavailable; apy/years hints will be omitted")
        return {}
    contracts = contracts[contracts["year_signed"].notna()]
    has_direct_gsis = "gsis_id" in contracts.columns
    idx: dict[str, list[tuple[int, int, float]]] = {}
    for row in contracts.itertuples(index=False):
        gsis_id = getattr(row, "gsis_id", None) if has_direct_gsis else None
        if gsis_id is None or (isinstance(gsis_id, float) and pd.isna(gsis_id)):
            otc_id = getattr(row, "otc_id", None)
            gsis_id = master.otc_to_gsis.get(otc_id) if otc_id is not None else None
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
            hints["apy"] = round(_apy_millions(apy), 3)
            hints["years"] = years
            break
    return hints


def _apy_millions(apy: float) -> float:
    """The frozen CSV carried APY in dollars; the parquet release carries $M. No NFL salary is
    under $1,000/yr or over $1,000M/yr, so the magnitude alone tells the unit apart."""
    return apy / 1_000_000 if apy >= 1_000 else apy


def _has_contract(idx: dict[str, list[tuple[int, int, float]]], gsis_id: str, season: int) -> bool:
    contracts = idx.get(gsis_id, [])
    return any(year_signed <= season < year_signed + years for year_signed, years, _ in contracts)


def _season_membership_mask(
    start: pd.DataFrame,
    season: int,
    master: PlayerMaster,
    contract_idx: dict[str, list[tuple[int, int, float]]],
) -> pd.Series:
    """A player belongs in season S only with a real roster stint, a draft slot, or a contract in S.

    `start` (season_start_roster) already restricts to players with *some* roster row that season,
    but nflverse's roster snapshot grew substantially from 2016 (practice-squad/tryout churn is now
    reported alongside the 53-man roster), so a `CUT`/`DEV`/etc-only appearance with no other tie to
    the season (not drafted this season, no contract covering it) is noise rather than a real
    participant — drop it rather than let it inflate the free-agent pool. A `good` status
    (ACT/RES/INA, see `_status_priority`) always counts as a real stint.
    """
    good_status = start["status"].map(_status_priority) == 0
    drafted_this_season = start["gsis_id"].map(
        lambda g: (master.draft_by_gsis.get(g) or {}).get("season") == season
    )
    contracted = start["gsis_id"].map(lambda g: _has_contract(contract_idx, g, season))
    return good_status | drafted_this_season | contracted


def build_season_rosters_and_players(
    season: int, master: PlayerMaster, ratings
) -> tuple[dict, dict]:
    """Build rosters.json and players.json for one season together (they share the roster scan).

    players.json covers every season-start stint that clears `_season_membership_mask`;
    rosters.json is the opening-day 53 per team (see docs/DATA_CONTRACT.md). A player's `team` is
    set after roster selection: the team whose exported roster contains them, else null (free
    agent pool).
    """
    stints = season_roster_stints(season)
    start = season_start_roster(stints)
    contract_idx = _contract_index(master)
    start = start[_season_membership_mask(start, season, master, contract_idx)]
    snaps = _snap_score(season, master)
    depth_ranks = compute_depth_ranks(season, start, master, snaps)

    unmatched_file, unmatched_writer = _unmatched_logger(season)

    players = []
    pos_group_by_id: dict[str, str] = {}
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
        players.append(rec)
        pos_group_by_id[row.gsis_id] = rec["pos"]

    team_rosters = _select_rosters(start, pos_group_by_id, depth_ranks, snaps)
    selected_by_team = {team: set(ids) for team, ids in team_rosters.items()}

    rosters: dict[str, list[dict]] = {}
    player_team: dict[str, str] = {}
    for row in start.itertuples(index=False):
        team = row.team_canon
        selected = selected_by_team.get(team)
        if selected is None or row.gsis_id not in selected:
            continue
        pos_group = pos_group_by_id[row.gsis_id]
        entry: dict = {"playerId": row.gsis_id}
        depth = depth_ranks.get((team, pos_group, row.gsis_id))
        if depth is not None:
            entry["depth"] = depth
        entry.update(_contract_hint(contract_idx, row.gsis_id, season))
        rosters.setdefault(team, []).append(entry)
        player_team[row.gsis_id] = team
    for team in rosters:
        rosters[team].sort(key=lambda e: (e.get("depth", 999), e["playerId"]))
    unmatched_file.close()

    for rec in players:
        rec["team"] = player_team.get(rec["id"])

    rosters_obj = {"attribution": ATTRIBUTION, "season": season, "rosters": rosters}
    players_obj = {"attribution": ATTRIBUTION, "season": season, "players": players}
    validate("seasonRosters", rosters_obj)
    validate("seasonPlayers", players_obj)
    return rosters_obj, players_obj
