"""Validate-then-write JSON exports, atomically, with gzipped size measurement."""

from __future__ import annotations

import gzip
import json
import logging
import os
from pathlib import Path
from typing import Any

from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)


def gzipped_size(obj: Any) -> int:
    payload = json.dumps(obj, separators=(",", ":"), sort_keys=True).encode()
    return len(gzip.compress(payload, compresslevel=9))


def gzipped_file_size(path: Path) -> int:
    """Gzipped size of a file already on disk (ratings-model writes its own JSON directly)."""
    return len(gzip.compress(path.read_bytes(), compresslevel=9))


def write_json(schema_name: str, obj: dict, path: Path) -> int:
    """Validate `obj` against `schema_name`, then write atomically. Returns gzipped byte size."""
    validate(schema_name, obj)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(obj, f, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)
    size = gzipped_size(obj)
    log.info("wrote %s (%.1f KB gzipped)", path, size / 1024)
    return size
