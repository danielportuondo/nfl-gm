"""Gridiron GM data pipeline. Data courtesy of nflverse (CC BY 4.0)."""

from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = PIPELINE_ROOT.parent
CACHE_DIR = PIPELINE_ROOT / ".cache"
SCHEMA_DIR = REPO_ROOT / "app" / "src" / "contracts" / "schemas"
DATA_OUT_DIR = REPO_ROOT / "app" / "public" / "data"
