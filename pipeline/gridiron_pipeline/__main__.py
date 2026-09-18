"""CLI: `python -m gridiron_pipeline data|validate`."""

from __future__ import annotations

import argparse
import logging
import sys


def _parse_seasons(spec: str) -> list[int]:
    """ "2010-2025" or "2015" or "2015,2018,2021" -> a sorted list of season years."""
    seasons: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            seasons.update(range(int(start), int(end) + 1))
        elif part:
            seasons.add(int(part))
    return sorted(seasons)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gridiron_pipeline")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    data_cmd = sub.add_parser("data", help="download, build, and export app/public/data")
    data_cmd.add_argument("--seasons", default="2010-2025", help='e.g. "2010-2025" or "2015"')
    data_cmd.add_argument(
        "--allow-placeholder-ratings",
        action="store_true",
        help="use depth-order placeholder ratings when ratings-model outputs are missing",
    )

    sub.add_parser("validate", help="validate every file in app/public/data against its schema")

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
    )
    # Build progress is useful at default verbosity too; only third-party libs stay quiet.
    logging.getLogger("gridiron_pipeline").setLevel(logging.INFO)

    if args.command == "data":
        from gridiron_pipeline.export.pipeline import run

        seasons = _parse_seasons(args.seasons)
        sizes = run(seasons, allow_placeholder_ratings=args.allow_placeholder_ratings)
        total = sum(sizes.values())
        print(f"wrote {len(sizes)} files, {total / 1024:.1f} KB gzipped total")
        return 0

    if args.command == "validate":
        from gridiron_pipeline.export.validate_cmd import validate_all

        problems = validate_all()
        if problems:
            for p in problems:
                print(f"FAIL: {p}", file=sys.stderr)
            return 1
        print("all files valid and within budget")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
