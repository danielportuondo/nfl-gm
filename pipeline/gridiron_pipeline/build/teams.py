"""Canonical team identities.

Mirrors app/src/contracts/teams.ts (TEAM_IDS, TEAM_ALIASES, DIVISIONS) — that file is the
contract; this is a copy for the Python side, per the data-ingest brief. TEAM_ALIASES here is a
superset of the app's: nflverse uses several inconsistent abbreviation conventions across its own
releases (PFR-style codes in draft_picks.csv, alternate 3-letter codes in roster CSVs), and every
one of those must resolve to the same 32 canonical ids the app expects.
"""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.ingest.load import load_teams_colors
from gridiron_pipeline.schemas import validate

log = logging.getLogger(__name__)

TEAM_IDS: tuple[str, ...] = (
    "ARI",
    "ATL",
    "BAL",
    "BUF",
    "CAR",
    "CHI",
    "CIN",
    "CLE",
    "DAL",
    "DEN",
    "DET",
    "GB",
    "HOU",
    "IND",
    "JAX",
    "KC",
    "LAR",
    "LAC",
    "LV",
    "MIA",
    "MIN",
    "NE",
    "NO",
    "NYG",
    "NYJ",
    "PHI",
    "PIT",
    "SEA",
    "SF",
    "TB",
    "TEN",
    "WAS",
)

# Historical nflverse codes -> canonical id. Codes not listed map to themselves.
# Base set mirrors app/src/contracts/teams.ts; the rest are nflverse's alternate spellings
# encountered across roster/draft_picks/games CSVs (logged unmatched codes would show up here).
TEAM_ALIASES: dict[str, str] = {
    # app/src/contracts/teams.ts TEAM_ALIASES (contract, mirrored exactly)
    "STL": "LAR",
    "LA": "LAR",
    "LAR": "LAR",
    "SD": "LAC",
    "LAC": "LAC",
    "OAK": "LV",
    "LV": "LV",
    "WSH": "WAS",
    "WAS": "WAS",
    "JAC": "JAX",
    "JAX": "JAX",
    # nflverse roster_{season}.csv alternate codes
    "ARZ": "ARI",
    "BLT": "BAL",
    "CLV": "CLE",
    "HST": "HOU",
    "SL": "LAR",
    # nflverse draft_picks.csv PFR-style codes (full historical range; only a few appear 2010+)
    "GNB": "GB",
    "KAN": "KC",
    "LVR": "LV",
    "NOR": "NO",
    "NWE": "NE",
    "SDG": "LAC",
    "SFO": "SF",
    "TAM": "TB",
    "PHO": "ARI",
    "RAI": "LV",
    "RAM": "LAR",
}


def canonical_team_id(code: str) -> str | None:
    """Map any nflverse team code to a canonical TeamId, or None (and log) if unknown."""
    upper = str(code).strip().upper()
    mapped = TEAM_ALIASES.get(upper, upper)
    if mapped not in TEAM_IDS:
        log.warning("unknown team code %r, dropping", code)
        return None
    return mapped


DIVISIONS: dict[str, dict[str, str]] = {
    "BUF": {"conf": "AFC", "div": "East"},
    "MIA": {"conf": "AFC", "div": "East"},
    "NE": {"conf": "AFC", "div": "East"},
    "NYJ": {"conf": "AFC", "div": "East"},
    "BAL": {"conf": "AFC", "div": "North"},
    "CIN": {"conf": "AFC", "div": "North"},
    "CLE": {"conf": "AFC", "div": "North"},
    "PIT": {"conf": "AFC", "div": "North"},
    "HOU": {"conf": "AFC", "div": "South"},
    "IND": {"conf": "AFC", "div": "South"},
    "JAX": {"conf": "AFC", "div": "South"},
    "TEN": {"conf": "AFC", "div": "South"},
    "DEN": {"conf": "AFC", "div": "West"},
    "KC": {"conf": "AFC", "div": "West"},
    "LV": {"conf": "AFC", "div": "West"},
    "LAC": {"conf": "AFC", "div": "West"},
    "DAL": {"conf": "NFC", "div": "East"},
    "NYG": {"conf": "NFC", "div": "East"},
    "PHI": {"conf": "NFC", "div": "East"},
    "WAS": {"conf": "NFC", "div": "East"},
    "CHI": {"conf": "NFC", "div": "North"},
    "DET": {"conf": "NFC", "div": "North"},
    "GB": {"conf": "NFC", "div": "North"},
    "MIN": {"conf": "NFC", "div": "North"},
    "ATL": {"conf": "NFC", "div": "South"},
    "CAR": {"conf": "NFC", "div": "South"},
    "NO": {"conf": "NFC", "div": "South"},
    "TB": {"conf": "NFC", "div": "South"},
    "ARI": {"conf": "NFC", "div": "West"},
    "LAR": {"conf": "NFC", "div": "West"},
    "SF": {"conf": "NFC", "div": "West"},
    "SEA": {"conf": "NFC", "div": "West"},
}

ATTRIBUTION = (
    "Data courtesy of nflverse (CC BY 4.0). "
    "Unofficial fan-made project; not affiliated with the NFL."
)

# Eras for franchises whose city/name changed within our 2010-2025 window.
_ERA_OVERRIDES: dict[str, list[dict]] = {
    "LAR": [
        {"from": 1920, "to": 2015, "city": "St. Louis", "name": "Rams", "abbr": "STL"},
        {"from": 2016, "to": None, "city": "Los Angeles", "name": "Rams", "abbr": "LAR"},
    ],
    "LAC": [
        {"from": 1920, "to": 2016, "city": "San Diego", "name": "Chargers", "abbr": "SD"},
        {"from": 2017, "to": None, "city": "Los Angeles", "name": "Chargers", "abbr": "LAC"},
    ],
    "LV": [
        {"from": 1920, "to": 2019, "city": "Oakland", "name": "Raiders", "abbr": "OAK"},
        {"from": 2020, "to": None, "city": "Las Vegas", "name": "Raiders", "abbr": "LV"},
    ],
    "WAS": [
        {"from": 1920, "to": 2019, "city": "Washington", "name": "Redskins", "abbr": "WAS"},
        {"from": 2020, "to": 2021, "city": "Washington", "name": "Football Team", "abbr": "WAS"},
        {"from": 2022, "to": None, "city": "Washington", "name": "Commanders", "abbr": "WAS"},
    ],
}


def _hex(color: object) -> str | None:
    s = str(color).strip()
    if not s.startswith("#") or len(s) != 7:
        return None
    return s.lower()


def build_teams() -> dict:
    """Build teams.json (schema `teams`) from teams_colors_logos.csv, logos/wordmarks dropped."""
    raw = load_teams_colors()
    by_canonical: dict[str, pd.Series] = {}
    aliases_by_canonical: dict[str, set[str]] = {}

    for _, row in raw.iterrows():
        code = row["team_abbr"]
        canon = canonical_team_id(code)
        if canon is None:
            continue
        aliases_by_canonical.setdefault(canon, set()).add(str(code).upper())
        # Prefer the row whose own abbr *is* the canonical id (current identity) for display fields.
        if canon not in by_canonical or code == canon:
            by_canonical[canon] = row

    teams = []
    for team_id in TEAM_IDS:
        row = by_canonical.get(team_id)
        if row is None:
            raise ValueError(f"no teams_colors_logos.csv row resolved to canonical id {team_id}")
        primary = _hex(row["team_color"]) or "#000000"
        secondary = _hex(row["team_color2"]) or "#ffffff"
        tertiary = _hex(row["team_color3"])
        colors = {"primary": primary, "secondary": secondary}
        if tertiary:
            colors["tertiary"] = tertiary
        entry = {
            "id": team_id,
            "city": str(row["team_name"]).rsplit(" ", 1)[0],
            "name": str(row["team_nick"]),
            "abbr": team_id,
            "conf": DIVISIONS[team_id]["conf"],
            "div": DIVISIONS[team_id]["div"],
            "colors": colors,
            "aliases": sorted(aliases_by_canonical.get(team_id, {team_id})),
        }
        if team_id in _ERA_OVERRIDES:
            entry["eras"] = _ERA_OVERRIDES[team_id]
        teams.append(entry)

    obj = {"attribution": ATTRIBUTION, "teams": teams}
    validate("teams", obj)
    return obj
