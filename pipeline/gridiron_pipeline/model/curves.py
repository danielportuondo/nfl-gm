"""Empirical curves the engine needs: aging, slot grades, pick-bucket outcomes, retirement.

Everything here is fit from the true values built by `truevalue.py`, so the procedural half of the
game inherits the shape of the real half.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd
from scipy.optimize import minimize

from gridiron_pipeline.model.data import POSITIONS, load_draft_picks, load_players
from gridiron_pipeline.model.names import generate_name_lists

AGE_RANGE = range(21, 43)
# fmt: off
SAMPLE_PICKS = (
    1, 2, 3, 4, 5, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 180,
    200, 224, 250,
)
# fmt: on
OUTCOME_BUCKETS: tuple[tuple[str, int, int], ...] = (
    ("1-10", 1, 10),
    ("11-32", 11, 32),
    ("33-64", 33, 64),
    ("65-105", 65, 105),
    ("106-160", 106, 160),
    ("161-260", 161, 260),
    ("UDFA", 0, 0),
)
OUTCOME_YEARS = tuple(range(1, 9))
OUTCOME_QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)
MIN_CELL = 6
BUST_YEAR = 4
OUT_OF_LEAGUE_VALUE = 40.0

SLOT_FIT_CLASSES = (2010, 2020)
AGING_CLIP = 6.0
LOG_PICK_BANDWIDTH = 0.28
LOG_PICK_OFFSET = 4.0
RETIREMENT_CENSOR_YEARS = 2
PRE_PRACTICE_SQUAD_SEASON = 2015


@dataclass(frozen=True)
class ModelFrames:
    """Everything the curve fits read: one row per player-season plus per-player attributes."""

    values: pd.DataFrame  # gsis_id, season, pos, true_value, games, age
    first_season: pd.Series  # gsis_id -> first NFL season (draft class or rookie season)
    draft_pick: pd.Series  # gsis_id -> overall pick, NaN for UDFA
    last_season: int


def player_age(season: int, birth_date: pd.Series) -> pd.Series:
    reference = pd.Timestamp(date(season, 9, 1))
    return ((reference - birth_date).dt.days / 365.25).round(1)


def build_frames(true_values: pd.DataFrame) -> ModelFrames:
    players = load_players().set_index("gsis_id")
    draft = load_draft_picks().dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
    draft = draft.set_index("gsis_id")

    values = true_values.copy()
    birth = values["gsis_id"].map(players["birth_date"])
    ages = pd.Series(np.nan, index=values.index)
    for season, rows in values.groupby("season").groups.items():
        ages.loc[rows] = player_age(int(season), birth.loc[rows]).to_numpy()
    values["age"] = ages

    rookie = values["gsis_id"].map(players["rookie_season"])
    draft_season = values["gsis_id"].map(draft["season"])
    first = draft_season.fillna(rookie)
    observed_first = values.groupby("gsis_id")["season"].min()
    first_by_player = pd.Series(first.to_numpy(), index=values["gsis_id"]).groupby(level=0).min()
    first_by_player = first_by_player.where(first_by_player > 1990).fillna(observed_first)

    return ModelFrames(
        values=values,
        first_season=first_by_player,
        draft_pick=draft["pick"],
        last_season=int(values["season"].max()),
    )


# --------------------------------------------------------------------------------------------
# Aging
# --------------------------------------------------------------------------------------------


def _season_deltas(frames: ModelFrames) -> pd.DataFrame:
    rows = frames.values[["gsis_id", "season", "pos", "true_value", "age", "games"]]
    nxt = rows.copy()
    nxt["season"] = nxt["season"] - 1
    merged = rows.merge(
        nxt, on=["gsis_id", "season"], suffixes=("", "_next"), validate="one_to_one"
    )
    merged["delta"] = merged["true_value_next"] - merged["true_value"]
    merged["age_next"] = merged["age_next"].round().astype("Int64")
    # Survivors only: a player who is out of the league next season is handled by the retirement
    # curve, not by the aging curve.
    return merged[(merged["games"] >= 1) & (merged["games_next"] >= 1)]


def aging_curves(frames: ModelFrames) -> list[dict[str, object]]:
    deltas = _season_deltas(frames)
    out: list[dict[str, object]] = []
    for pos in POSITIONS:
        at_pos = deltas[deltas["pos"] == pos]
        grouped = at_pos.groupby("age_next")["delta"]
        mean = grouped.mean()
        count = grouped.size()
        by_age: dict[str, float] = {}
        for age in AGE_RANGE:
            weight_sum = 0.0
            value_sum = 0.0
            for offset in (-2, -1, 0, 1, 2):
                neighbour = age + offset
                if neighbour not in mean.index:
                    continue
                weight = count.loc[neighbour] * (1.0 / (1.0 + abs(offset)))
                weight_sum += weight
                value_sum += weight * mean.loc[neighbour]
            if weight_sum <= 0:
                by_age[str(age)] = 0.0
                continue
            by_age[str(age)] = float(np.clip(value_sum / weight_sum, -AGING_CLIP, AGING_CLIP))
        sd = float(at_pos["delta"].std())
        out.append(
            {
                "pos": pos,
                "byAge": {k: round(v, 2) for k, v in by_age.items()},
                "sd": round(sd if np.isfinite(sd) else 5.0, 2),
            }
        )
    return out


# --------------------------------------------------------------------------------------------
# Career-year views
# --------------------------------------------------------------------------------------------


def career_years(frames: ModelFrames) -> pd.DataFrame:
    values = frames.values.copy()
    values["first_season"] = values["gsis_id"].map(frames.first_season)
    values["career_year"] = (values["season"] - values["first_season"] + 1).astype("Int64")
    values["pick"] = values["gsis_id"].map(frames.draft_pick)
    return values[values["career_year"] >= 1]


def _kernel_smooth(picks: np.ndarray, target: np.ndarray, at: np.ndarray) -> np.ndarray:
    """Nadaraya-Watson regression on log(pick): smooth, monotone-ish, no extra dependencies."""
    log_pick = np.log(picks)
    log_at = np.log(at)
    weights = np.exp(-0.5 * ((log_at[:, None] - log_pick[None, :]) / LOG_PICK_BANDWIDTH) ** 2)
    totals = weights.sum(axis=1)
    totals[totals == 0] = 1.0
    return (weights @ target) / totals


def _isotonic_decreasing(values: np.ndarray) -> np.ndarray:
    """Pool adjacent violators. Averages violating runs instead of flattening to their minimum."""
    levels = [float(v) for v in values]
    counts = [1.0] * len(levels)
    index = 0
    while index < len(levels) - 1:
        if levels[index] >= levels[index + 1]:
            index += 1
            continue
        total = levels[index] * counts[index] + levels[index + 1] * counts[index + 1]
        weight = counts[index] + counts[index + 1]
        levels[index] = total / weight
        counts[index] = weight
        del levels[index + 1]
        del counts[index + 1]
        if index > 0:
            index -= 1
    return np.repeat(levels, [int(c) for c in counts])


def _log_linear(picks: pd.Series, target: pd.Series, at: np.ndarray) -> np.ndarray:
    """Least-squares fit of value on log(pick + offset), forced to slope downward.

    The offset keeps the fit from over-extrapolating at pick 1, where plain log(pick) has its
    steepest gradient but the thinnest data.
    """
    log_pick = np.log(picks.to_numpy(float) + LOG_PICK_OFFSET)
    design = np.column_stack([np.ones_like(log_pick), log_pick])
    intercept, slope = np.linalg.lstsq(design, target.to_numpy(float), rcond=None)[0]
    slope = min(slope, -0.4)
    return intercept + slope * np.log(at + LOG_PICK_OFFSET)


def slot_grade(frames: ModelFrames) -> list[dict[str, float]]:
    careers = career_years(frames)
    lo, hi = SLOT_FIT_CLASSES
    drafted = careers[
        careers["pick"].notna() & careers["first_season"].between(lo, hi) & (careers["games"] >= 1)
    ]
    year1 = drafted[drafted["career_year"] == 1]
    year3 = drafted[drafted["career_year"] == 3]
    if year1.empty or year3.empty:
        raise RuntimeError("no drafted player-seasons available for the slot-grade fit")

    at = np.array(SAMPLE_PICKS, dtype=float)
    # Log-linear in pick: strictly decreasing, so a top-five pick always grades above a late
    # first-rounder. Kernel smoothing left the top of round one flat, which made the board's
    # ordering there an artifact of noise in a handful of picks.
    ovr = _log_linear(year1["pick"], year1["true_value"], at)
    pot = _log_linear(year3["pick"], year3["true_value"], at)
    spread = _kernel_smooth(
        year3["pick"].to_numpy(float),
        np.abs(year3["true_value"].to_numpy(float) - float(year3["true_value"].mean())),
        at,
    )
    pot = np.maximum(pot, ovr + 1.0)
    return [
        {
            "pick": int(pick),
            "ovr": round(float(np.clip(o, 40, 99)), 1),
            "pot": round(float(np.clip(p, 40, 99)), 1),
            "sd": round(float(max(s * 1.25, 1.5)), 2),
        }
        for pick, o, p, s in zip(SAMPLE_PICKS, ovr, pot, spread, strict=True)
    ]


def udfa_grade(frames: ModelFrames) -> dict[str, object]:
    careers = career_years(frames)
    lo, hi = SLOT_FIT_CLASSES
    # Every undrafted rookie who made a roster, benchwarmers included: the UDFA grade is meant to
    # sit below the last pick of the draft, and conditioning on playing time would lift it above.
    undrafted = careers[careers["pick"].isna() & careers["first_season"].between(lo, hi)]
    year1 = undrafted[undrafted["career_year"] == 1]["true_value"]
    peak = undrafted[undrafted["career_year"] <= 5].groupby("gsis_id")["true_value"].max()
    return {
        "ovrMean": round(float(np.clip(year1.mean(), 40, 99)), 1),
        "ovrSd": round(float(max(year1.std(), 1.0)), 2),
        "potQuantiles": [
            round(float(np.clip(peak.quantile(q), 40, 99)), 1) for q in OUTCOME_QUANTILES
        ],
    }


# --------------------------------------------------------------------------------------------
# Pick bucket -> outcome quantiles
# --------------------------------------------------------------------------------------------


def outcome_cohorts(frames: ModelFrames) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(one row per prospect, one row per observed career season) for the fit classes.

    Drafted prospects come from `draft_picks`, so players who never reached a roster are in the
    denominator. Undrafted prospects are only visible once they make one, so the UDFA bucket is
    implicitly conditioned on getting signed.
    """
    lo, hi = SLOT_FIT_CLASSES
    careers = career_years(frames)

    draft = load_draft_picks().dropna(subset=["gsis_id"]).drop_duplicates("gsis_id")
    draft = draft[draft["season"].between(lo, hi)]
    resolved = careers.drop_duplicates("gsis_id").set_index("gsis_id")["pos"]
    drafted = pd.DataFrame(
        {
            "gsis_id": draft["gsis_id"].to_numpy(),
            "first_season": draft["season"].to_numpy(),
            "pick": draft["pick"].to_numpy(),
            "pos": draft["gsis_id"].map(resolved).fillna(draft["pos"]).to_numpy(),
        }
    ).dropna(subset=["pos"])

    undrafted_ids = careers[careers["pick"].isna() & careers["first_season"].between(lo, hi)]
    undrafted = undrafted_ids.drop_duplicates("gsis_id")[["gsis_id", "first_season", "pos"]].copy()
    undrafted["pick"] = np.nan

    prospects = pd.concat([drafted, undrafted], ignore_index=True).drop_duplicates("gsis_id")
    observed = careers[careers["gsis_id"].isin(prospects["gsis_id"])][
        ["gsis_id", "career_year", "true_value"]
    ]
    return prospects, observed


def _quantile_matrix(
    cohort: pd.DataFrame,
    observed: pd.DataFrame,
    last_season: int,
    fallback: list[list[float]] | None,
) -> list[list[float]]:
    """values[year][quantile]; a prospect with no season that year counts at the floor."""
    matrix: list[list[float]] = []
    for index, year in enumerate(OUTCOME_YEARS):
        eligible = cohort[cohort["first_season"] + year - 1 <= last_season]
        if len(eligible) < MIN_CELL:
            row = list(fallback[index]) if fallback else list(matrix[-1])
            matrix.append([round(v, 1) for v in row])
            continue
        year_values = observed[observed["career_year"] == year].set_index("gsis_id")["true_value"]
        sample = eligible["gsis_id"].map(year_values).fillna(OUT_OF_LEAGUE_VALUE)
        matrix.append(
            [round(float(np.clip(sample.quantile(q), 40, 99)), 1) for q in OUTCOME_QUANTILES]
        )
    return matrix


def _bust_rate(cohort: pd.DataFrame, observed: pd.DataFrame, last_season: int) -> float:
    """P(no NFL season at career year 4+), over classes old enough to have been observed."""
    eligible = cohort[cohort["first_season"] + BUST_YEAR - 1 <= last_season]
    if eligible.empty:
        return 0.5
    longest = observed.groupby("gsis_id")["career_year"].max()
    reached = eligible["gsis_id"].map(longest).fillna(0)
    return round(float((reached < BUST_YEAR).mean()), 3)


def outcome_tables(frames: ModelFrames) -> list[dict[str, object]]:
    prospects, observed = outcome_cohorts(frames)
    rows: list[dict[str, object]] = []
    for label, low, high in OUTCOME_BUCKETS:
        if label == "UDFA":
            cohort = prospects[prospects["pick"].isna()]
        else:
            cohort = prospects[prospects["pick"].between(low, high)]
        if cohort.empty:
            continue
        all_matrix = _quantile_matrix(cohort, observed, frames.last_season, None)
        rows.append(
            {
                "bucket": label,
                "pickMin": low,
                "pickMax": high,
                "pos": "ALL",
                "years": list(OUTCOME_YEARS),
                "quantiles": list(OUTCOME_QUANTILES),
                "values": all_matrix,
                "bustRate": _bust_rate(cohort, observed, frames.last_season),
            }
        )
        for pos in POSITIONS:
            at_pos = cohort[cohort["pos"] == pos]
            if len(at_pos) < MIN_CELL * 3:
                continue
            rows.append(
                {
                    "bucket": label,
                    "pickMin": low,
                    "pickMax": high,
                    "pos": pos,
                    "years": list(OUTCOME_YEARS),
                    "quantiles": list(OUTCOME_QUANTILES),
                    "values": _quantile_matrix(at_pos, observed, frames.last_season, all_matrix),
                    "bustRate": _bust_rate(at_pos, observed, frames.last_season),
                }
            )
    return rows


# --------------------------------------------------------------------------------------------
# Retirement
# --------------------------------------------------------------------------------------------


def _logistic_fit(features: np.ndarray, target: np.ndarray) -> np.ndarray:
    def loss(beta: np.ndarray) -> float:
        z = features @ beta
        log_likelihood = np.sum(target * z - np.logaddexp(0.0, z))
        return -log_likelihood / len(target) + 1e-3 * float(beta[1:] @ beta[1:])

    start = np.zeros(features.shape[1])
    start[0] = -2.0
    result = minimize(loss, start, method="L-BFGS-B")
    return result.x


def retirement_curves(frames: ModelFrames) -> list[dict[str, object]]:
    values = frames.values
    last_by_player = values.groupby("gsis_id")["season"].max()
    horizon = frames.last_season - RETIREMENT_CENSOR_YEARS
    rows = values[(values["season"] <= horizon) & values["age"].notna() & (values["games"] >= 1)]
    retired = (rows["gsis_id"].map(last_by_player) == rows["season"]).astype(float)

    out: list[dict[str, object]] = []
    for pos in POSITIONS:
        mask = (rows["pos"] == pos).to_numpy()
        age = rows.loc[mask, "age"].to_numpy(float)
        value = rows.loc[mask, "true_value"].to_numpy(float)
        target = retired.to_numpy()[mask]
        if len(target) < 200 or target.sum() < 10:
            out.append({"pos": pos, "byAge": _default_retirement(), "valueSlope": -0.08})
            continue
        age_c = (age - 28.0) / 4.0
        value_c = value - float(value.mean())
        design = np.column_stack([np.ones_like(age_c), age_c, age_c**2, value_c])
        beta = _logistic_fit(design, target)
        by_age: dict[str, float] = {}
        for years in AGE_RANGE:
            centered = (years - 28.0) / 4.0
            z = beta[0] + beta[1] * centered + beta[2] * centered**2
            by_age[str(years)] = round(float(np.clip(1.0 / (1.0 + np.exp(-z)), 0.001, 0.98)), 4)
        out.append({"pos": pos, "byAge": by_age, "valueSlope": round(float(beta[3]), 4)})
    return out


def _default_retirement() -> dict[str, float]:
    return {
        str(age): round(float(np.clip(1.0 / (1.0 + np.exp(-(0.32 * (age - 33)))), 0.001, 0.98)), 4)
        for age in AGE_RANGE
    }


# --------------------------------------------------------------------------------------------
# Class shape
# --------------------------------------------------------------------------------------------


def position_mix(frames: ModelFrames, fit_seasons: tuple[int, int]) -> dict[str, float]:
    draft = load_draft_picks()
    lo, hi = fit_seasons
    classes = draft[draft["season"].between(lo, hi)].copy()
    resolved = frames.values.drop_duplicates("gsis_id").set_index("gsis_id")["pos"]
    classes["pos"] = classes["gsis_id"].map(resolved).fillna(classes["pos"])
    shares = classes.dropna(subset=["pos"])["pos"].value_counts(normalize=True)
    mix = {pos: float(shares.get(pos, 0.0)) for pos in POSITIONS}
    total = sum(mix.values()) or 1.0
    return {pos: round(share / total, 4) for pos, share in mix.items()}


def class_size(frames: ModelFrames, fit_seasons: tuple[int, int]) -> dict[str, int]:
    draft = load_draft_picks()
    lo, hi = fit_seasons
    classes = draft[draft["season"].between(lo, hi)]
    drafted = classes.groupby("season").size().mean()

    careers = career_years(frames)
    # The roster release only lists 53-man rosters through 2015; from 2016 it also carries
    # practice-squad designations, which would triple the apparent size of a UDFA class.
    rookies = careers[
        (careers["career_year"] == 1)
        & careers["first_season"].between(lo, min(hi, PRE_PRACTICE_SQUAD_SEASON))
    ]
    undrafted = rookies[rookies["pick"].isna()].groupby("first_season")["gsis_id"].nunique().mean()
    return {"drafted": int(round(drafted)), "udfa": int(round(undrafted))}


# --------------------------------------------------------------------------------------------


def build_curves(
    true_values: pd.DataFrame, attribution: str, fit_seasons: tuple[int, int] | None = None
) -> dict[str, object]:
    frames = build_frames(true_values)
    span = fit_seasons or (int(true_values["season"].min()), int(true_values["season"].max()))
    return {
        "attribution": attribution,
        "fitSeasons": [span[0], span[1]],
        "aging": aging_curves(frames),
        "slotGrade": slot_grade(frames),
        "udfaGrade": udfa_grade(frames),
        "outcomes": outcome_tables(frames),
        "retirement": retirement_curves(frames),
        "positionMix": position_mix(frames, span),
        "classSize": class_size(frames, span),
        "names": generate_name_lists(),
    }


def slot_grade_lookup(
    slot_rows: list[dict[str, float]],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    picks = np.array([row["pick"] for row in slot_rows], dtype=float)
    return (
        picks,
        np.array([row["ovr"] for row in slot_rows], dtype=float),
        np.array([row["pot"] for row in slot_rows], dtype=float),
        np.array([row["sd"] for row in slot_rows], dtype=float),
    )


def interpolate_slot(
    slot_rows: list[dict[str, float]], pick: pd.Series
) -> tuple[pd.Series, pd.Series, pd.Series]:
    picks, ovr, pot, sd = slot_grade_lookup(slot_rows)
    x = pick.clip(lower=picks.min(), upper=picks.max()).to_numpy(float)
    return (
        pd.Series(np.interp(x, picks, ovr), index=pick.index),
        pd.Series(np.interp(x, picks, pot), index=pick.index),
        pd.Series(np.interp(x, picks, sd), index=pick.index),
    )


def positive_growth(aging_rows: list[dict[str, object]]) -> dict[str, dict[int, float]]:
    """Remaining upside by position and age: the sum of future positive aging deltas."""
    out: dict[str, dict[int, float]] = {}
    for row in aging_rows:
        by_age: dict[str, float] = row["byAge"]  # type: ignore[assignment]
        ages = sorted(int(a) for a in by_age)
        remaining: dict[int, float] = {}
        running = 0.0
        for age in reversed(ages):
            remaining[age] = running
            running += max(0.0, by_age[str(age)])
        out[str(row["pos"])] = remaining
    return out
