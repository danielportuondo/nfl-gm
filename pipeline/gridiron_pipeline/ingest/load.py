"""Typed pandas loaders over the cached raw nflverse CSVs."""

from __future__ import annotations

import logging

import pandas as pd
import requests

from gridiron_pipeline.ingest import sources
from gridiron_pipeline.ingest.download import cached_download

log = logging.getLogger(__name__)


def _read_csv(url: str, **kwargs) -> pd.DataFrame:
    path = cached_download(url)
    return pd.read_csv(path, low_memory=False, **kwargs)


def _read_csv_optional(url: str, **kwargs) -> pd.DataFrame | None:
    """Like `_read_csv`, but returns None (and logs) on a 404 instead of raising.

    Some season-specific releases (e.g. snap counts before 2012) legitimately do not exist.
    """
    try:
        return _read_csv(url, **kwargs)
    except requests.HTTPError as exc:
        log.warning("optional source unavailable, skipping: %s (%s)", url, exc)
        return None


def load_players() -> pd.DataFrame:
    return _read_csv(sources.players_url())


def load_draft_picks() -> pd.DataFrame:
    return _read_csv(sources.draft_picks_url())


def load_teams_colors() -> pd.DataFrame:
    return _read_csv(sources.teams_colors_url())


def load_games() -> pd.DataFrame:
    return _read_csv(sources.games_url())


def load_combine() -> pd.DataFrame:
    return _read_csv(sources.combine_url())


def load_contracts() -> pd.DataFrame:
    return _read_csv(sources.contracts_url(), compression="gzip")


def load_roster(season: int) -> pd.DataFrame:
    return _read_csv(sources.roster_url(season))


def load_snap_counts(season: int) -> pd.DataFrame | None:
    if season < sources.FIRST_SNAP_COUNTS_SEASON:
        return None
    return _read_csv_optional(sources.snap_counts_url(season))


def load_depth_charts(season: int) -> pd.DataFrame | None:
    if season < sources.FIRST_DEPTH_CHARTS_SEASON:
        return None
    return _read_csv_optional(sources.depth_charts_url(season))


def load_injuries(season: int) -> pd.DataFrame | None:
    if season < sources.FIRST_INJURIES_SEASON:
        return None
    return _read_csv_optional(sources.injuries_url(season))
