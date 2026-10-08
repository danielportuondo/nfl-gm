"""Contract rows with no usable id still reach their player (Joe Thomas's 2011 CLE extension).

The contracts release leaves gsis_id empty on many retired players and the players table has no
otc_id for them, so an id-only match drops the deal and the game synthesizes a salary from the
player's rating instead of the real one.
"""

from __future__ import annotations

import pandas as pd
import pytest

from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.rosters import _contract_hint, _contract_index


@pytest.fixture(scope="module")
def master():
    return build_player_master()


@pytest.fixture(scope="module")
def contract_idx(master):
    return _contract_index(master)


def _gsis(master, name: str, position: str) -> str:
    players = master.players
    hit = players[(players["display_name"] == name) & (players["position"] == position)]
    assert len(hit) == 1, f"{name} ({position}) is ambiguous or missing: {len(hit)}"
    return hit.index[0]


def test_joe_thomas_gets_his_real_extension_in_2016_and_2017(master, contract_idx):
    thomas = _gsis(master, "Joe Thomas", "OT")
    for season in (2016, 2017):
        assert _contract_hint(contract_idx, thomas, season) == {"apy": 11.5, "years": 7}


def test_kyle_long_and_justin_britt_get_their_second_deals(master, contract_idx):
    long = _gsis(master, "Kyle Long", "G")
    britt = _gsis(master, "Justin Britt", "C")
    assert _contract_hint(contract_idx, long, 2018)["apy"] == 10.0
    assert _contract_hint(contract_idx, britt, 2018)["apy"] == 9.0


def test_identity_match_uses_draft_slot_then_birth_date_and_skips_ambiguity() -> None:
    from gridiron_pipeline.build.contract_ids import fill_gsis_by_identity

    players = pd.DataFrame(
        {
            "gsis_id": ["00-1", "00-2", "00-3", "00-4"],
            "display_name": ["Joe Thomas", "Joe Thomas", "Pat Twin", "Pat Twin"],
            "draft_year": [2007, 2011, 2010, 2010],
            "draft_pick": [3, 150, 20, 20],
            "birth_date": ["1984-12-04", "1987-01-01", "1988-05-05", "1988-05-05"],
        }
    )
    contracts = pd.DataFrame(
        {
            "player": ["Joe Thomas", "Joe Thomas", "Pat Twin", "Joe Thomas"],
            "draft_year": [2007, None, 2010, 2007],
            "draft_overall": [3, None, 20, 3],
            "date_of_birth": [None, "1987-01-01", None, None],
            "gsis_id": [None, None, None, "00-9"],
        }
    )
    filled = fill_gsis_by_identity(contracts["gsis_id"], contracts, players)
    assert filled.isna().tolist() == [False, False, True, False]
    assert filled[[0, 1, 3]].tolist() == ["00-1", "00-2", "00-9"]
