import pytest
from jsonschema import Draft202012Validator, ValidationError

from gridiron_pipeline import SCHEMA_DIR
from gridiron_pipeline.schemas import load_schema, validate

ATTRIBUTION = (
    "Data courtesy of nflverse (CC BY 4.0). "
    "Unofficial fan-made project; not affiliated with the NFL."
)

EXPECTED = {
    "manifest",
    "teams",
    "cap",
    "curves",
    "injuryModel",
    "seasonPlayers",
    "seasonRosters",
    "seasonDraft",
    "seasonSchedule",
    "trajectories",
    "savedLeague",
}


def test_all_contract_schemas_present_and_valid():
    found = {p.name.removesuffix(".schema.json") for p in SCHEMA_DIR.glob("*.schema.json")}
    assert EXPECTED <= found, f"missing schemas: {EXPECTED - found}"
    for name in found:
        Draft202012Validator.check_schema(load_schema(name))


def test_cap_schema_accepts_spec_table():
    cap = {
        "attribution": ATTRIBUTION,
        "bySeason": {"2015": 143.28, "2016": 155.27},
        "growthAfterData": 0.06,
    }
    validate("cap", cap)


def test_manifest_schema_rejects_missing_attribution():
    with pytest.raises(ValidationError):
        validate("manifest", {"schemaVersion": 1, "seasons": [2015]})
