"""Acceptance tests for the ratings / consensus / curves model (HANDOFF §6.2).

These run against real nflverse data. The raw downloads are cached under `pipeline/.cache/raw`,
and the model artifacts are built once per session if they are not already on disk.
"""

from __future__ import annotations

import gzip
import json

import pandas as pd
import pytest

from gridiron_pipeline import DATA_OUT_DIR
from gridiron_pipeline.model.build import build_model
from gridiron_pipeline.model.consensus import blended_prior_value, drafted_without_games
from gridiron_pipeline.model.data import (
    MODEL_CACHE_DIR,
    load_contracts,
    load_draft_picks,
    load_players,
)
from gridiron_pipeline.model.names import generate_name_lists, real_full_names
from gridiron_pipeline.model.validate import starter_value_correlations
from gridiron_pipeline.schemas import validate

SEASONS = list(range(2010, 2026))
CORRELATION_SEASONS = list(range(2012, 2024))
MIN_CORRELATION = 0.55
MAX_TRAJECTORIES_GZIP = 3 * 1024 * 1024
MAX_BIG_SWING_SHARE = 0.03
BIG_SWING = 20.0

TRUE_VALUE_COLUMNS = ["gsis_id", "season", "pos", "true_value", "games"]
CONSENSUS_COLUMNS = ["gsis_id", "season", "ovr", "pot", "confidence"]


@pytest.fixture(scope="session")
def artifacts() -> dict[str, object]:
    paths = {
        "true_values": MODEL_CACHE_DIR / "true_values.parquet",
        "consensus": MODEL_CACHE_DIR / "consensus.parquet",
        "curves": DATA_OUT_DIR / "curves.json",
        "trajectories": DATA_OUT_DIR / "trajectories.json",
    }
    if not all(path.exists() for path in paths.values()):
        try:
            build_model(SEASONS)
        except OSError as error:  # pragma: no cover - only when the nflverse fetch fails
            pytest.skip(f"nflverse data unavailable: {error}")
    return {
        "paths": paths,
        "true_values": pd.read_parquet(paths["true_values"]),
        "consensus": pd.read_parquet(paths["consensus"]),
        "curves": json.loads(paths["curves"].read_text()),
        "trajectories": json.loads(paths["trajectories"].read_text()),
    }


@pytest.fixture(scope="session")
def names_by_id() -> pd.Series:
    players = load_players()
    return players.set_index("gsis_id")["display_name"]


def _top(values: pd.DataFrame, names: pd.Series, season: int, pos: str, n: int) -> set[str]:
    rows = values[(values["season"] == season) & (values["pos"] == pos)]
    best = rows.nlargest(n, "true_value")
    return {str(name) for name in best["gsis_id"].map(names) if isinstance(name, str)}


def _ids_named(names: pd.Series, wanted: str) -> list[str]:
    return [str(i) for i, name in names.items() if name == wanted]


def test_true_value_sanity_lists(artifacts, names_by_id) -> None:
    values = artifacts["true_values"]

    qbs = _top(values, names_by_id, 2015, "QB", 10)
    expected_qbs = {
        "Tom Brady",
        "Aaron Rodgers",
        "Cam Newton",
        "Carson Palmer",
        "Russell Wilson",
        "Ben Roethlisberger",
        "Drew Brees",
    }
    assert expected_qbs <= qbs, f"2015 top-10 QBs missing {sorted(expected_qbs - qbs)}"

    assert "Adrian Peterson" in _top(values, names_by_id, 2012, "RB", 5)

    receivers = _top(values, names_by_id, 2018, "WR", 5)
    expected_wrs = {"DeAndre Hopkins", "Michael Thomas", "Davante Adams"}
    assert expected_wrs <= receivers, f"2018 top-5 WRs missing {sorted(expected_wrs - receivers)}"


def test_starter_value_tracks_point_differential(artifacts) -> None:
    correlations = starter_value_correlations(artifacts["true_values"], CORRELATION_SEASONS)
    weakest = correlations.min()
    assert weakest >= MIN_CORRELATION, (
        f"weakest season r = {weakest:.3f} (median {correlations.median():.3f})"
    )


def test_consensus_never_leaks_the_future(artifacts, names_by_id) -> None:
    consensus = artifacts["consensus"]

    wilson = consensus[
        (consensus["season"] == 2012)
        & consensus["gsis_id"].isin(_ids_named(names_by_id, "Russell Wilson"))
    ]
    assert len(wilson) == 1
    draft = load_draft_picks()
    top_ten = draft[(draft["season"] == 2012) & (draft["pick"] <= 10)]["gsis_id"].dropna()
    top_ten_pot = consensus[
        (consensus["season"] == 2012) & consensus["gsis_id"].isin(set(top_ten))
    ]["pot"]
    assert wilson["pot"].iat[0] < top_ten_pot.median()

    def view(name: str) -> pd.Series:
        rows = consensus[
            (consensus["season"] == 2017) & consensus["gsis_id"].isin(_ids_named(names_by_id, name))
        ]
        assert len(rows) == 1, f"expected one 2017 consensus row for {name}"
        return rows.iloc[0]

    mahomes = view("Patrick Mahomes")
    trubisky = view("Mitchell Trubisky")
    assert mahomes["ovr"] <= trubisky["ovr"]
    assert mahomes["pot"] <= trubisky["pot"]


def test_exports_match_their_schemas(artifacts) -> None:
    validate("curves", artifacts["curves"])
    validate("trajectories", artifacts["trajectories"])
    raw = artifacts["paths"]["trajectories"].read_bytes()
    assert len(gzip.compress(raw)) < MAX_TRAJECTORIES_GZIP


def test_intermediate_tables_have_the_agreed_columns(artifacts) -> None:
    assert list(artifacts["true_values"].columns) == TRUE_VALUE_COLUMNS
    assert list(artifacts["consensus"].columns) == CONSENSUS_COLUMNS

    values = artifacts["true_values"]
    assert values["true_value"].between(40, 99).all()
    consensus = artifacts["consensus"]
    assert consensus["ovr"].between(40, 99).all()
    assert consensus["pot"].between(40, 99).all()
    assert (consensus["pot"] >= consensus["ovr"]).all()
    assert consensus["confidence"].between(0, 1).all()
    # Every rostered player-season needs a consensus row; the exporter joins on it.
    rostered = set(zip(values["gsis_id"], values["season"], strict=True))
    scouted = set(zip(consensus["gsis_id"], consensus["season"], strict=True))
    assert not rostered - scouted


def test_generated_names_are_not_real_players() -> None:
    lists = generate_name_lists()
    assert len(lists["first"]) >= 50
    assert len(lists["last"]) >= 50
    taken = real_full_names()
    collisions = [
        f"{first} {last}"
        for first in lists["first"]
        for last in lists["last"]
        if f"{first.lower()} {last.lower()}" in taken
    ]
    assert not collisions, f"generated names collide with real players: {collisions[:5]}"


def test_aging_curves_have_the_expected_shape(artifacts) -> None:
    aging = {row["pos"]: row["byAge"] for row in artifacts["curves"]["aging"]}
    # Running backs fall off a cliff; quarterbacks hold their value much longer.
    assert aging["RB"]["30"] < aging["QB"]["30"]
    # Everyone improves early and declines late.
    for pos in ("RB", "WR", "TE", "DL", "LB", "CB", "S"):
        assert aging[pos]["23"] > aging[pos]["33"], pos


def test_contracts_come_from_the_refreshed_parquet_in_millions() -> None:
    """The csv.gz release froze in May 2022; the parquet carries deals through the current season
    and APY in $M (the CSV was in dollars), which the salary components of the model rely on."""
    contracts = load_contracts()
    assert contracts["year_signed"].max() >= 2024
    assert contracts["apy"].max() < 1_000
    assert 0.3 < contracts["apy"].median() < 5
    assert contracts["gsis_id"].str.startswith("00-").all()


def _consensus_ovr(consensus: pd.DataFrame, names: pd.Series, name: str, season: int) -> float:
    rows = consensus[
        (consensus["season"] == season) & consensus["gsis_id"].isin(_ids_named(names, name))
    ]
    assert len(rows) == 1, f"expected one {season} consensus row for {name}"
    return float(rows["ovr"].iat[0])


def test_blended_prior_value_weights_recent_available_seasons() -> None:
    frame = pd.DataFrame(
        [
            ("blend", 2014, "QB", 70.0, 16),
            ("blend", 2013, "QB", 80.0, 8),
            ("blend", 2012, "QB", 90.0, 16),
            ("blend", 2011, "QB", 99.0, 16),
            ("blend", 2015, "QB", 40.0, 16),
            ("blend", 2016, "QB", 40.0, 16),
            ("missed", 2014, "QB", 41.5, 0),
            ("missed", 2013, "QB", 85.0, 16),
            ("never_played", 2014, "QB", 41.5, 0),
            ("never_played", 2013, "QB", 43.0, 0),
            ("long_gone", 2009, "QB", 66.0, 16),
            ("future_only", 2015, "QB", 90.0, 16),
        ],
        columns=["gsis_id", "season", "pos", "true_value", "games"],
    )
    blended = blended_prior_value(frame, 2015, reference_games=lambda season: 16.0)

    recency_and_availability = (0.6 * 70.0 + 0.3 * 0.5 * 80.0 + 0.1 * 90.0) / (0.6 + 0.15 + 0.1)
    assert blended["blend"] == pytest.approx(recency_and_availability)
    assert blended["missed"] == pytest.approx(85.0)
    assert blended["never_played"] == pytest.approx(41.5)
    assert blended["long_gone"] == pytest.approx(66.0)
    assert "future_only" not in blended.index


def test_drafted_without_games_flags_only_unplayed_draft_picks() -> None:
    frame = pd.DataFrame(
        [
            ("redshirt", 2013, "QB", 41.5, 0),
            ("redshirt", 2014, "QB", 41.2, 0),
            ("one_game", 2013, "WR", 44.0, 1),
            ("one_game", 2014, "WR", 41.0, 0),
            ("undrafted_bench", 2014, "LB", 41.0, 0),
            ("breaks_out_later", 2014, "RB", 41.0, 0),
            ("breaks_out_later", 2015, "RB", 80.0, 16),
            ("breaks_out_later", 2016, "RB", 82.0, 16),
        ],
        columns=["gsis_id", "season", "pos", "true_value", "games"],
    )
    drafted = {"redshirt", "one_game", "breaks_out_later"}

    assert drafted_without_games(frame, 2015, drafted) == {"redshirt", "breaks_out_later"}
    assert drafted_without_games(frame, 2016, drafted) == {"redshirt"}


def test_unplayed_draft_picks_keep_their_draft_grade(artifacts, names_by_id) -> None:
    consensus = artifacts["consensus"]
    draft = load_draft_picks().dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
    picks = draft.set_index("gsis_id")["pick"]

    sat_out_their_first_years = (
        ("J.J. McCarthy", 2025),
        ("Travis Etienne", 2022),
        ("Jonah Williams", 2020),
    )
    for name, season in sat_out_their_first_years:
        drafted_ids = [i for i in _ids_named(names_by_id, name) if i in picks.index]
        rows = consensus[(consensus["season"] == season) & consensus["gsis_id"].isin(drafted_ids)]
        assert len(rows) == 1, f"expected one {season} consensus row for drafted {name}"
        assert rows["ovr"].iat[0] >= 60, f"{name} {season} ovr {rows['ovr'].iat[0]}"

    scouted = consensus.assign(
        pick=consensus["gsis_id"].map(picks),
        draft_season=consensus["gsis_id"].map(draft.set_index("gsis_id")["season"]),
    )
    early_picks_after_rookie_year = scouted[
        (scouted["pick"] <= 64) & (scouted["draft_season"] < scouted["season"])
    ]
    history = early_picks_after_rookie_year[["gsis_id", "season"]].merge(
        artifacts["true_values"][["gsis_id", "season", "games"]],
        on="gsis_id",
        suffixes=("", "_past"),
    )
    games_before = (
        history[history["season_past"] < history["season"]]
        .groupby(["gsis_id", "season"])["games"]
        .sum()
    )
    unplayed = early_picks_after_rookie_year.merge(
        games_before[games_before == 0].rename("games_before").reset_index(),
        on=["gsis_id", "season"],
    )
    assert len(unplayed) >= 20
    assert (unplayed["ovr"] >= 50).all(), unplayed.nsmallest(5, "ovr")


def test_veteran_consensus_survives_one_bad_or_missed_season(artifacts, names_by_id) -> None:
    consensus = artifacts["consensus"]
    assert 75 <= _consensus_ovr(consensus, names_by_id, "Cam Newton", 2017) <= 85
    assert _consensus_ovr(consensus, names_by_id, "Andrew Luck", 2018) >= 75
    assert _consensus_ovr(consensus, names_by_id, "Deshaun Watson", 2022) >= 75


def test_veteran_consensus_rarely_swings_twenty_points(artifacts) -> None:
    consensus = artifacts["consensus"][["gsis_id", "season", "ovr"]]
    on_roster = artifacts["true_values"][["gsis_id", "season"]]
    # On a roster in both N-1 and N-2: both years' views come from performance, not the draft.
    veteran_both_years = on_roster.assign(season=on_roster["season"] + 1).merge(
        on_roster.assign(season=on_roster["season"] + 2), on=["gsis_id", "season"]
    )
    last_year = consensus.assign(season=consensus["season"] + 1).rename(columns={"ovr": "prev"})
    pairs = consensus.merge(veteran_both_years, on=["gsis_id", "season"]).merge(
        last_year, on=["gsis_id", "season"]
    )
    swing = (pairs["ovr"] - pairs["prev"]).abs()
    share = float((swing >= BIG_SWING).mean())
    assert share < MAX_BIG_SWING_SHARE, f"{share:.1%} of {len(pairs)} veterans swing >= 20"


def test_trajectories_carry_availability_parallel_to_values(artifacts, names_by_id) -> None:
    by_player = artifacts["trajectories"]["byPlayer"]
    for entry in by_player.values():
        assert len(entry["avail"]) == len(entry["values"])
        pairs = zip(entry["avail"], entry["values"], strict=True)
        assert all((a is None) == (v is None) for a, v in pairs)

    (luck,) = [by_player[i] for i in _ids_named(names_by_id, "Andrew Luck") if i in by_player]
    missed_2017 = 2017 - luck["start"]
    assert luck["avail"][missed_2017] == 0
    assert luck["avail"][missed_2017 - 1] > 0.9


def test_retirement_year_is_the_last_season_a_game_was_played() -> None:
    """A zero-game final roster row (preseason cut, August retirement) is not a season of career."""
    from gridiron_pipeline.model.trajectories import build_trajectories

    rows = pd.DataFrame(
        {
            "gsis_id": ["vet", "vet", "vet", "rookie", "star"],
            "season": [2014, 2015, 2016, 2016, 2025],
            "pos": ["WR"] * 5,
            "true_value": [70.0, 71.0, 41.0, 41.0, 41.0],
            "games": [16, 16, 0, 0, 0],
        }
    )
    by_player = build_trajectories(rows, list(range(2010, 2026)), "x")["byPlayer"]
    assert by_player["vet"]["retiresAfter"] == 2015
    assert by_player["vet"]["values"] == [70.0, 71.0]
    assert by_player["rookie"]["retiresAfter"] == 2016  # never played: first row stays covered
    assert by_player["star"]["retiresAfter"] is None  # the data's last season has no future yet


def test_boldin_retired_before_the_2017_season(artifacts, names_by_id) -> None:
    by_player = artifacts["trajectories"]["byPlayer"]
    (boldin,) = [by_player[i] for i in _ids_named(names_by_id, "Anquan Boldin") if i in by_player]
    assert boldin["retiresAfter"] == 2016
