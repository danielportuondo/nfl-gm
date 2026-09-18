"""`python -m gridiron_pipeline validate`: schema + size-budget check over app/public/data."""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path

from gridiron_pipeline import DATA_OUT_DIR
from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)

STATIC_FILES = {
    "manifest.json": "manifest",
    "teams.json": "teams",
    "cap.json": "cap",
    "curves.json": "curves",  # ratings-model owns this file; validated here if present
    "injuryModel.json": "injuryModel",
    "trajectories.json": "trajectories",  # ratings-model owns this file; validated here if present
}
SEASON_FILES = {
    "players.json": "seasonPlayers",
    "rosters.json": "seasonRosters",
    "draft.json": "seasonDraft",
    "schedule.json": "seasonSchedule",
}
STATIC_BUDGET_BYTES = 1_500_000
SEASON_BUDGET_BYTES = 1_000_000


def _gzipped_size_of_file(path: Path) -> int:
    return len(gzip.compress(path.read_bytes(), compresslevel=9))


def validate_all() -> list[str]:
    """Returns a list of problems; empty means everything validated and fit the budget."""
    problems: list[str] = []
    static_total = 0

    for filename, schema_name in STATIC_FILES.items():
        path = DATA_OUT_DIR / filename
        if not path.exists():
            if filename in ("curves.json", "trajectories.json"):
                log.info("%s not present yet (owned by ratings-model)", filename)
                continue
            problems.append(f"missing required file: {filename}")
            continue
        try:
            obj = json.loads(path.read_text())
            validate(schema_name, obj)
        except Exception as exc:  # noqa: BLE001 - report every failure, don't stop at the first
            problems.append(f"{filename}: {exc}")
            continue
        static_total += _gzipped_size_of_file(path)

    if static_total > STATIC_BUDGET_BYTES:
        problems.append(
            f"static files total {static_total} bytes gzipped > budget {STATIC_BUDGET_BYTES}"
        )

    season_root = DATA_OUT_DIR / "season"
    referenced_players: dict[int, set[str]] = {}
    rostered_ids: dict[int, list[tuple[str, str]]] = {}
    if season_root.exists():
        for season_dir in sorted(season_root.iterdir()):
            if not season_dir.is_dir():
                continue
            season = int(season_dir.name)
            season_total = 0
            for filename, schema_name in SEASON_FILES.items():
                path = season_dir / filename
                if not path.exists():
                    problems.append(f"missing required file: season/{season}/{filename}")
                    continue
                try:
                    obj = json.loads(path.read_text())
                    validate(schema_name, obj)
                except Exception as exc:  # noqa: BLE001
                    problems.append(f"season/{season}/{filename}: {exc}")
                    continue
                season_total += _gzipped_size_of_file(path)
                if filename == "players.json":
                    referenced_players[season] = {p["id"] for p in obj["players"]}
                if filename == "rosters.json":
                    rostered_ids[season] = [
                        (team, entry["playerId"])
                        for team, entries in obj["rosters"].items()
                        for entry in entries
                    ]
            if season_total > SEASON_BUDGET_BYTES:
                problems.append(
                    f"season {season} total {season_total} bytes gzipped "
                    f"> budget {SEASON_BUDGET_BYTES}"
                )

    for season, pairs in rostered_ids.items():
        known = referenced_players.get(season, set())
        for team, player_id in pairs:
            if player_id not in known:
                problems.append(
                    f"season {season}: rosters.json[{team}] references unknown playerId {player_id}"
                )

    return problems
