"""CLI: `uv run python -m gridiron_pipeline.model build --seasons 2010-2025`."""

from __future__ import annotations

import argparse
import json

import pandas as pd

from gridiron_pipeline.model.build import build_model
from gridiron_pipeline.model.data import MODEL_CACHE_DIR
from gridiron_pipeline.model.validate import starter_value_correlations

CORRELATION_SEASONS = range(2012, 2024)


def parse_seasons(text: str) -> list[int]:
    if "-" in text:
        start, end = text.split("-", 1)
        return list(range(int(start), int(end) + 1))
    return [int(part) for part in text.split(",")]


def main() -> None:
    parser = argparse.ArgumentParser(prog="gridiron_pipeline.model")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="fit the ratings model and write its artifacts")
    build.add_argument("--seasons", default="2010-2025", help="e.g. 2010-2025 or 2015,2016")
    build.add_argument(
        "--report", action="store_true", help="also print the point-differential correlations"
    )

    report = subparsers.add_parser("report", help="validate the artifacts already on disk")
    report.add_argument("--seasons", default="2012-2023")

    args = parser.parse_args()
    if args.command == "build":
        summary = build_model(parse_seasons(args.seasons))
        print(json.dumps(summary, indent=2))
        if args.report:
            _print_correlations(list(CORRELATION_SEASONS))
    else:
        _print_correlations(parse_seasons(args.seasons))


def _print_correlations(seasons: list[int]) -> None:
    values = pd.read_parquet(MODEL_CACHE_DIR / "true_values.parquet")
    available = [s for s in seasons if s in set(values["season"])]
    correlations = starter_value_correlations(values, available)
    for season, value in correlations.items():
        print(f"{season} starter-value vs point differential r = {value:.3f}")
    print(f"min {correlations.min():.3f}  median {correlations.median():.3f}")


if __name__ == "__main__":
    main()
