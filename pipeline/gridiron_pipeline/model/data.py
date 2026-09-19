"""Raw nflverse loaders for the ratings model.

Owns nothing but the shared download cache (``pipeline/.cache/raw/<basename>``): files are
downloaded once, written to a temp path and renamed, so the concurrently running ingest agent and
this module can share the same cache safely.
"""

from __future__ import annotations

import os
from functools import cache
from pathlib import Path

import pandas as pd
import requests

from gridiron_pipeline import CACHE_DIR

RAW_DIR = CACHE_DIR / "raw"
MODEL_CACHE_DIR = CACHE_DIR / "model"

_RELEASES = "https://github.com/nflverse/nflverse-data/releases/download"
_NFLDATA = "https://raw.githubusercontent.com/nflverse/nfldata/master/data"

ROSTER_URL = _RELEASES + "/rosters/roster_{season}.csv"
STATS_WEEK_URL = _RELEASES + "/stats_player/stats_player_week_{season}.csv"
SNAPS_URL = _RELEASES + "/snap_counts/snap_counts_{season}.csv"
DEPTH_URL = _RELEASES + "/depth_charts/depth_charts_{season}.csv"
COMBINE_URL = _RELEASES + "/combine/combine.csv"
DRAFT_URL = _RELEASES + "/draft_picks/draft_picks.csv"
PLAYERS_URL = _RELEASES + "/players/players.csv"
# The csv.gz release froze on 2022-05-29; the parquet is refreshed and carries a direct gsis_id.
CONTRACTS_URL = _RELEASES + "/contracts/historical_contracts.parquet"
GAMES_URL = _NFLDATA + "/games.csv"

SNAPS_FIRST_SEASON = 2012
CONTRACTS_FIRST_SEASON = 2011

# Copied from app/src/contracts/teams.ts (TEAM_ALIASES). Codes not listed map to themselves.
TEAM_ALIASES: dict[str, str] = {
    "STL": "LAR",
    "LA": "LAR",
    "SD": "LAC",
    "OAK": "LV",
    "WSH": "WAS",
    "JAC": "JAX",
}

POSITIONS = ("QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "K", "P")

# Source codes that do not pin down a group on their own: "DB" could be a corner or a safety.
AMBIGUOUS_CODES = frozenset({"DB"})

# nflverse fine-grained position -> contract position group (docs/DATA_CONTRACT.md).
POSITION_GROUP: dict[str, str] = {
    "QB": "QB",
    "RB": "RB",
    "HB": "RB",
    "FB": "RB",
    "WR": "WR",
    "TE": "TE",
    "T": "OL",
    "OT": "OL",
    "G": "OL",
    "OG": "OL",
    "C": "OL",
    "OL": "OL",
    "LS": "OL",
    "DE": "DL",
    "DT": "DL",
    "NT": "DL",
    "DL": "DL",
    "EDGE": "DL",
    "LB": "LB",
    "OLB": "LB",
    "ILB": "LB",
    "MLB": "LB",
    "CB": "CB",
    "DB": "CB",
    "NB": "CB",
    "S": "S",
    "FS": "S",
    "SS": "S",
    "SAF": "S",
    "K": "K",
    "PK": "K",
    "P": "P",
}


def canonical_team(code: object) -> str | None:
    if not isinstance(code, str) or not code:
        return None
    upper = code.upper()
    return TEAM_ALIASES.get(upper, upper)


def position_group(pos: object) -> str | None:
    if not isinstance(pos, str):
        return None
    return POSITION_GROUP.get(pos.strip().upper())


def fetch(url: str) -> Path:
    """Download `url` into the shared raw cache unless it is already there."""
    path = RAW_DIR / url.rsplit("/", 1)[-1]
    if path.exists():
        return path
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".{os.getpid()}.tmp")
    with requests.get(url, stream=True, timeout=180) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
    os.replace(tmp, path)
    return path


def _read(url: str, **kwargs: object) -> pd.DataFrame:
    return pd.read_csv(fetch(url), low_memory=False, **kwargs)  # type: ignore[arg-type]


@cache
def load_players() -> pd.DataFrame:
    df = _read(PLAYERS_URL)
    keep = [
        "gsis_id",
        "display_name",
        "first_name",
        "last_name",
        "pfr_id",
        "otc_id",
        "birth_date",
        "position",
        "position_group",
        "rookie_season",
        "last_season",
        "draft_year",
        "draft_round",
        "draft_pick",
    ]
    df = df[[c for c in keep if c in df.columns]].copy()
    df["birth_date"] = pd.to_datetime(df["birth_date"], errors="coerce")
    return df.drop_duplicates("gsis_id")


@cache
def pfr_to_gsis() -> pd.Series:
    players = load_players()
    x = players.dropna(subset=["pfr_id", "gsis_id"]).drop_duplicates("pfr_id")
    return pd.Series(x["gsis_id"].to_numpy(), index=x["pfr_id"].to_numpy())


@cache
def otc_to_gsis() -> pd.Series:
    players = load_players()
    x = players.dropna(subset=["otc_id", "gsis_id"]).copy()
    x["otc_id"] = pd.to_numeric(x["otc_id"], errors="coerce")
    x = x.dropna(subset=["otc_id"]).drop_duplicates("otc_id")
    return pd.Series(x["gsis_id"].to_numpy(), index=x["otc_id"].astype("int64").to_numpy())


def _specific_group(codes: pd.Series) -> pd.Series:
    """Position group, but only where the source code pins one down."""
    groups = codes.map(position_group).astype("object")
    ambiguous = codes.astype("string").str.upper().isin(AMBIGUOUS_CODES).fillna(False)
    groups[ambiguous] = None
    return groups


@cache
def load_roster(season: int) -> pd.DataFrame:
    df = _read(ROSTER_URL.format(season=season))
    df = df.dropna(subset=["gsis_id"])
    # From 2016 the roster release codes `position` coarsely (every defensive back is "DB"), so the
    # depth-chart slot and the players master are consulted before falling back to it.
    master = df["gsis_id"].map(load_players().set_index("gsis_id")["position"])
    df["pos"] = (
        _specific_group(df["depth_chart_position"])
        .fillna(_specific_group(df["position"]))
        .fillna(_specific_group(master))
        .fillna(df["position"].map(position_group))
    )
    df = df.dropna(subset=["pos"])
    df["team"] = df["team"].map(canonical_team)
    df["season"] = season
    return df


@cache
def load_stats_week(season: int) -> pd.DataFrame:
    df = _read(STATS_WEEK_URL.format(season=season))
    df = df[df["season_type"] == "REG"].copy()
    df = df.rename(columns={"player_id": "gsis_id"})
    df["team"] = df["team"].map(canonical_team)
    df["opponent_team"] = df["opponent_team"].map(canonical_team)
    return df


@cache
def load_snaps(season: int) -> pd.DataFrame:
    if season < SNAPS_FIRST_SEASON:
        return pd.DataFrame(columns=["gsis_id", "week", "offense_pct", "defense_pct", "st_pct"])
    df = _read(SNAPS_URL.format(season=season))
    df = df[df["game_type"] == "REG"].copy()
    df["gsis_id"] = df["pfr_player_id"].map(pfr_to_gsis())
    df = df.dropna(subset=["gsis_id"])
    df["team"] = df["team"].map(canonical_team)
    return df


@cache
def load_depth_charts(season: int) -> pd.DataFrame:
    """Normalized depth charts: gsis_id, week, depth, team.

    nflverse changed this release's schema in 2025 (ESPN snapshots keyed by timestamp instead of
    weekly NFL charts), so both layouts are mapped onto the same three columns.
    """
    df = _read(DEPTH_URL.format(season=season))
    if "pos_rank" in df.columns:
        df = df.dropna(subset=["gsis_id", "pos_rank"]).copy()
        df["week"] = pd.factorize(df["dt"])[0] + 1
        df["depth"] = pd.to_numeric(df["pos_rank"], errors="coerce")
        df["team"] = df["team"].map(canonical_team)
    else:
        df = df[df["game_type"] == "REG"].dropna(subset=["gsis_id"]).copy()
        df["depth"] = pd.to_numeric(df["depth_team"], errors="coerce")
        df["team"] = df["club_code"].map(canonical_team)
    return df[["gsis_id", "week", "depth", "team"]]


@cache
def load_draft_picks() -> pd.DataFrame:
    df = _read(DRAFT_URL)
    df["pos"] = df["position"].map(position_group)
    df["team"] = df["team"].map(canonical_team)
    return df


@cache
def load_combine() -> pd.DataFrame:
    df = _read(COMBINE_URL)
    df["gsis_id"] = df["pfr_id"].map(pfr_to_gsis())
    df["pos_group"] = df["pos"].map(position_group)
    return df


@cache
def load_contracts() -> pd.DataFrame:
    df = pd.read_parquet(fetch(CONTRACTS_URL))
    via_otc = pd.to_numeric(df["otc_id"], errors="coerce").map(otc_to_gsis())
    direct = df["gsis_id"] if "gsis_id" in df.columns else pd.Series(pd.NA, index=df.index)
    df["gsis_id"] = direct.where(direct.notna(), via_otc)
    df = df.dropna(subset=["gsis_id", "year_signed", "years", "apy_cap_pct"])
    # A handful of rows carry the otc_id in the gsis column; they match no player.
    df = df[df["gsis_id"].astype(str).str.startswith("00-")]
    df["year_signed"] = df["year_signed"].astype(int)
    df["years"] = df["years"].clip(lower=1).astype(int)
    # The frozen CSV carried APY in dollars, the parquet carries $M; no salary is under $1,000/yr.
    df["apy"] = df["apy"].where(df["apy"] < 1_000, df["apy"] / 1_000_000)
    return df[["gsis_id", "year_signed", "years", "apy_cap_pct", "apy"]]


@cache
def load_games() -> pd.DataFrame:
    df = _read(GAMES_URL)
    df["home_team"] = df["home_team"].map(canonical_team)
    df["away_team"] = df["away_team"].map(canonical_team)
    return df


def team_games(season: int) -> pd.Series:
    """Regular-season games played per canonical team id."""
    g = load_games()
    g = g[(g["season"] == season) & (g["game_type"] == "REG")]
    played = g.dropna(subset=["home_score", "away_score"])
    counts = pd.concat([played["home_team"], played["away_team"]]).value_counts()
    return counts.astype(int)
