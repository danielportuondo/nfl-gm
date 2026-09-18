"""nflverse download URLs and season coverage (docs/HANDOFF.md §4)."""

from __future__ import annotations

RELEASES = "https://github.com/nflverse/nflverse-data/releases/download"
NFLDATA = "https://raw.githubusercontent.com/nflverse/nfldata/master/data"

# Earliest season with a season-specific file, per HANDOFF §4 coverage notes.
FIRST_SNAP_COUNTS_SEASON = 2012
FIRST_DEPTH_CHARTS_SEASON = 2001
FIRST_INJURIES_SEASON = 2009


def roster_url(season: int) -> str:
    return f"{RELEASES}/rosters/roster_{season}.csv"


def draft_picks_url() -> str:
    return f"{RELEASES}/draft_picks/draft_picks.csv"


def snap_counts_url(season: int) -> str:
    return f"{RELEASES}/snap_counts/snap_counts_{season}.csv"


def depth_charts_url(season: int) -> str:
    return f"{RELEASES}/depth_charts/depth_charts_{season}.csv"


def injuries_url(season: int) -> str:
    return f"{RELEASES}/injuries/injuries_{season}.csv"


def combine_url() -> str:
    return f"{RELEASES}/combine/combine.csv"


def contracts_url() -> str:
    # `historical_contracts.csv.gz` is frozen (last updated 2022-05-29 on nflverse-data); the
    # parquet asset under the same release tag is the one OTC/nflverse keeps current (rebuilt
    # daily, contracts through the in-progress season) and also carries a direct gsis_id column.
    return f"{RELEASES}/contracts/historical_contracts.parquet"


def players_url() -> str:
    return f"{RELEASES}/players/players.csv"


def games_url() -> str:
    return f"{NFLDATA}/games.csv"


def trades_url() -> str:
    return f"{NFLDATA}/trades.csv"


def teams_colors_url() -> str:
    return f"{RELEASES}/teams/teams_colors_logos.csv"


def season_urls(season: int) -> list[str]:
    """Every season-specific file for one season (used by `make data SEASONS=YYYY`)."""
    urls = [roster_url(season)]
    if season >= FIRST_SNAP_COUNTS_SEASON:
        urls.append(snap_counts_url(season))
    if season >= FIRST_DEPTH_CHARTS_SEASON:
        urls.append(depth_charts_url(season))
    if season >= FIRST_INJURIES_SEASON:
        urls.append(injuries_url(season))
    return urls


def static_urls() -> list[str]:
    """Files shared across all seasons, downloaded once."""
    return [
        draft_picks_url(),
        combine_url(),
        contracts_url(),
        players_url(),
        games_url(),
        teams_colors_url(),
    ]


def all_urls(seasons: list[int]) -> list[str]:
    urls = static_urls()
    for season in seasons:
        urls.extend(season_urls(season))
    return urls
