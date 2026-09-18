"""Export-layer tests: schema validation, atomic writes, and the size-budget check."""

from __future__ import annotations

import json

import jsonschema
import pytest

from gridiron_pipeline.build.cap import build_cap
from gridiron_pipeline.build.teams import build_teams
from gridiron_pipeline.export.writer import gzipped_size, write_json


def test_build_teams_has_32_canonical_teams_and_validates():
    teams = build_teams()
    assert len(teams["teams"]) == 32
    ids = {t["id"] for t in teams["teams"]}
    assert len(ids) == 32
    relocated = {"STL", "SD", "OAK"}  # canonicalized to LAR/LAC/LV
    assert not (relocated & ids)


def test_build_cap_2010_uncapped_value():
    cap = build_cap([2010, 2015])
    assert cap["bySeason"]["2010"] == 123.0
    assert cap["bySeason"]["2015"] == 143.28
    assert cap["growthAfterData"] == 0.06


def test_cap_beyond_real_data_grows_6pct():
    cap = build_cap([2025, 2026])
    assert cap["bySeason"]["2026"] == round(cap["bySeason"]["2025"] * 1.06, 2)


def test_write_json_rejects_invalid_object(tmp_path):
    bad = {"attribution": "too short"}  # missing required fields, minLength violated
    with pytest.raises(jsonschema.ValidationError):
        write_json("cap", bad, tmp_path / "cap.json")
    assert not (tmp_path / "cap.json").exists()


def test_write_json_is_atomic_and_readable(tmp_path):
    cap = build_cap([2015])
    path = tmp_path / "cap.json"
    size = write_json("cap", cap, path)
    assert path.exists()
    assert not path.with_suffix(".json.tmp").exists()
    assert json.loads(path.read_text()) == cap
    assert size == gzipped_size(cap)
    assert size > 0


def test_write_json_overwrite_is_deterministic(tmp_path):
    cap = build_cap([2015])
    path = tmp_path / "cap.json"
    write_json("cap", cap, path)
    first = path.read_bytes()
    write_json("cap", cap, path)
    second = path.read_bytes()
    assert first == second
