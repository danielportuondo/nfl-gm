"""Orchestration for `python -m gridiron_pipeline.model build`.

Writes four artifacts:
  .cache/model/true_values.parquet  — per player-season true value (consumed by the exporter)
  .cache/model/consensus.parquet    — consensus at the start of each season (same)
  app/public/data/curves.json       — aging / slot / outcome / retirement tables
  app/public/data/trajectories.json — the hidden real careers
"""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path
from typing import Any

import pandas as pd

from gridiron_pipeline import DATA_OUT_DIR
from gridiron_pipeline.model.consensus import build_consensus
from gridiron_pipeline.model.curves import build_curves
from gridiron_pipeline.model.data import MODEL_CACHE_DIR
from gridiron_pipeline.model.trajectories import build_trajectories
from gridiron_pipeline.model.truevalue import season_features, true_value_table
from gridiron_pipeline.schemas import validate

ATTRIBUTION = (
    "Data courtesy of nflverse (CC BY 4.0). Unofficial fan-made project; "
    "not affiliated with the NFL."
)

# Consensus for the first playable season needs the season before it: a veteran's ovr is last
# completed season's true value, and there is no such thing on the first row of the table.
BURN_IN_SEASONS = 2


def write_json(path: Path, payload: dict[str, Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)
    return len(gzip.compress(text.encode()))


def write_parquet(path: Path, frame: pd.DataFrame) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    frame.to_parquet(tmp, index=False)
    os.replace(tmp, path)


def build_model(
    seasons: list[int], out_dir: Path | None = None, cache_dir: Path | None = None
) -> dict[str, Any]:
    out_dir = out_dir or DATA_OUT_DIR
    cache_dir = cache_dir or MODEL_CACHE_DIR
    span = (min(seasons), max(seasons))
    with_burn_in = list(range(span[0] - BURN_IN_SEASONS, span[1] + 1))

    features = pd.concat([season_features(season) for season in with_burn_in]).reset_index()
    all_values = true_value_table(with_burn_in, features)
    values = all_values[all_values["season"].isin(seasons)].reset_index(drop=True)

    curves = build_curves(values, ATTRIBUTION, fit_seasons=span)
    validate("curves", curves)

    consensus = build_consensus(seasons, all_values, curves)

    trajectories = build_trajectories(values, seasons, ATTRIBUTION)
    validate("trajectories", trajectories)

    write_parquet(cache_dir / "true_values.parquet", values)
    write_parquet(cache_dir / "consensus.parquet", consensus)
    curves_gz = write_json(out_dir / "curves.json", curves)
    trajectories_gz = write_json(out_dir / "trajectories.json", trajectories)

    return {
        "seasons": span,
        "playerSeasons": len(values),
        "consensusRows": len(consensus),
        "players": len(trajectories["byPlayer"]),
        "curvesGzipBytes": curves_gz,
        "trajectoriesGzipBytes": trajectories_gz,
    }
