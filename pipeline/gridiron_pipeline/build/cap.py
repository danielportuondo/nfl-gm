"""Salary cap by season, $M (docs/HANDOFF.md §4, hardcoded — not derivable from a free source)."""

from __future__ import annotations

from gridiron_pipeline.build.teams import ATTRIBUTION
from gridiron_pipeline.schemas import validate

CAP_BY_SEASON: dict[int, float] = {
    2010: 123.0,  # uncapped year; used for game purposes per HANDOFF
    2011: 120.375,
    2012: 120.6,
    2013: 123.0,
    2014: 133.0,
    2015: 143.28,
    2016: 155.27,
    2017: 167.0,
    2018: 177.2,
    2019: 188.2,
    2020: 198.2,
    2021: 182.5,
    2022: 208.2,
    2023: 224.8,
    2024: 255.4,
    2025: 279.2,
}

GROWTH_AFTER_DATA = 0.06


def build_cap(seasons: list[int]) -> dict:
    by_season = {}
    for season in seasons:
        if season in CAP_BY_SEASON:
            by_season[str(season)] = CAP_BY_SEASON[season]
        else:
            # Beyond real data: grow from the last known real season.
            last_real = max(CAP_BY_SEASON)
            years_out = season - last_real
            by_season[str(season)] = round(
                CAP_BY_SEASON[last_real] * (1 + GROWTH_AFTER_DATA) ** years_out, 2
            )
    obj = {"attribution": ATTRIBUTION, "bySeason": by_season, "growthAfterData": GROWTH_AFTER_DATA}
    validate("cap", obj)
    return obj
