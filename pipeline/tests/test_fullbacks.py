"""Fullback tagging (QA M4): FBs keep `pos: RB` and carry `role: 'FB'` in nflverse's FB seasons.

nflverse labels FBs on roster `position` through 2015 and on `depth_chart_position` from 2016, and
misses some (Juszczyk 2018 and Ingold 2019 read RB/RB there), so the depth chart counts too.
"""

from __future__ import annotations

import pytest

from gridiron_pipeline.build.fullbacks import season_fullback_ids, tag_fullback
from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.rosters import (
    build_season_rosters_and_players,
    season_roster_stints,
    season_start_roster,
)


def _names(season: int) -> tuple[set[str], set[str]]:
    start = season_start_roster(season_roster_stints(season))
    ids = season_fullback_ids(season, start)
    return set(start.loc[start["gsis_id"].isin(ids), "full_name"]), set(start["full_name"])


def test_known_fullbacks_are_tagged_in_the_right_seasons():
    expected = {
        "Kyle Juszczyk": range(2013, 2026),
        "Patrick Ricard": range(2019, 2026),
        "Alec Ingold": range(2019, 2026),
        "Michael Burton": range(2015, 2026),
    }
    for season in sorted({s for years in expected.values() for s in years}):
        tagged, _ = _names(season)
        for name, years in expected.items():
            if season in years:
                assert name in tagged, f"{name} {season}"


def test_running_backs_are_not_tagged_as_fullbacks():
    running_backs = {
        2018: ["Alvin Kamara", "Saquon Barkley", "Matt Breida", "Jerick McKinnon"],
        2013: ["Adrian Peterson", "Marshawn Lynch"],
        2022: ["Derrick Henry", "Austin Ekeler"],
    }
    for season, names in running_backs.items():
        tagged, everyone = _names(season)
        for name in names:
            assert name in everyone, f"{name} {season} missing from the roster file"
            assert name not in tagged, f"{name} {season}"


def test_exported_fullback_keeps_rb_pos_and_gets_role():
    players = build_season_rosters_and_players(
        2018, build_player_master(), Ratings(allow_placeholder=True)
    )[1]["players"]
    by_name = {p["name"]: p for p in players}
    assert (by_name["Kyle Juszczyk"]["pos"], by_name["Kyle Juszczyk"]["role"]) == ("RB", "FB")
    assert "role" not in by_name["Alvin Kamara"]
    assert all(p["pos"] == "RB" for p in players if p.get("role") == "FB")
    assert 15 <= sum(p.get("role") == "FB" for p in players) <= 45


@pytest.mark.parametrize(("pos", "tagged"), [("RB", True), ("TE", False), ("DL", False)])
def test_tag_requires_rb_group(pos: str, tagged: bool):
    record = {"id": "x", "pos": pos}
    tag_fullback(record, {"x"})
    assert ("role" in record) is tagged
