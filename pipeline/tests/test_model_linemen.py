"""Reference linemen: OL and DL true values follow the player's season, not his pay or his unit.

Hand-picked seasons with expected bands (QA 2017 L4, 2018 L4). nflverse has no blocking grades, so
the OL list holds All-Pro seasons the model can see (durable full-time starters with a market price)
and one big contract the season gave back. Reads the same artifacts as `test_model.py`.
"""

from __future__ import annotations

import pandas as pd
import pytest

from gridiron_pipeline.model.build import build_model
from gridiron_pipeline.model.data import MODEL_CACHE_DIR, load_players
from gridiron_pipeline.model.truevalue import market_apy_cap_pct

SEASONS = list(range(2010, 2026))
ELITE = 85.0
STAR = 80.0
STARTER = 75.0
TOP_DL = 3

# (name, season, at least, below); None leaves that side open.
OL_BANDS = [
    ("Joe Thomas", 2015, STAR, None),
    ("Joe Thomas", 2016, STAR, None),
    ("Zack Martin", 2014, STAR, None),
    ("Zack Martin", 2017, STAR, None),
    ("Zack Martin", 2018, STAR, None),
    ("Tyron Smith", 2014, STAR, None),
    ("Trent Williams", 2021, STAR, None),
    ("Trent Williams", 2023, STAR, None),
    ("David Bakhtiari", 2018, STAR, None),
    ("Travis Frederick", 2016, STAR, None),
    ("Quenton Nelson", 2018, STAR, None),
    # Five years and $55.5M, then one of the league's worst left tackles that season.
    ("Matt Kalil", 2017, None, STAR),
]
DL_BANDS = [
    ("Calais Campbell", 2017, ELITE, None),
    ("Cameron Jordan", 2017, ELITE, None),
    ("Khalil Mack", 2016, ELITE, None),
    ("Fletcher Cox", 2018, ELITE, None),
    ("Chris Jones", 2018, ELITE, None),
    ("Ndamukong Suh", 2014, ELITE, None),
    # $17.2M a year on a new five-year deal: 4.5 sacks, then 3.5 in 13 games.
    ("Muhammad Wilkerson", 2016, None, ELITE),
    ("Muhammad Wilkerson", 2017, None, STAR),
    # 11% of the cap for a part-time run stopper in Jacksonville.
    ("Marcell Dareus", 2017, None, STARTER),
    ("Marcell Dareus", 2018, None, STARTER),
]


@pytest.fixture(scope="module")
def linemen() -> pd.DataFrame:
    path = MODEL_CACHE_DIR / "true_values.parquet"
    if not path.exists():
        try:
            build_model(SEASONS)
        except OSError as error:  # pragma: no cover - only when the nflverse fetch fails
            pytest.skip(f"nflverse data unavailable: {error}")
    values = pd.read_parquet(path)
    values = values[values["pos"].isin(["OL", "DL"])].copy()
    values["name"] = values["gsis_id"].map(load_players().set_index("gsis_id")["display_name"])
    values["rank"] = values.groupby(["season", "pos"])["true_value"].rank(
        ascending=False, method="min"
    )
    return values


def _season(values: pd.DataFrame, name: str, season: int, pos: str) -> pd.Series:
    """The named lineman's row; the busier one when two players share the name."""
    rows = values[(values["name"] == name) & (values["season"] == season) & (values["pos"] == pos)]
    assert len(rows), f"no {season} {pos} row for {name}"
    return rows.sort_values("games", ascending=False).iloc[0]


def _in_band(value: float, at_least: float | None, below: float | None) -> bool:
    return (at_least is None or value >= at_least) and (below is None or value < below)


def test_reference_linemen_rate_in_their_bands(linemen) -> None:
    misses = []
    for pos, bands in (("OL", OL_BANDS), ("DL", DL_BANDS)):
        for name, season, at_least, below in bands:
            value = float(_season(linemen, name, season, pos)["true_value"])
            if not _in_band(value, at_least, below):
                misses.append(f"{name} {season} {pos} {value:.1f} not in [{at_least}, {below})")
    assert not misses, "; ".join(misses)


def test_donald_leads_the_line_in_his_player_of_the_year_seasons(linemen) -> None:
    for season in (2017, 2018):
        donald = _season(linemen, "Aaron Donald", season, "DL")
        assert donald["rank"] <= TOP_DL, f"Donald {season} is DL #{donald['rank']:.0f}"
    # 20.5 sacks to Mack's 12.5 (QA 2018 L4 had Mack ahead).
    mack = _season(linemen, "Khalil Mack", 2018, "DL")
    assert _season(linemen, "Aaron Donald", 2018, "DL")["true_value"] > mack["true_value"]


def test_deals_without_ids_still_price_the_player() -> None:
    players = load_players()
    thomas = players[(players["display_name"] == "Joe Thomas") & (players["position"] == "OT")]
    # His 2011 extension (9.6% of the cap) carries no gsis_id or players-table otc_id.
    pay = market_apy_cap_pct(2016, pd.Index(thomas["gsis_id"]))
    assert pay.iat[0] == pytest.approx(0.096)
