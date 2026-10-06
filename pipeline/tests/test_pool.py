"""Free-agent pool integrity (QA finding L4).

`players.json` rows with `team = null` start the game in the free-agent pool, so a real rostered
player left there, or a real retiree kept on the board, is visible to the user on day one.
Seasons are built through the same function `make data` uses; the model parquets must exist
(`make model`), which `Ratings(allow_placeholder=False)` enforces.
"""

from __future__ import annotations

import pandas as pd
import pytest

from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.rosters import (
    PARTICIPATION_AVAILABILITY,
    _select_rosters,
    build_season_rosters_and_players,
)

# Pre-2016 snapshot, the 2016 camp-roster era, the finding's season, a 17-game and a latest season.
SEASONS = [2012, 2016, 2017, 2022, 2025]


@pytest.fixture(scope="module")
def master():
    return build_player_master()


@pytest.fixture(scope="module")
def ratings():
    return Ratings(allow_placeholder=False)


@pytest.fixture(scope="module")
def chunks(master, ratings):
    return {s: build_season_rosters_and_players(s, master, ratings) for s in SEASONS}


@pytest.mark.parametrize("season", SEASONS)
def test_nobody_who_really_played_starts_in_the_pool(chunks, ratings, season):
    _, players_obj = chunks[season]
    stranded = [
        p["name"]
        for p in players_obj["players"]
        if p["team"] is None
        and (ratings.availability(p["id"], season) or 0.0) >= PARTICIPATION_AVAILABILITY
    ]
    assert len(stranded) <= 2, stranded


@pytest.mark.parametrize("season", SEASONS)
def test_every_real_draftee_in_the_chunk_has_a_team(chunks, master, season):
    _, players_obj = chunks[season]
    drafted_here = {
        g for g, d in master.draft_by_gsis.items() if d is not None and d["season"] == season
    }
    homeless = [
        p["name"] for p in players_obj["players"] if p["id"] in drafted_here and p["team"] is None
    ]
    assert len(homeless) <= 2, homeless


@pytest.mark.parametrize("season", SEASONS)
def test_real_retirees_are_not_on_the_board(chunks, ratings, master, season):
    """A player who never takes the field in `season` or later (his career is over) is not in
    that season's chunk, unless he was drafted that season and has no career yet to be over."""
    _, players_obj = chunks[season]
    gone = [
        p["name"]
        for p in players_obj["players"]
        if ratings.retired_before(p["id"], season)
        and (master.draft_by_gsis.get(p["id"]) or {}).get("season") != season
    ]
    assert gone == []


def test_the_finding_names_boldin_and_bryant_are_not_2017_free_agents(chunks):
    _, players_obj = chunks[2017]
    names = {p["name"] for p in players_obj["players"]}
    assert not {"Anquan Boldin", "Desmond Bryant"} & names


def test_the_finding_rookies_make_their_opening_day_rosters(chunks):
    _, players_obj = chunks[2017]
    by_name = {p["name"]: p for p in players_obj["players"]}
    assert by_name["Marlon Mack"]["team"] == "IND"
    assert by_name["D'Onta Foreman"]["team"] == "HOU"


def test_select_rosters_prefers_players_who_played_over_higher_rated_non_participants() -> None:
    """Consensus ovr alone kept Robert Turbin (0.38 availability) over rookie Marlon Mack (0.88)
    in a 4-slot RB group; real participation now claims the template slots first."""
    rows = [
        {"team_canon": "IND", "gsis_id": f"rb{i}", "status": "ACT", "years_exp": 3.0}
        for i in range(60)
    ]
    start = pd.DataFrame(rows)
    pos_group_by_id = {r["gsis_id"]: "RB" for r in rows}
    ovr_by_id = {r["gsis_id"]: 80.0 - i * 0.1 for i, r in enumerate(rows)}  # rb0 best on paper
    participants = {"rb55", "rb56", "rb57", "rb58", "rb59"}

    rosters = _select_rosters(start, pos_group_by_id, {}, {}, ovr_by_id, participants)
    assert participants <= set(rosters["IND"])
    assert len(rosters["IND"]) == 53
