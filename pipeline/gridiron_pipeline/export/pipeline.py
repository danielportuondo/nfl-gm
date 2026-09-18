"""Orchestrates ingest -> build -> validated export for `make data`."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from gridiron_pipeline import DATA_OUT_DIR
from gridiron_pipeline.build.cap import build_cap
from gridiron_pipeline.build.draft import build_season_draft
from gridiron_pipeline.build.injury import build_injury_model
from gridiron_pipeline.build.players import build_player_master
from gridiron_pipeline.build.ratings import Ratings
from gridiron_pipeline.build.rosters import (
    build_season_rosters_and_players,
    season_roster_stints,
    season_start_roster,
)
from gridiron_pipeline.build.schedule import build_season_schedule
from gridiron_pipeline.build.teams import ATTRIBUTION, build_teams
from gridiron_pipeline.export.writer import write_json
from gridiron_pipeline.ingest.download import download_all
from gridiron_pipeline.ingest.load import load_games
from gridiron_pipeline.ingest.sources import all_urls

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1


def run(seasons: list[int], allow_placeholder_ratings: bool) -> dict[str, int]:
    seasons = sorted(seasons)
    log.info("downloading nflverse sources for seasons %s", seasons)
    download_all(all_urls(seasons))

    sizes: dict[str, int] = {}

    log.info("building player master (gsis_id crosswalk + real draft records)")
    master = build_player_master()
    ratings = Ratings(allow_placeholder_ratings)

    sizes["teams.json"] = write_json("teams", build_teams(), DATA_OUT_DIR / "teams.json")
    sizes["cap.json"] = write_json("cap", build_cap(seasons), DATA_OUT_DIR / "cap.json")
    sizes["injuryModel.json"] = write_json(
        "injuryModel", build_injury_model(seasons), DATA_OUT_DIR / "injuryModel.json"
    )

    games = load_games()
    for season in seasons:
        log.info("season %d: rosters + players", season)
        start = season_start_roster(season_roster_stints(season))
        rosters_obj, players_obj = build_season_rosters_and_players(season, master, ratings)

        log.info("season %d: draft", season)
        draft_obj = build_season_draft(season, master, ratings, start)

        log.info("season %d: schedule", season)
        schedule_obj = build_season_schedule(season, games)

        base = DATA_OUT_DIR / "season" / str(season)
        season_sizes = {
            "players.json": write_json("seasonPlayers", players_obj, base / "players.json"),
            "rosters.json": write_json("seasonRosters", rosters_obj, base / "rosters.json"),
            "draft.json": write_json("seasonDraft", draft_obj, base / "draft.json"),
            "schedule.json": write_json("seasonSchedule", schedule_obj, base / "schedule.json"),
        }
        for name, size in season_sizes.items():
            sizes[f"season/{season}/{name}"] = size
        total = sum(season_sizes.values())
        log.info("season %d total: %.1f KB gzipped", season, total / 1024)
        if total > 1_000_000:
            log.warning("season %d exceeds 1 MB gzipped budget: %d bytes", season, total)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": _stable_generated_at(sizes, seasons),
        "attribution": ATTRIBUTION,
        "seasons": seasons,
        "latestRealSeason": max(seasons),
        "sizesBytes": dict(sizes),
    }
    # manifest.json's own gzipped size is measured after the fact and not included in its own
    # sizesBytes (it would otherwise depend on itself); written last since it summarizes the rest.
    sizes["manifest.json"] = write_json("manifest", manifest, DATA_OUT_DIR / "manifest.json")
    return sizes


def _stable_generated_at(sizes: dict[str, int], seasons: list[int]) -> str:
    """Reuse the previous manifest's timestamp when nothing else changed.

    Keeps `make data` idempotent (byte-identical output on a re-run) despite `generatedAt`
    otherwise being wall-clock time.
    """
    existing_path = DATA_OUT_DIR / "manifest.json"
    if existing_path.exists():
        try:
            existing = json.loads(existing_path.read_text())
        except (OSError, ValueError):
            existing = None
        if (
            existing
            and existing.get("schemaVersion") == SCHEMA_VERSION
            and existing.get("attribution") == ATTRIBUTION
            and existing.get("seasons") == seasons
            and existing.get("latestRealSeason") == max(seasons)
            and existing.get("sizesBytes") == sizes
        ):
            return existing["generatedAt"]
    return datetime.now(UTC).isoformat()
