"""Ratings, value and consensus model.

`truevalue` turns one real season of nflverse data into a position-invariant 40-99 rating for every
player who was on a roster. `consensus` turns the seasons *before* a timeline point into what the
league believed at that point. `curves` fits the empirical tables the engine needs once it runs out
of real data. Data courtesy of nflverse (CC BY 4.0).
"""

from gridiron_pipeline.model.build import build_model

__all__ = ["build_model"]
