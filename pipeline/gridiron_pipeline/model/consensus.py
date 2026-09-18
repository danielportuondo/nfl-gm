"""Consensus scouting views: what the league believes at the start of a season.

Hard rule: nothing here may read a player's future. A veteran's `ovr` is last completed season's
true value (performance is public). A rookie's grade comes from draft slot, combine numbers, age
and per-player noise seeded from their id. Undrafted players get the UDFA band. No row ever looks
at a season >= the season it is scouting for.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd
from scipy.stats import norm

from gridiron_pipeline.model.curves import interpolate_slot, positive_growth
from gridiron_pipeline.model.data import (
    load_combine,
    load_draft_picks,
    load_players,
    team_games,
)

OVR_MIN, OVR_MAX = 40.0, 99.0

COMBINE_SPAN = 1.2
AGE_SPAN = 0.8
ROOKIE_NOISE_OVR = 1.5
ROOKIE_NOISE_POT = 2.0
UDFA_NOISE = 1.0

PEDIGREE_MAX = 3.0
PEDIGREE_PICK_SCALE = 40.0
PEDIGREE_DECAY_SEASONS = 2.5
YOUTH_CEILING = 1.5

STALE_DRAFT_PENALTY = 2.0

CONFIDENCE_FLOOR = 0.15


def _seeded_uniform(ids: pd.Series, salt: bytes) -> pd.Series:
    """Deterministic uniform(0,1) per player id: the draft board is not a straight line."""

    def draw(key: object) -> float:
        digest = hashlib.blake2b(str(key).encode(), digest_size=8, person=salt).digest()
        return int.from_bytes(digest, "big") / float(1 << 64)

    return pd.Series([draw(key) for key in ids], index=ids.index)


def _seeded_normal(ids: pd.Series, salt: bytes) -> pd.Series:
    uniform = _seeded_uniform(ids, salt).clip(1e-6, 1 - 1e-6)
    return pd.Series(norm.ppf(uniform), index=ids.index).clip(-2.0, 2.0)


def combine_scores() -> pd.Series:
    """Athleticism percentile within position from combine testing, 0-1, NaN when untested."""
    combine = load_combine().dropna(subset=["gsis_id"])
    better_when_lower = ("forty", "cone", "shuttle")
    percentiles: list[pd.Series] = []
    for metric in ("forty", "bench", "vertical", "broad_jump", "cone", "shuttle"):
        if metric not in combine.columns:
            continue
        values = pd.to_numeric(combine[metric], errors="coerce")
        if metric in better_when_lower:
            values = -values
        percentiles.append(values.groupby(combine["pos_group"]).rank(pct=True))
    if not percentiles:
        return pd.Series(dtype=float)
    score = pd.concat(percentiles, axis=1).mean(axis=1)
    score.index = combine["gsis_id"]
    return score.groupby(level=0).mean()


def _draft_age_adjustment(picks: pd.DataFrame) -> pd.Series:
    age = pd.to_numeric(picks["age"], errors="coerce")
    median_by_pos = age.groupby(picks["pos"]).transform("median")
    edge = (median_by_pos - age).fillna(0.0) * 0.5
    return edge.clip(-AGE_SPAN, AGE_SPAN)


def _rookie_views(
    prospects: pd.DataFrame, slot_rows: list[dict[str, float]], athletic: pd.Series
) -> pd.DataFrame:
    ovr, pot, sd = interpolate_slot(slot_rows, prospects["pick"])
    athletic_edge = (
        prospects["gsis_id"].map(athletic).astype(float).fillna(0.5).sub(0.5).mul(2 * COMBINE_SPAN)
    )
    age_edge = _draft_age_adjustment(prospects)
    noise_ovr = _seeded_normal(prospects["gsis_id"], b"ovr") * (ROOKIE_NOISE_OVR / 2.0)
    noise_pot = _seeded_normal(prospects["gsis_id"], b"pot") * (ROOKIE_NOISE_POT / 2.0)

    stale = (prospects["seasons_since_draft"].clip(lower=0) * STALE_DRAFT_PENALTY).fillna(0.0)
    out_ovr = ovr + athletic_edge + noise_ovr - stale
    out_pot = pot + athletic_edge + age_edge + noise_pot - stale
    confidence = 0.25 + 0.15 * np.exp(-prospects["pick"] / 60.0)
    return pd.DataFrame(
        {
            "gsis_id": prospects["gsis_id"].to_numpy(),
            "ovr": out_ovr.clip(OVR_MIN, OVR_MAX).to_numpy(),
            "pot": np.maximum(out_pot, out_ovr).clip(OVR_MIN, OVR_MAX),
            "confidence": confidence.clip(CONFIDENCE_FLOOR, 0.95).to_numpy(),
            "sd": sd.to_numpy(),
        }
    )


def _udfa_views(ids: pd.Series, udfa_grade: dict[str, object]) -> pd.DataFrame:
    ovr_mean = float(udfa_grade["ovrMean"])  # type: ignore[arg-type]
    ovr_sd = float(udfa_grade["ovrSd"])  # type: ignore[arg-type]
    quantiles: list[float] = list(udfa_grade["potQuantiles"])  # type: ignore[arg-type]
    levels = np.linspace(0.1, 0.9, len(quantiles))

    ovr = ovr_mean + _seeded_normal(ids, b"udfaovr") * min(ovr_sd, 4.0) * (UDFA_NOISE / 2.0)
    draw = _seeded_uniform(ids, b"udfapot")
    pot = pd.Series(np.interp(draw.to_numpy(), levels, quantiles), index=ids.index)
    return pd.DataFrame(
        {
            "gsis_id": ids.to_numpy(),
            "ovr": ovr.clip(OVR_MIN, OVR_MAX).to_numpy(),
            "pot": np.maximum(pot, ovr).clip(OVR_MIN, OVR_MAX),
            "confidence": (0.15 + 0.08 * draw).to_numpy(),
        }
    )


def _veteran_views(
    history: pd.DataFrame, curves: dict[str, object], picks: pd.Series, ages: pd.Series
) -> pd.DataFrame:
    growth_by_pos = positive_growth(curves["aging"])  # type: ignore[arg-type]
    ovr = history["prev_value"]
    age_next = ages.round().astype(int).clip(lower=21, upper=42)
    growth = pd.Series(
        [
            growth_by_pos.get(pos, {}).get(age, 0.0)
            for pos, age in zip(history["pos"], age_next, strict=True)
        ],
        index=history.index,
    )
    pick = history["gsis_id"].map(picks)
    pedigree = (
        PEDIGREE_MAX
        * np.exp(-pick.fillna(260.0) / PEDIGREE_PICK_SCALE)
        * np.exp(-(history["seasons_played"] - 1).clip(lower=0) / PEDIGREE_DECAY_SEASONS)
    )
    youth = np.where(history["seasons_played"] <= 2, YOUTH_CEILING, 0.0)
    pot = ovr + growth + pedigree + youth

    gap_penalty = 0.10 * (history["season_gap"] - 1).clip(lower=0)
    confidence = (
        0.45
        + 0.09 * history["seasons_played"].clip(upper=6)
        + 0.08 * history["prev_availability"]
        - gap_penalty
    )
    return pd.DataFrame(
        {
            "gsis_id": history["gsis_id"].to_numpy(),
            "ovr": ovr.clip(OVR_MIN, OVR_MAX).to_numpy(),
            "pot": np.maximum(pot, ovr).clip(OVR_MIN, OVR_MAX),
            "confidence": confidence.clip(0.35, 0.95).to_numpy(),
        }
    )


def _prior_history(true_values: pd.DataFrame, season: int) -> pd.DataFrame:
    """Latest completed season on record for every player, as of the start of `season`."""
    past = true_values[true_values["season"] < season]
    if past.empty:
        return pd.DataFrame(
            columns=[
                "gsis_id",
                "pos",
                "prev_value",
                "prev_games",
                "prev_season",
                "seasons_played",
                "season_gap",
                "prev_availability",
            ]
        )
    latest = past.sort_values("season").groupby("gsis_id").tail(1)
    # Experience is public, so confidence must not depend on how far back our own table happens
    # to start: a ten-year veteran in 2010 is as well known as one in 2020.
    rookie_season = latest["gsis_id"].map(load_players().set_index("gsis_id")["rookie_season"])
    from_rookie_year = (season - pd.to_numeric(rookie_season, errors="coerce")).clip(lower=1)
    observed = latest["gsis_id"].map(past.groupby("gsis_id")["season"].nunique())
    seasons_played = pd.concat([from_rookie_year.rename("a"), observed.rename("b")], axis=1).max(
        axis=1
    )
    slots = team_games(season - 1)
    reference_games = float(slots.median()) if len(slots) else 16.0
    return pd.DataFrame(
        {
            "gsis_id": latest["gsis_id"].to_numpy(),
            "pos": latest["pos"].to_numpy(),
            "prev_value": latest["true_value"].to_numpy(),
            "prev_games": latest["games"].to_numpy(),
            "prev_season": latest["season"].to_numpy(),
            "seasons_played": seasons_played.to_numpy(),
            "season_gap": (season - latest["season"]).to_numpy(),
            "prev_availability": (latest["games"] / reference_games).clip(0, 1).to_numpy(),
        }
    )


def season_class(season: int, true_values: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """(drafted prospects of this class, undrafted rookie ids of this class)."""
    draft = load_draft_picks()
    drafted = draft[(draft["season"] == season) & draft["gsis_id"].notna()].copy()
    drafted = drafted.drop_duplicates("gsis_id")

    players = load_players().set_index("gsis_id")
    rostered = true_values[true_values["season"] == season]["gsis_id"]
    rookie_season = rostered.map(players["rookie_season"])
    drafted_ids = set(draft.dropna(subset=["gsis_id"])["gsis_id"])
    undrafted = rostered[(rookie_season == season) & ~rostered.isin(drafted_ids)]
    return drafted, undrafted.drop_duplicates()


def build_consensus(
    seasons: list[int], true_values: pd.DataFrame, curves: dict[str, object]
) -> pd.DataFrame:
    players = load_players().set_index("gsis_id")
    draft = load_draft_picks().dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
    picks = draft.set_index("gsis_id")["pick"]
    draft_seasons = draft.set_index("gsis_id")["season"]
    athletic = combine_scores()
    slot_rows: list[dict[str, float]] = curves["slotGrade"]  # type: ignore[assignment]
    udfa = curves["udfaGrade"]

    frames: list[pd.DataFrame] = []
    for season in seasons:
        history = _prior_history(true_values, season)
        veterans = set(history["gsis_id"])

        rostered = true_values[true_values["season"] == season]
        class_drafted, class_undrafted = season_class(season, true_values)

        needed = pd.Index(rostered["gsis_id"]).union(pd.Index(class_drafted["gsis_id"]))
        needed = needed.union(pd.Index(class_undrafted))

        pos_by_id = pd.concat(
            [
                rostered.drop_duplicates("gsis_id").set_index("gsis_id")["pos"],
                true_values.drop_duplicates("gsis_id").set_index("gsis_id")["pos"],
            ]
        )
        pos_by_id = pos_by_id.groupby(level=0).first()

        veteran_ids = [i for i in needed if i in veterans]
        vet_history = history[history["gsis_id"].isin(veteran_ids)].copy()
        birth = vet_history["gsis_id"].map(players["birth_date"])
        vet_ages = ((pd.Timestamp(f"{season}-09-01") - birth).dt.days / 365.25).fillna(27.0)
        vet_views = _veteran_views(vet_history, curves, picks, vet_ages)

        rookie_ids = [i for i in needed if i not in veterans and i in picks.index]
        rookie_frame = pd.DataFrame({"gsis_id": rookie_ids})
        rookie_frame["pick"] = rookie_frame["gsis_id"].map(picks)
        rookie_frame["pos"] = rookie_frame["gsis_id"].map(pos_by_id).fillna("WR")
        rookie_frame["age"] = rookie_frame["gsis_id"].map(
            draft.set_index("gsis_id")["age"].astype(float)
        )
        rookie_frame["seasons_since_draft"] = (
            season - rookie_frame["gsis_id"].map(draft_seasons)
        ).clip(lower=0)
        rookie_views = _rookie_views(rookie_frame, slot_rows, athletic).drop(columns=["sd"])

        other_ids = pd.Series([i for i in needed if i not in veterans and i not in picks.index])
        udfa_views = (
            _udfa_views(other_ids, udfa)  # type: ignore[arg-type]
            if len(other_ids)
            else pd.DataFrame(columns=["gsis_id", "ovr", "pot", "confidence"])
        )

        season_frame = pd.concat([vet_views, rookie_views, udfa_views], ignore_index=True)
        season_frame["season"] = season
        frames.append(season_frame)

    out = pd.concat(frames, ignore_index=True).drop_duplicates(["gsis_id", "season"])
    out["gsis_id"] = out["gsis_id"].astype("string")
    out["season"] = out["season"].astype("int32")
    for column in ("ovr", "pot", "confidence"):
        out[column] = out[column].astype("float64").round(1 if column != "confidence" else 3)
    return (
        out[["gsis_id", "season", "ovr", "pot", "confidence"]]
        .sort_values(["season", "gsis_id"])
        .reset_index(drop=True)
    )
