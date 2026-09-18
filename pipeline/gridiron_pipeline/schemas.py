"""Load the JSON Schemas shared with the app.

Single source of truth: app/src/contracts/schemas.ts (regenerate with `pnpm gen:contracts`).
"""

import json
from functools import cache
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from gridiron_pipeline import SCHEMA_DIR


def schema_path(name: str) -> Path:
    return SCHEMA_DIR / f"{name}.schema.json"


@cache
def load_schema(name: str) -> dict[str, Any]:
    with schema_path(name).open() as f:
        return json.load(f)


def validate(name: str, instance: Any) -> None:
    """Raise jsonschema.ValidationError if `instance` does not match schema `name`."""
    Draft202012Validator(load_schema(name)).validate(instance)
