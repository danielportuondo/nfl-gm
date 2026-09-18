"""Per player-season true value on the shared, position-invariant 40-99 scale.

Season S's value is season S's real value: components are built from season S only and never
smoothed across seasons. The single exception the spec allows is shrinking the *production*
estimate toward the position mean when a player has a tiny but non-empty sample (<4 games), so an
injured star is not rated on two games. A player with no sample at all is not shrunk — "did not
play" is information, not noise.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm

from gridiron_pipeline.model.data import (
    POSITIONS,
    SNAPS_FIRST_SEASON,
    canonical_team,
    load_contracts,
    load_depth_charts,
    load_roster,
    load_snaps,
    load_stats_week,
    team_games,
)

VALUE_CENTER = 66.0
VALUE_SPREAD = 11.5
VALUE_MIN, VALUE_MAX = 40.0, 99.0

# Players who never took a snap are rated in their own band under everyone who played. The active
# pool is stable at ~2,000-2,300 players a season; the full roster list is not (nflverse started
# including practice-squad designations in 2016), so normalizing over the active pool keeps the
# scale comparable across eras.
BENCH_BAND = (40.0, 43.0)
ACTIVE_FLOOR = 43.0

MIN_GAMES_FOR_FULL_WEIGHT = 4
ROOKIE_DEAL_YEARS = 3
PAY_CREDIBILITY_YEARS = 4.0

COMPONENT_NAMES = ("usage", "prod", "prod_pg", "rate", "apy", "avail", "unit")


def _w(*weights: float) -> dict[str, float]:
    return {name: w for name, w in zip(COMPONENT_NAMES, weights, strict=True) if w > 0}


# Relative weight of each standardized component, by position group. Components a position has no
# evidence for (no box score for a lineman) are simply absent and the rest are renormalized.
# fmt: off
COMPONENT_WEIGHTS: dict[str, dict[str, float]] = {
    # usage: per-game role. prod: season volume. prod_pg: volume per game played (so a star who
    # missed six weeks still reads as a star). rate: per-opportunity efficiency. apy: market price
    # within contract cohort. avail: games played. unit: the team unit's measured quality.
    #        usage  prod  prod_pg  rate  apy  avail  unit
    "QB": _w(.14, .22, .18, .10, .20, .12, 0),
    "RB": _w(.24, .17, .15, .14, .10, .12, .06),
    "WR": _w(.24, .17, .15, .14, .10, .12, .06),
    "TE": _w(.28, .15, .13, .12, .12, .12, .06),
    "OL": _w(.42, 0, 0, 0, .24, .16, .18),
    "DL": _w(.28, .15, .13, .06, .14, .12, .12),
    "LB": _w(.30, .14, .12, .06, .14, .12, .12),
    "CB": _w(.30, .12, .10, .06, .16, .12, .14),
    "S": _w(.30, .12, .10, .06, .16, .12, .14),
    "K": _w(.10, .22, .18, .25, .10, .15, 0),
    "P": _w(.10, .15, .15, .35, .10, .15, 0),
}
# fmt: on

OFFENSE = {"QB", "RB", "WR", "TE", "OL"}
DEFENSE = {"DL", "LB", "CB", "S"}

DEPTH_ROLE = {1: 1.0, 2: 0.5, 3: 0.2}

MIN_CONTRACT_CAP_PCT = 0.004  # league minimum ~0.4% of the cap; used for unmatched players


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    if name in df.columns:
        return pd.to_numeric(df[name], errors="coerce").fillna(0.0)
    return pd.Series(0.0, index=df.index)


def _zscore(values: pd.Series, groups: pd.Series) -> pd.Series:
    grouped = values.groupby(groups)
    mean = grouped.transform("mean")
    sd = grouped.transform("std").replace(0.0, np.nan)
    return ((values - mean) / sd).fillna(0.0)


def _rank_normal(values: pd.Series, groups: pd.Series) -> pd.Series:
    """Van der Waerden normal scores: same target distribution for every position group."""
    ranks = values.groupby(groups).rank(method="average")
    n = values.groupby(groups).transform("size")
    return pd.Series(norm.ppf(ranks / (n + 1.0)), index=values.index)


def _shrunk_rate(total: pd.Series, opportunity: pd.Series, k: float) -> pd.Series:
    """Per-opportunity rate pulled toward the pool mean by sample size (empirical-Bayes-ish)."""
    prior = total.sum() / max(opportunity.sum(), 1.0)
    return (total + prior * k) / (opportunity + k)


def _season_stats(season: int) -> pd.DataFrame:
    stats = load_stats_week(season)
    sum_cols = [
        "passing_yards",
        "passing_tds",
        "passing_interceptions",
        "passing_epa",
        "attempts",
        "completions",
        "sacks_suffered",
        "carries",
        "rushing_yards",
        "rushing_tds",
        "rushing_epa",
        "targets",
        "receptions",
        "receiving_yards",
        "receiving_tds",
        "receiving_epa",
        "fumbles_lost_total",
        "def_tackles_solo",
        "def_tackle_assists",
        "def_tackles_for_loss",
        "def_sacks",
        "def_qb_hits",
        "def_interceptions",
        "def_pass_defended",
        "def_fumbles_forced",
        "def_tds",
        "fg_made",
        "fg_att",
        "fg_made_40_49",
        "fg_made_50_59",
        "pat_made",
        "pat_att",
        "pt_att",
        "pt_net_yards",
        "pt_inside_20",
    ]
    frame = pd.DataFrame({name: _col(stats, name) for name in sum_cols})
    frame["gsis_id"] = stats["gsis_id"].to_numpy()
    agg = frame.groupby("gsis_id", sort=True).sum()
    agg["stat_weeks"] = stats.groupby("gsis_id", sort=True)["week"].nunique()
    return agg


def _team_context(season: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Team offensive-line and defensive unit quality, on the team's own canonical id."""
    stats = load_stats_week(season)
    frame = pd.DataFrame(
        {
            "team": stats["team"].to_numpy(),
            "opp": stats["opponent_team"].to_numpy(),
            "pass_epa": _col(stats, "passing_epa").to_numpy(),
            "rush_epa": _col(stats, "rushing_epa").to_numpy(),
            "dropbacks": (_col(stats, "attempts") + _col(stats, "sacks_suffered")).to_numpy(),
            "sacks_allowed": _col(stats, "sacks_suffered").to_numpy(),
            "carries": _col(stats, "carries").to_numpy(),
        }
    )
    offense = frame.groupby("team").sum(numeric_only=True)
    defense = frame.groupby("opp").sum(numeric_only=True)
    offense["rush_epa_per_carry"] = offense["rush_epa"] / offense["carries"].clip(lower=1)
    offense["sack_rate"] = offense["sacks_allowed"] / offense["dropbacks"].clip(lower=1)
    defense["epa_allowed"] = defense["pass_epa"] + defense["rush_epa"]
    return offense, defense


def _usage_and_games(season: int, roster: pd.DataFrame) -> pd.DataFrame:
    """Per-game role share and games played, from snaps (2012+) with depth-chart fallbacks."""
    ids = roster["gsis_id"]
    out = pd.DataFrame(index=pd.Index(ids, name="gsis_id"))
    out["pos"] = roster["pos"].to_numpy()

    snaps = load_snaps(season)
    if len(snaps):
        played = snaps[
            (snaps["offense_snaps"].fillna(0) + snaps["defense_snaps"].fillna(0)) > 0
        ].copy()
        by_player = played.groupby("gsis_id")
        snap_games = by_player["week"].nunique()
        off_pct = by_player["offense_pct"].mean()
        def_pct = by_player["defense_pct"].mean()
        st_pct = snaps.groupby("gsis_id")["st_pct"].mean()
        st_games = snaps[snaps["st_snaps"].fillna(0) > 0].groupby("gsis_id")["week"].nunique()
        out["snap_games"] = snap_games.reindex(out.index).fillna(0.0)
        out["st_games"] = st_games.reindex(out.index).fillna(0.0)
        out["off_pct"] = off_pct.reindex(out.index)
        out["def_pct"] = def_pct.reindex(out.index)
        out["st_pct"] = st_pct.reindex(out.index)
    else:
        for col in ("snap_games", "st_games"):
            out[col] = 0.0
        for col in ("off_pct", "def_pct", "st_pct"):
            out[col] = np.nan

    depth = load_depth_charts(season)
    role = depth["depth"].map(DEPTH_ROLE).fillna(0.1)
    depth_role = role.groupby(depth["gsis_id"]).mean()
    depth_weeks = depth.groupby("gsis_id")["week"].nunique()
    out["depth_role"] = depth_role.reindex(out.index).fillna(0.0)
    out["depth_weeks"] = depth_weeks.reindex(out.index).fillna(0.0)
    return out


def _touch_share(season: int, stats: pd.DataFrame, roster: pd.DataFrame) -> pd.Series:
    """Share of the player's team's opportunities — the pre-2012 usage proxy for skill players."""
    weekly = load_stats_week(season)
    team = weekly.groupby("gsis_id")["team"].agg(
        lambda s: s.mode().iat[0] if len(s.mode()) else None
    )
    opp = pd.DataFrame(index=stats.index)
    opp["team"] = team.reindex(stats.index)
    opp["qb"] = stats["attempts"] + stats["carries"]
    opp["rb"] = stats["carries"] + stats["targets"]
    opp["rec"] = stats["targets"]
    totals = opp.groupby("team").transform("sum")
    pos = roster.set_index("gsis_id")["pos"].reindex(stats.index)
    share = pd.Series(0.0, index=stats.index)
    for key, positions in (("qb", {"QB"}), ("rb", {"RB"}), ("rec", {"WR", "TE"})):
        mask = pos.isin(positions)
        share[mask] = (opp.loc[mask, key] / totals.loc[mask, key].clip(lower=1)).to_numpy()
    # A team has ~1 quarterback and ~5 receivers, so raw shares are not comparable across
    # positions; rescale each to a 0-1 "role" where a full-time starter is ~1.
    scale = {"QB": 0.9, "RB": 0.45, "WR": 0.22, "TE": 0.18}
    for position, divisor in scale.items():
        mask = pos == position
        share[mask] = (share[mask] / divisor).clip(upper=1.0)
    return share.fillna(0.0)


def _position_production(stats: pd.DataFrame, pos: pd.Series) -> dict[str, dict[str, object]]:
    """Raw production ingredients per position group: blended volume parts, rate, opportunity."""
    tackles = stats["def_tackles_solo"] + 0.5 * stats["def_tackle_assists"]
    splash = {
        "DL": 3.2 * stats["def_sacks"]
        + 1.1 * stats["def_tackles_for_loss"]
        + 0.55 * stats["def_qb_hits"]
        + 0.14 * tackles
        + 2.0 * stats["def_fumbles_forced"]
        + 2.0 * stats["def_interceptions"]
        + 0.5 * stats["def_pass_defended"],
        "LB": 2.6 * stats["def_sacks"]
        + 1.0 * stats["def_tackles_for_loss"]
        + 0.35 * stats["def_qb_hits"]
        + 0.13 * tackles
        + 1.0 * stats["def_pass_defended"]
        + 2.5 * stats["def_interceptions"]
        + 2.0 * stats["def_fumbles_forced"],
        "CB": 3.0 * stats["def_interceptions"]
        + 0.9 * stats["def_pass_defended"]
        + 0.12 * tackles
        + 1.2 * stats["def_sacks"]
        + 0.5 * stats["def_tackles_for_loss"]
        + 1.5 * stats["def_fumbles_forced"],
        "S": 3.0 * stats["def_interceptions"]
        + 0.85 * stats["def_pass_defended"]
        + 0.12 * tackles
        + 1.3 * stats["def_sacks"]
        + 0.6 * stats["def_tackles_for_loss"]
        + 1.5 * stats["def_fumbles_forced"],
    }
    spec: dict[str, dict[str, object]] = {
        "QB": {
            "parts": [
                (0.35, stats["passing_epa"] + stats["rushing_epa"]),
                # Relative weights follow standard fantasy scoring converted to passing-yard
                # units (1 passing TD = 100 yards, 1 rushing yard = 2.5 passing yards), which is
                # close to the real point value of a score and to how the public reads a season.
                (
                    0.65,
                    stats["passing_yards"]
                    + 100 * stats["passing_tds"]
                    - 50 * stats["passing_interceptions"]
                    + 2.5 * stats["rushing_yards"]
                    + 150 * stats["rushing_tds"]
                    - 25 * stats["fumbles_lost_total"],
                ),
            ],
            "rate_num": stats["passing_epa"] + stats["rushing_epa"],
            "opportunity": stats["attempts"] + stats["carries"] + stats["sacks_suffered"],
            "k": 180.0,
        },
        "RB": {
            "parts": [
                (0.45, stats["rushing_epa"] + stats["receiving_epa"]),
                (
                    0.55,
                    stats["rushing_yards"]
                    + stats["receiving_yards"]
                    + 60 * (stats["rushing_tds"] + stats["receiving_tds"])
                    + 10 * stats["receptions"]
                    - 20 * stats["fumbles_lost_total"],
                ),
            ],
            "rate_num": stats["rushing_epa"] + stats["receiving_epa"],
            "opportunity": stats["carries"] + stats["targets"],
            "k": 110.0,
        },
        "K": {
            "parts": [
                (
                    1.0,
                    3 * stats["fg_made"]
                    + stats["pat_made"]
                    + stats["fg_made_40_49"]
                    + 2 * stats["fg_made_50_59"],
                )
            ],
            "rate_num": stats["fg_made"],
            "opportunity": stats["fg_att"],
            "k": 15.0,
        },
        "P": {
            "parts": [(1.0, stats["pt_att"])],
            "rate_num": stats["pt_net_yards"] + 8 * stats["pt_inside_20"],
            "opportunity": stats["pt_att"],
            "k": 12.0,
        },
    }
    receiving = {
        "parts": [
            (0.45, stats["receiving_epa"] + stats["rushing_epa"]),
            (
                0.55,
                stats["receiving_yards"]
                + 60 * stats["receiving_tds"]
                + 10 * stats["receptions"]
                + stats["rushing_yards"],
            ),
        ],
        "rate_num": stats["receiving_epa"],
        "opportunity": stats["targets"],
        "k": 45.0,
    }
    spec["WR"] = receiving
    spec["TE"] = receiving
    for position, score in splash.items():
        spec[position] = {
            "parts": [(1.0, score)],
            "rate_num": score,
            "opportunity": stats["stat_weeks"],
            "k": 6.0,
        }
    return spec


def _production(
    stats: pd.DataFrame, pos: pd.Series, games: pd.Series
) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    """Season volume, per-game volume, per-opportunity rate and opportunity count."""
    volume = pd.Series(0.0, index=stats.index)
    per_game = pd.Series(0.0, index=stats.index)
    rate = pd.Series(np.nan, index=stats.index)
    opportunity = pd.Series(0.0, index=stats.index)
    played = games.clip(lower=1.0)

    for position, ingredients in _position_production(stats, pos).items():
        mask = pos == position
        if not mask.any():
            continue
        parts: list[tuple[float, pd.Series]] = ingredients["parts"]  # type: ignore[assignment]
        for weight, raw in parts:
            volume[mask] += weight * _norm_unit(raw[mask])
            per_game[mask] += weight * _norm_unit((raw / played)[mask])
        opp: pd.Series = ingredients["opportunity"]  # type: ignore[assignment]
        num: pd.Series = ingredients["rate_num"]  # type: ignore[assignment]
        opportunity[mask] = opp[mask]
        rate[mask] = _shrunk_rate(num[mask], opp[mask], k=float(ingredients["k"]))  # type: ignore[arg-type]
    return volume, per_game, rate, opportunity


def _norm_unit(values: pd.Series) -> pd.Series:
    """Scale to roughly mean 0 / sd 1 within the passed slice; ordering is what matters."""
    if values.empty:
        return values
    sd = values.std()
    if not np.isfinite(sd) or sd == 0:
        return values * 0.0
    return (values - values.mean()) / sd


def _apy_cap_pct(season: int, ids: pd.Index) -> pd.Series:
    contracts = load_contracts()
    active = contracts[
        (contracts["year_signed"] <= season)
        & (season < contracts["year_signed"] + contracts["years"])
    ]
    best = active.groupby("gsis_id")["apy_cap_pct"].max()
    return best.reindex(ids).fillna(MIN_CONTRACT_CAP_PCT)


def primary_team(season: int) -> pd.Series:
    """The team a player is assigned to for this season (most snaps, else most stat weeks)."""
    roster = load_roster(season)
    team = roster.drop_duplicates("gsis_id").set_index("gsis_id")["team"]
    snaps = load_snaps(season)
    if len(snaps):
        dominant = snaps.groupby("gsis_id")["team"].agg(
            lambda s: s.value_counts().idxmax() if len(s) else None
        )
        team.update(dominant.reindex(team.index).dropna())
    return team.map(canonical_team)


def season_features(season: int) -> pd.DataFrame:
    roster = load_roster(season).drop_duplicates("gsis_id")
    ids = pd.Index(roster["gsis_id"], name="gsis_id")
    pos = pd.Series(roster["pos"].to_numpy(), index=ids)

    stats = _season_stats(season).reindex(ids).fillna(0.0)
    usage_frame = _usage_and_games(season, roster)
    games_per_team = team_games(season)
    team = primary_team(season).reindex(ids)
    team_slots = team.map(games_per_team).fillna(float(games_per_team.median()))

    touch = _touch_share(season, stats, roster)

    snap_pct = pd.Series(np.nan, index=ids)
    offense_mask = pos.isin(OFFENSE)
    snap_pct[offense_mask] = usage_frame["off_pct"][offense_mask]
    snap_pct[pos.isin(DEFENSE)] = usage_frame["def_pct"][pos.isin(DEFENSE)]
    snap_pct[pos.isin({"K", "P"})] = usage_frame["st_pct"][pos.isin({"K", "P"})]

    depth_usage = usage_frame["depth_role"].clip(upper=1.0)
    usage = snap_pct.fillna(pd.concat([depth_usage, touch], axis=1).max(axis=1))
    usage = usage.fillna(0.0).clip(0.0, 1.0)

    games = usage_frame["snap_games"].copy()
    special = pos.isin({"K", "P"})
    games[special] = usage_frame["st_games"][special]
    no_snaps = games <= 0
    games[no_snaps] = stats["stat_weeks"][no_snaps]
    if season < SNAPS_FIRST_SEASON:
        # No snap counts before 2012, and linemen never show up in the box score, so the weekly
        # depth chart is the only evidence they were active. It over-counts inactives.
        still_missing = (games <= 0) & (usage_frame["depth_weeks"] > 0)
        games[still_missing] = usage_frame["depth_weeks"][still_missing]
    games = games.clip(upper=team_slots).fillna(0.0)
    avail = (games / team_slots).clip(0.0, 1.0)
    volume, volume_pg, rate, opportunity = _production(stats, pos, games)

    offense_ctx, defense_ctx = _team_context(season)
    line_quality = 0.5 * _norm_unit(offense_ctx["rush_epa_per_carry"]) - 0.5 * _norm_unit(
        offense_ctx["sack_rate"]
    )
    defense_quality = -_norm_unit(defense_ctx["epa_allowed"])
    unit = pd.Series(0.0, index=ids)
    unit[offense_mask] = team[offense_mask].map(line_quality).to_numpy()
    unit[pos.isin(DEFENSE)] = team[pos.isin(DEFENSE)].map(defense_quality).to_numpy()

    years_exp = pd.to_numeric(roster["years_exp"], errors="coerce")
    years_exp = pd.Series(years_exp.to_numpy(), index=ids).fillna(0.0)

    return pd.DataFrame(
        {
            "season": season,
            "pos": pos,
            "team": team,
            "years_exp": years_exp,
            "games": games.astype(float),
            "usage": usage,
            "avail": avail,
            "volume": volume,
            "volume_pg": volume_pg,
            "rate": rate.fillna(rate.median()),
            "opportunity": opportunity,
            "apy_cap_pct": _apy_cap_pct(season, ids),
            "unit": unit.fillna(0.0),
        }
    )


def _latent(features: pd.DataFrame) -> pd.Series:
    groups = features["pos"] + "|" + features["season"].astype(str)
    # Rookie-scale deals are set by draft slot, not by how good the player turned out, so pay is
    # only a quality signal *within* a contract cohort. Ranking across cohorts would tax every
    # young star and reward every declining veteran on a legacy deal.
    rookie_deal = (features["years_exp"] <= ROOKIE_DEAL_YEARS).map({True: "R", False: "V"})
    pay_groups = groups + "|" + rookie_deal
    components = {
        "usage": _rank_normal(features["usage"], groups),
        "prod": _rank_normal(features["volume"], groups),
        "prod_pg": _rank_normal(features["volume_pg"], groups),
        "rate": _rank_normal(features["rate"], groups),
        "apy": _rank_normal(features["apy_cap_pct"], pay_groups),
        "avail": _rank_normal(features["avail"], groups),
        "unit": _zscore(features["unit"], groups).clip(-3, 3),
    }

    # A tiny but non-empty sample is noise, not signal: pull the production estimate back toward
    # the position mean. Zero games is not a small sample, it is an observation.
    games = features["games"]
    tiny = (games > 0) & (games < MIN_GAMES_FOR_FULL_WEIGHT)
    shrink = pd.Series(1.0, index=features.index)
    shrink[tiny] = games[tiny] / MIN_GAMES_FOR_FULL_WEIGHT
    for name in ("prod", "prod_pg", "rate"):
        components[name] = components[name] * shrink

    # Rookie-scale pay prices what a team expected on draft night, not what the player has done
    # in the NFL. Letting it count in full would leak draft slot into the hidden truth, which is
    # exactly the edge the player is supposed to have over the league's consensus.
    market_credibility = (features["years_exp"] / PAY_CREDIBILITY_YEARS).clip(0.0, 1.0)
    components["apy"] = components["apy"] * market_credibility

    latent = pd.Series(0.0, index=features.index)
    weight_total = pd.Series(0.0, index=features.index)
    for position in POSITIONS:
        mask = features["pos"] == position
        if not mask.any():
            continue
        weights = COMPONENT_WEIGHTS[position]
        for name, weight in weights.items():
            latent[mask] += weight * components[name][mask]
            weight_total[mask] += weight
    return latent / weight_total


def value_from_latent(features: pd.DataFrame) -> pd.Series:
    groups = features["pos"] + "|" + features["season"].astype(str)
    active = features["games"] >= 1
    value = pd.Series(VALUE_MIN, index=features.index)

    z_active = _rank_normal(features.loc[active, "latent"], groups[active])
    value[active] = (VALUE_CENTER + VALUE_SPREAD * z_active).clip(ACTIVE_FLOOR, VALUE_MAX)

    bench_lo, bench_hi = BENCH_BAND
    if (~active).any():
        z_bench = _rank_normal(features.loc[~active, "latent"], groups[~active])
        span = (bench_hi - bench_lo) / 2.0
        value[~active] = ((bench_lo + bench_hi) / 2.0 + span * z_bench / 2.5).clip(
            bench_lo, bench_hi
        )
    return value.round(1)


def build_true_values(seasons: list[int], features: pd.DataFrame | None = None) -> pd.DataFrame:
    if features is None:
        features = pd.concat([season_features(season) for season in seasons]).reset_index()
    features = features[features["season"].isin(seasons)].copy()
    features["latent"] = _latent(features)
    features["true_value"] = value_from_latent(features)
    return features


def true_value_table(seasons: list[int], features: pd.DataFrame | None = None) -> pd.DataFrame:
    """The contract shape written to .cache/model/true_values.parquet."""
    built = build_true_values(seasons, features)
    out = built[["gsis_id", "season", "pos", "true_value", "games"]].copy()
    out["gsis_id"] = out["gsis_id"].astype("string")
    out["season"] = out["season"].astype("int32")
    out["pos"] = out["pos"].astype("string")
    out["true_value"] = out["true_value"].astype("float64")
    out["games"] = out["games"].round().astype("int32")
    return out.sort_values(["season", "gsis_id"]).reset_index(drop=True)
