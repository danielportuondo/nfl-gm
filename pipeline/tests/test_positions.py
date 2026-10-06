"""Safety / cornerback resolution (QA finding L6).

From 2016 nflverse labels every defensive back "DB", and draft prospects and UDFAs often carry no
finer label on their first roster row. Defaulting "DB" to CB left the draft classes and UDFA pools
without safeties. These tests run the same build functions `make data` uses over real nflverse data.
"""

from __future__ import annotations

from collections import Counter

import pytest

from gridiron_pipeline.build.draft import build_season_draft
from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.positions import fallback_db_group, resolve_position
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.rosters import (
    build_season_rosters_and_players,
    season_roster_stints,
    season_start_roster,
)

DRAFT_SEASONS = list(range(2012, 2026))
LEAGUE_SEASONS = list(range(2010, 2026))

NAMED_SAFETIES = {
    2018: ["Minkah Fitzpatrick", "Derwin James", "Jessie Bates", "Justin Reid"],
    2019: ["Taylor Rapp", "Juan Thornhill", "Nasir Adderley", "Darnell Savage"],
}


@pytest.fixture(scope="module")
def master():
    return build_player_master()


@pytest.fixture(scope="module")
def ratings():
    return Ratings(allow_placeholder=False)


@pytest.fixture(scope="module")
def drafts(master, ratings):
    out = {}
    for season in DRAFT_SEASONS:
        start = season_start_roster(season_roster_stints(season))
        out[season] = build_season_draft(season, master, ratings, start)
    return out


@pytest.fixture(scope="module")
def league(master, ratings):
    return {s: build_season_rosters_and_players(s, master, ratings)[1] for s in LEAGUE_SEASONS}


def _drafted_positions(draft: dict) -> Counter:
    pos_by_id = {p["id"]: p["pos"] for p in draft["prospects"]}
    return Counter(pos_by_id.get(o["playerId"]) for o in draft["order"])


@pytest.mark.parametrize("season", DRAFT_SEASONS)
def test_every_draft_class_has_a_realistic_number_of_safeties(drafts, season):
    drafted = _drafted_positions(drafts[season])
    safeties, corners = drafted["S"], drafted["CB"]
    # Resolved classes hold 14-27 safeties against 26-37 corners (30-49% of S+CB; real nflverse
    # pick labels give 13-24 S). The bug left 10-21, with the UDFA pools nearly empty.
    assert safeties >= 12, (season, dict(drafted))
    assert 0.28 <= safeties / (safeties + corners) <= 0.52, (season, safeties, corners)


@pytest.mark.parametrize("season", DRAFT_SEASONS)
def test_every_udfa_pool_has_safeties(drafts, season):
    pos_by_id = {p["id"]: p["pos"] for p in drafts[season]["prospects"]}
    pool = Counter(pos_by_id[i] for i in drafts[season]["udfa"])
    # Pools are a few hundred rookies: S:CB should sit near the league ratio, not near zero.
    assert pool["S"] >= 0.45 * pool["CB"], (season, dict(pool))


@pytest.mark.parametrize("season", sorted(NAMED_SAFETIES))
def test_the_finding_named_safeties_are_tagged_s(drafts, season):
    pos_by_name = {p["name"]: p["pos"] for p in drafts[season]["prospects"]}
    wrong = {n: pos_by_name.get(n) for n in NAMED_SAFETIES[season] if pos_by_name.get(n) != "S"}
    assert not wrong, wrong


@pytest.mark.parametrize("season", LEAGUE_SEASONS)
def test_league_wide_safety_to_corner_ratio_is_realistic(league, season):
    counts = Counter(p["pos"] for p in league[season]["players"])
    ratio = counts["S"] / counts["CB"]
    assert 0.6 <= ratio <= 0.9, (season, counts["S"], counts["CB"], round(ratio, 2))


def test_a_bare_db_depth_chart_label_does_not_become_a_corner():
    assert resolve_position("DB", "DB") is None
    assert resolve_position("DB", "FS") == "S"
    assert resolve_position("DB", "SS") == "S"
    assert resolve_position("DB", "CB") == "CB"
    assert resolve_position("CB", None) == "CB"


def test_weight_fallback_keeps_the_league_ratio():
    assert fallback_db_group(weight_lb=215.0) == "S"
    assert fallback_db_group(weight_lb=188.0) == "CB"
    assert fallback_db_group(weight_lb=None) == "CB"
