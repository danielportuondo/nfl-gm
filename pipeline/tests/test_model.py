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
from gridiron_pipeline.model.data import MODEL_CACHE_DIR, load_players
from gridiron_pipeline.model.names import generate_name_lists, real_full_names
from gridiron_pipeline.model.validate import starter_value_correlations
from gridiron_pipeline.schemas import validate

SEASONS = list(range(2010, 2026))
CORRELATION_SEASONS = list(range(2012, 2024))
MIN_CORRELATION = 0.55
MAX_TRAJECTORIES_GZIP = 3 * 1024 * 1024

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
    from gridiron_pipeline.model.data import load_draft_picks

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
