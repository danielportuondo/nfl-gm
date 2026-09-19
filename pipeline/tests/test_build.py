"""Build-layer acceptance tests (docs/HANDOFF.md, data-ingest brief).

These read real nflverse data through the same cache the pipeline uses (pipeline/.cache/raw/),
downloading on first run and then reusing the cache. Scoped to 2014/2015 slices per FIXTURES.
"""

from __future__ import annotations

import pytest

from gridiron_pipeline.build.draft import build_season_draft
from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.positions import map_position_group
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.rosters import (
    _contract_index,
    _has_contract,
    _status_priority,
    build_season_rosters_and_players,
    season_roster_stints,
    season_start_roster,
)
from gridiron_pipeline.build.schedule import build_season_schedule
from gridiron_pipeline.build.teams import canonical_team_id
from gridiron_pipeline.ingest.load import load_games


@pytest.fixture(scope="module")
def master():
    return build_player_master()


@pytest.fixture(scope="module")
def ratings():
    return Ratings(allow_placeholder=True)


def test_team_alias_relocations():
    assert canonical_team_id("STL") == "LAR"
    assert canonical_team_id("SD") == "LAC"
    assert canonical_team_id("OAK") == "LV"
    assert canonical_team_id("WSH") == "WAS"
    assert canonical_team_id("LAR") == "LAR"


def test_position_group_mapping():
    for code in ("T", "G", "C", "OT", "OG"):
        assert map_position_group(code) == "OL"
    for code in ("FS", "SS"):
        assert map_position_group(code) == "S"


def test_2014_draft_order_pick1_and_pick13(master, ratings):
    start = season_start_roster(season_roster_stints(2014))
    draft = build_season_draft(2014, master, ratings, start)
    order = {o["pick"]: o for o in draft["order"]}
    prospects = {p["id"]: p for p in draft["prospects"]}

    assert order[1]["team"] == "HOU"
    assert prospects[order[1]["playerId"]]["name"] == "Jadeveon Clowney"

    assert order[13]["team"] == "LAR"  # STL at the time, canonicalized
    assert prospects[order[13]["playerId"]]["name"] == "Aaron Donald"


def test_2014_malcolm_butler_is_udfa(master, ratings):
    start = season_start_roster(season_roster_stints(2014))
    draft = build_season_draft(2014, master, ratings, start)
    prospects = {p["id"]: p for p in draft["prospects"]}
    butler_ids = [pid for pid, p in prospects.items() if p["name"] == "Malcolm Butler"]
    assert butler_ids, "Malcolm Butler not found in 2014 prospects"
    assert butler_ids[0] in draft["udfa"]
    assert prospects[butler_ids[0]]["draft"] is None


def test_schedule_game_counts_by_era():
    games = load_games()
    sched_2015 = build_season_schedule(2015, games)
    reg_2015 = [g for g in sched_2015["games"] if g["type"] == "REG"]
    assert len(reg_2015) == 256
    assert sched_2015["weeks"] == 17

    sched_2021 = build_season_schedule(2021, games)
    reg_2021 = [g for g in sched_2021["games"] if g["type"] == "REG"]
    assert len(reg_2021) == 272
    assert sched_2021["weeks"] == 18


def test_schedule_includes_playoff_games_with_real_scores():
    games = load_games()
    sched = build_season_schedule(2015, games)
    sb = [g for g in sched["games"] if g["type"] == "SB"]
    assert len(sb) == 1
    assert sb[0]["homeScore"] is not None and sb[0]["awayScore"] is not None


def test_rosters_reference_only_known_players(master, ratings):
    rosters_obj, players_obj = build_season_rosters_and_players(2015, master, ratings)
    known = {p["id"] for p in players_obj["players"]}
    for team, entries in rosters_obj["rosters"].items():
        for entry in entries:
            pid = entry["playerId"]
            assert pid in known, f"{team} references unknown player {pid}"


def test_no_headshot_or_logo_columns_leak_into_players(master, ratings):
    _, players_obj = build_season_rosters_and_players(2015, master, ratings)
    dumped = str(players_obj)
    assert "headshot" not in dumped.lower()
    assert "logo" not in dumped.lower()
    assert "wordmark" not in dumped.lower()


@pytest.mark.parametrize("season", [2015, 2021])
def test_opening_day_rosters_are_legal(master, ratings, season):
    """rosters.json is a legal opening-day 53: 46-53 per team, each player at most once
    league-wide, players.json.team consistent with roster membership. See HANDOFF/DATA_CONTRACT
    "rosters.json" semantics.
    """
    rosters_obj, players_obj = build_season_rosters_and_players(season, master, ratings)
    rosters = rosters_obj["rosters"]
    players_by_id = {p["id"]: p for p in players_obj["players"]}

    seen: set[str] = set()
    rostered_team_by_id: dict[str, str] = {}
    for team, entries in rosters.items():
        assert 46 <= len(entries) <= 53, f"{team} has {len(entries)} players"
        for entry in entries:
            pid = entry["playerId"]
            assert pid not in seen, f"{pid} appears on more than one roster"
            seen.add(pid)
            assert pid in players_by_id, f"{team} references unknown player {pid}"
            rostered_team_by_id[pid] = team

    for pid, player in players_by_id.items():
        assert player["team"] == rostered_team_by_id.get(pid)


def test_season_membership_drops_noise_without_stint_draft_or_contract(master, ratings):
    """A player belongs in season S only with a real roster stint (ACT/RES/INA), a draft slot in
    S, or a contract covering S. A CUT/DEV-only blip in the roster source with neither is dropped
    rather than inflating the free-agent pool (docs/DECISIONS.md Phase 4/5 follow-up).
    """
    season = 2016
    start = season_start_roster(season_roster_stints(season))
    contract_idx = _contract_index(master)

    def drafted_this_season(g: str) -> bool:
        return (master.draft_by_gsis.get(g) or {}).get("season") == season

    bad_status = start[start["status"].map(_status_priority) == 1]
    noise = bad_status[
        ~bad_status["gsis_id"].map(drafted_this_season)
        & ~bad_status["gsis_id"].map(lambda g: _has_contract(contract_idx, g, season))
    ]
    assert len(noise) > 0, "2016 fixture assumption: CUT/DEV-only players w/ no draft/contract tie"

    _, players_obj = build_season_rosters_and_players(season, master, ratings)
    kept_ids = {p["id"] for p in players_obj["players"]}
    assert not (set(noise["gsis_id"]) & kept_ids)


def test_season_membership_keeps_contracted_or_drafted_despite_bad_status(master, ratings):
    season = 2016
    start = season_start_roster(season_roster_stints(season))
    contract_idx = _contract_index(master)

    def drafted_this_season(g: str) -> bool:
        return (master.draft_by_gsis.get(g) or {}).get("season") == season

    # Restrict to rows with a resolvable position group: make_player_record independently drops
    # rows missing name/pos/birthYear (see test_no_headshot_or_logo_columns_leak_into_players'
    # sibling behaviour), which is orthogonal to the membership rule under test here.
    has_pos_group = start["position"].map(map_position_group).notna()
    bad_status = start[(start["status"].map(_status_priority) == 1) & has_pos_group]
    tied = bad_status[
        bad_status["gsis_id"].map(drafted_this_season)
        | bad_status["gsis_id"].map(lambda g: _has_contract(contract_idx, g, season))
    ]
    assert len(tied) > 0

    _, players_obj = build_season_rosters_and_players(season, master, ratings)
    kept_ids = {p["id"] for p in players_obj["players"]}
    assert set(tied["gsis_id"]).issubset(kept_ids)


def test_contract_hint_accepts_dollars_and_millions() -> None:
    """The frozen CSV carried APY in dollars, the parquet release in $M; both must land as $M."""
    from gridiron_pipeline.build.rosters import _contract_hint

    idx = {"a": [(2007, 6, 9_666_667.0)], "b": [(2007, 6, 9.666667)]}
    assert _contract_hint(idx, "a", 2010) == {"apy": 9.667, "years": 6}
    assert _contract_hint(idx, "b", 2010) == {"apy": 9.667, "years": 6}
    assert _contract_hint(idx, "b", 2013) == {}


def test_select_rosters_keeps_high_consensus_reserve_over_healthy_backup() -> None:
    """A star on injured reserve (depth 9, no snaps) makes the 53 ahead of a healthy backup."""
    import pandas as pd

    from gridiron_pipeline.build.rosters import ROSTER_TEMPLATE_53, _select_rosters

    rows = []
    # 60 CBs on one team: a 90-ovr RES player buried on the depth chart, plus healthy backups.
    for i in range(60):
        rows.append(
            {
                "team_canon": "DAL",
                "gsis_id": f"cb{i:02d}",
                "status": "RES" if i == 0 else "ACT",
                "years_exp": 3.0,
            }
        )
    start = pd.DataFrame(rows)
    pos_group_by_id = {r["gsis_id"]: "CB" for r in rows}
    depth_ranks = {("DAL", "CB", r["gsis_id"]): (9 if i == 0 else i) for i, r in enumerate(rows)}
    ovr_by_id = {r["gsis_id"]: (90.0 if i == 0 else 60.0 - i * 0.1) for i, r in enumerate(rows)}

    rosters = _select_rosters(start, pos_group_by_id, depth_ranks, {}, ovr_by_id)
    assert "cb00" in rosters["DAL"]
    assert len(rosters["DAL"]) == 53
    assert ROSTER_TEMPLATE_53["CB"] <= 53


def test_resolve_position_uses_fine_label_for_coarse_units() -> None:
    from gridiron_pipeline.build.positions import resolve_position

    assert resolve_position("DB", "FS") == "S"
    assert resolve_position("DB", "SS") == "S"
    assert resolve_position("DB", "CB") == "CB"
    assert resolve_position("DB", None) == "CB"
    assert resolve_position("DB", float("nan")) == "CB"
    assert resolve_position("OL", "C") == "OL"
    assert resolve_position("LB", "ILB") == "LB"
    assert resolve_position("WR", "CB") == "WR"
