"""Per player-season true value on the shared, position-invariant 40-99 scale.

Season S's value is built from season S's evidence: what the player did (box score per game and
per opportunity), the role he held (snap share), the market price of his current deal, the share
of the season he was on the field and, where the box score is silent, the measured quality of his
unit. Nothing is smoothed across seasons. The one exception is the tiny-sample rule the spec
allows: a player with a non-empty sample under four games is pulled toward a prior so an injured
star is not rated on two games. That prior is his own most recent full season when he has one, the
position mean otherwise. A player with no sample at all is not shrunk: "did not play" is
information, not noise.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import norm

from gridiron_pipeline.model.data import (
    SNAPS_FIRST_SEASON,
    canonical_team,
    load_contracts,
    load_depth_charts,
    load_players,
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
PRIOR_LOOKBACK_SEASONS = 2
# Games' worth of the player's previous full season blended into every season (HANDOFF §6.2,
# amended 2026-10-06): a 16-game season keeps 16/18 of itself. Regulars' year-over-year r goes
# from ~0.67 at 0 to ~0.74, with no calibration cost.
PRIOR_SEASON_GAMES = 2.0
# Pay z imputed per unit of the player's own evidence when his deal says nothing (entry deal or
# none on record). Below 1 because the market regresses one season; much lower and rookie stars
# (Michael Thomas 2018) rank under veterans with the same season.
ENTRY_DEAL_PAY_SLOPE = 0.8
# Yards a touchdown is worth in a quarterback's scoring line, between ANY/A's 20 and fantasy's 100.
QB_TD_YARDS = 50
# OTC books an extension as its new years on top of the deal still running, so a contract keeps
# counting this many seasons past its listed length unless a newer one replaces it.
CONTRACT_COVERAGE_SLACK = 2

OFFENSE = {"QB", "RB", "WR", "TE", "OL"}
DEFENSE = {"DL", "LB", "CB", "S"}
DEPTH_ROLE = {1: 1.0, 2: 0.5, 3: 0.2}

# The market pays a left tackle more than an All-Pro guard and an edge rusher more than a nose
# tackle, so pay is ranked within these sub-groups to stay "elite within position".
PAY_SUBGROUP: dict[str, str] = {
    "T": "T",
    "OT": "T",
    "LT": "T",
    "RT": "T",
    "G": "G",
    "OG": "G",
    "LG": "G",
    "RG": "G",
    "C": "C",
    "DE": "EDGE",
    "EDGE": "EDGE",
    "DT": "IDL",
    "NT": "IDL",
    "OLB": "OLB",
    "ILB": "ILB",
    "MLB": "ILB",
}
PAY_SUBGROUPS_BY_POS: dict[str, tuple[str, ...]] = {
    "OL": ("T", "G", "C"),
    "DL": ("EDGE", "IDL"),
    "LB": ("OLB", "ILB"),
}
FG_BUCKETS = ("0_19", "20_29", "30_39", "40_49", "50_59", "60_")

# Measures standardized as z-scores rather than ranks: they pile up near a ceiling (every full-time
# starter plays ~100% of snaps), and ranking near-ties turns noise into a full standard deviation.
LEVEL_MEASURES = frozenset({"role", "avail", "unit"})

# Relative weight of each standardized measure, by position group (normalized per row). Weights
# favor what repeats when the player does (per-game yards, first downs, pass rush, tackles, the
# market's price) over what swings with luck (EPA per play, FG%, picks); team unit quality stays
# where the box score is silent because it is what ties linemen and defenders to real results.
# fmt: off
WEIGHTS: dict[str, dict[str, float]] = {
    "QB": {"qb_epa": .12, "qb_score": .24, "qb_box": .14, "qb_cpoe": .06,
           "pay": .18, "role": .10, "avail": .16},
    "RB": {"rb_yards": .16, "rb_rush": .12, "rb_fd": .10, "rb_td": .12, "rb_rush_eff": .06,
           "rb_epa": .14, "pay": .12, "role": .08, "avail": .10},
    "WR": {"rec_yards": .20, "rec_fd": .10, "rec_td": .06, "rec_epa": .14, "rec_eff": .06,
           "rec_share": .10, "pay": .14, "role": .10, "avail": .10},
    "TE": {"rec_yards": .18, "rec_fd": .08, "rec_td": .06, "rec_epa": .12, "rec_eff": .04,
           "rec_share": .06, "pay": .18, "role": .18, "avail": .10},
    "OL": {"pay": .48, "role": .18, "unit": .22, "avail": .12},
    "DL": {"pass_rush": .14, "tackles": .06, "splash": .06,
           "pay": .26, "role": .24, "unit": .16, "avail": .08},
    "LB": {"tackles": .14, "pass_rush": .06, "splash": .04,
           "pay": .27, "role": .25, "unit": .16, "avail": .08},
    "CB": {"coverage": .10, "splash": .04, "tackles": .02,
           "pay": .28, "role": .26, "unit": .20, "avail": .10},
    "S": {"coverage": .04, "splash": .06, "tackles": .10,
          "pay": .32, "role": .22, "unit": .18, "avail": .08},
    "K": {"k_accuracy": .14, "k_long": .08, "k_pat": .06, "pay": .44, "role": .18, "avail": .10},
    "P": {"p_net": .14, "p_gross": .06, "p_inside": .10, "pay": .48, "role": .12, "avail": .10},
}
# fmt: on

STAT_COLUMNS = (
    "passing_yards",
    "passing_tds",
    "passing_interceptions",
    "passing_epa",
    "passing_first_downs",
    "attempts",
    "completions",
    "sacks_suffered",
    "sack_yards_lost",
    "carries",
    "rushing_yards",
    "rushing_tds",
    "rushing_epa",
    "rushing_first_downs",
    "targets",
    "receptions",
    "receiving_yards",
    "receiving_tds",
    "receiving_epa",
    "receiving_first_downs",
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
    *(f"fg_made_{bucket}" for bucket in FG_BUCKETS),
    *(f"fg_missed_{bucket}" for bucket in FG_BUCKETS),
    "pat_made",
    "pat_att",
    "pt_att",
    "pt_yards",
    "pt_net_yards",
    "pt_inside_20",
)


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    if name in df.columns:
        return pd.to_numeric(df[name], errors="coerce").fillna(0.0)
    return pd.Series(0.0, index=df.index)


def _zscore(values: pd.Series, groups: pd.Series, pool: pd.Series) -> pd.Series:
    """z within each group, with mean and sd taken over the pool rows only."""
    pooled = values.where(pool)
    mean = pooled.groupby(groups).transform("mean")
    sd = pooled.groupby(groups).transform("std").replace(0.0, np.nan)
    return ((values - mean) / sd).fillna(0.0).clip(-3.0, 3.0)


def _rank_normal(values: pd.Series, groups: pd.Series) -> pd.Series:
    """Van der Waerden normal scores: same target distribution for every position group."""
    ranks = values.groupby(groups).rank(method="average")
    n = values.groupby(groups).transform("size")
    return pd.Series(norm.ppf(ranks / (n + 1.0)), index=values.index)


def _pooled_rate(
    total: pd.Series, opportunity: pd.Series, groups: pd.Series, k: float
) -> pd.Series:
    """Per-opportunity rate pulled toward its position-season pool by sample size."""
    pool_total = total.groupby(groups).transform("sum")
    pool_opportunity = opportunity.groupby(groups).transform("sum").clip(lower=1.0)
    prior = pool_total / pool_opportunity
    return (total + prior * k) / (opportunity + k)


def _season_stats(season: int) -> pd.DataFrame:
    stats = load_stats_week(season)
    frame = pd.DataFrame({name: _col(stats, name) for name in STAT_COLUMNS})
    cpoe = pd.to_numeric(stats.get("passing_cpoe"), errors="coerce")
    graded = cpoe.notna()
    frame["cpoe_x_att"] = (cpoe.fillna(0.0) * frame["attempts"]).where(graded, 0.0)
    frame["cpoe_att"] = frame["attempts"].where(graded, 0.0)
    frame["target_share"] = pd.to_numeric(stats.get("target_share"), errors="coerce")
    frame["gsis_id"] = stats["gsis_id"].to_numpy()
    by_player = frame.groupby("gsis_id", sort=True)
    agg = by_player.sum(numeric_only=True)
    agg["target_share"] = by_player["target_share"].mean().fillna(0.0)
    agg["stat_weeks"] = stats.groupby("gsis_id", sort=True)["week"].nunique()

    # Expected makes at the league's make rate for each distance band that season, so a kicker is
    # not credited for being handed chip shots or blamed for being sent out from 55.
    expected = pd.Series(0.0, index=agg.index)
    for bucket in FG_BUCKETS:
        made, missed = agg[f"fg_made_{bucket}"], agg[f"fg_missed_{bucket}"]
        league_rate = made.sum() / max(made.sum() + missed.sum(), 1.0)
        expected += (made + missed) * league_rate
    agg["fg_expected"] = expected
    agg["fg_long"] = agg["fg_made_50_59"] + agg["fg_made_60_"]
    agg["pat_expected"] = agg["pat_att"] * agg["pat_made"].sum() / max(agg["pat_att"].sum(), 1.0)
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
    for side in (offense, defense):
        side["rush_epa_per_carry"] = side["rush_epa"] / side["carries"].clip(lower=1)
        side["pass_epa_per_dropback"] = side["pass_epa"] / side["dropbacks"].clip(lower=1)
        side["sack_rate"] = side["sacks_allowed"] / side["dropbacks"].clip(lower=1)
    return offense, defense


def _unit_quality(season: int) -> dict[str, pd.Series]:
    """Per-team quality of the unit each position group plays in, as a z-score across teams.

    Linemen own the run game and the pocket; the front seven owns the run defense and the pass
    rush; the secondary owns pass defense per dropback.
    """
    offense, defense = _team_context(season)
    line = 0.5 * _norm_unit(offense["rush_epa_per_carry"]) - 0.5 * _norm_unit(offense["sack_rate"])
    run_defense = -_norm_unit(defense["rush_epa_per_carry"])
    pass_rush = _norm_unit(defense["sack_rate"])
    coverage = -_norm_unit(defense["pass_epa_per_dropback"])
    front = 0.4 * run_defense + 0.3 * pass_rush + 0.3 * coverage
    return {
        "OL": line,
        "DL": front,
        "LB": front,
        "CB": coverage,
        "S": 0.7 * coverage + 0.3 * run_defense,
    }


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


def _pay_subgroup(roster: pd.DataFrame) -> pd.Series:
    """Market sub-group inside the position group; the group itself where the source is silent."""

    def lookup(codes: pd.Series) -> pd.Series:
        return codes.astype("string").str.strip().str.upper().map(PAY_SUBGROUP)

    sub = lookup(roster["depth_chart_position"]).fillna(lookup(roster["position"]))
    allowed = [
        group in PAY_SUBGROUPS_BY_POS.get(pos, ())
        for group, pos in zip(sub, roster["pos"], strict=True)
    ]
    return sub.where(allowed, roster["pos"]).astype(str)


def market_apy_cap_pct(season: int, ids: pd.Index) -> pd.Series:
    """Cap share of the player's most recently signed deal still in force in `season`, when that
    deal was struck after he had played: NaN for an entry deal (rookie scale or UDFA) and for a
    player with no deal on record (the contracts file is thin before ~2015, so missing is unknown,
    not the league minimum)."""
    contracts = load_contracts()
    in_force = contracts[
        (contracts["year_signed"] <= season)
        & (season < contracts["year_signed"] + contracts["years"] + CONTRACT_COVERAGE_SLACK)
    ]
    latest = in_force.sort_values(["year_signed", "apy_cap_pct"]).groupby("gsis_id").tail(1)
    latest = latest.set_index("gsis_id").reindex(ids)
    rookie_season = pd.to_numeric(
        pd.Series(ids, index=ids).map(load_players().set_index("gsis_id")["rookie_season"]),
        errors="coerce",
    )
    entry_deal = latest["year_signed"] <= rookie_season
    return latest["apy_cap_pct"].where(~entry_deal)


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
    """Role, availability, pay, unit context and raw season stat totals per rostered player."""
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

    unit = pd.Series(0.0, index=ids)
    for group, quality in _unit_quality(season).items():
        mask = pos == group
        unit[mask] = team[mask].map(quality).to_numpy()

    years_exp = pd.to_numeric(roster["years_exp"], errors="coerce")
    years_exp = pd.Series(years_exp.to_numpy(), index=ids).fillna(0.0)

    context = pd.DataFrame(
        {
            "season": season,
            "pos": pos,
            "pay_group": _pay_subgroup(roster).to_numpy(),
            "team": team,
            "years_exp": years_exp,
            "games": games.astype(float),
            "usage": usage,
            "avail": avail,
            "apy_cap_pct": market_apy_cap_pct(season, ids),
            "unit": unit.fillna(0.0),
        }
    )
    stat_columns = stats.drop(columns=[c for c in ("season",) if c in stats.columns])
    return pd.concat([context, stat_columns], axis=1)


def _norm_unit(values: pd.Series) -> pd.Series:
    """Scale to mean 0 / sd 1 within the passed slice."""
    if values.empty:
        return values
    sd = values.std()
    if not np.isfinite(sd) or sd == 0:
        return values * 0.0
    return (values - values.mean()) / sd


def measures(features: pd.DataFrame) -> pd.DataFrame:
    """Raw per-season measures, each on its natural scale; small samples pulled to their pool."""
    f = features
    groups = f["pos"] + "|" + f["season"].astype(str)
    games = f["games"]

    def per_game(total: pd.Series, k: float = 2.0) -> pd.Series:
        return _pooled_rate(total, games, groups, k)

    def per_try(total: pd.Series, tries: pd.Series, k: float) -> pd.Series:
        return _pooled_rate(total, tries, groups, k)

    plays = f["attempts"] + f["sacks_suffered"] + f["carries"]
    tackles = f["def_tackles_solo"] + 0.5 * f["def_tackle_assists"]
    return pd.DataFrame(
        {
            "role": f["usage"],
            "avail": f["avail"],
            "unit": f["unit"],
            "pay": f["apy_cap_pct"],
            "qb_epa": per_try(f["passing_epa"] + f["rushing_epa"], plays, k=150.0),
            # Adjusted net yards with the legs counted like the arm: a 1,200-yard rushing season
            # is worth what 1,200 passing yards are.
            "qb_box": per_game(
                f["passing_yards"]
                + 20 * f["passing_tds"]
                - 45 * f["passing_interceptions"]
                - f["sack_yards_lost"]
                + f["rushing_yards"]
                + 20 * f["rushing_tds"]
                - 25 * f["fumbles_lost_total"]
            ),
            "qb_score": per_game(
                f["passing_yards"]
                + QB_TD_YARDS * (f["passing_tds"] + f["rushing_tds"])
                - 45 * f["passing_interceptions"]
                - f["sack_yards_lost"]
                + f["rushing_yards"]
                - 25 * f["fumbles_lost_total"]
            ),
            "qb_cpoe": per_try(f["cpoe_x_att"], f["cpoe_att"], k=150.0),
            "qb_rush": per_game(f["rushing_yards"] + 20 * f["rushing_tds"]),
            "rb_yards": per_game(f["rushing_yards"] + f["receiving_yards"]),
            "rb_fd": per_game(f["rushing_first_downs"] + f["receiving_first_downs"]),
            "rb_td": per_game(f["rushing_tds"] + f["receiving_tds"]),
            "rb_eff": per_try(
                f["rushing_epa"] + f["receiving_epa"], f["carries"] + f["targets"], k=80.0
            ),
            "rb_rush": per_game(f["rushing_yards"] + 20 * f["rushing_tds"]),
            "rb_rush_eff": per_try(f["rushing_epa"], f["carries"], k=80.0),
            "rb_epa": per_game(f["rushing_epa"] + f["receiving_epa"]),
            "rec_yards": per_game(f["receiving_yards"] + f["rushing_yards"]),
            "rec_fd": per_game(f["receiving_first_downs"] + f["rushing_first_downs"]),
            "rec_td": per_game(f["receiving_tds"] + f["rushing_tds"]),
            "rec_eff": per_try(f["receiving_epa"], f["targets"], k=40.0),
            "rec_epa": per_game(f["receiving_epa"] + f["rushing_epa"]),
            "rec_share": f["target_share"],
            "pass_rush": per_game(
                f["def_sacks"] + 0.5 * f["def_qb_hits"] + 0.5 * f["def_tackles_for_loss"]
            ),
            "tackles": per_game(tackles),
            "coverage": per_game(f["def_pass_defended"] + 1.5 * f["def_interceptions"]),
            "splash": per_game(
                f["def_fumbles_forced"]
                + f["def_interceptions"]
                + 0.5 * f["def_sacks"]
                + 2 * f["def_tds"]
            ),
            "k_accuracy": per_try(f["fg_made"] - f["fg_expected"], f["fg_att"], k=25.0),
            "k_long": per_game(f["fg_long"]),
            "k_pat": per_try(f["pat_made"] - f["pat_expected"], f["pat_att"], k=30.0),
            "p_net": per_try(f["pt_net_yards"], f["pt_att"], k=25.0),
            "p_gross": per_try(f["pt_yards"], f["pt_att"], k=25.0),
            "p_inside": per_try(f["pt_inside_20"], f["pt_att"], k=25.0),
        },
        index=f.index,
    )


def _standardized(features: pd.DataFrame, raw: pd.DataFrame) -> pd.DataFrame:
    groups = features["pos"] + "|" + features["season"].astype(str)
    active = features["games"] >= 1
    out = pd.DataFrame(index=features.index)
    for name in raw.columns:
        if name in LEVEL_MEASURES:
            out[name] = _zscore(raw[name], groups, active)
        elif name == "pay":
            # Only a deal the market struck after seeing the player play prices his quality; a
            # rookie-scale or UDFA deal is set by draft slot and is left blank here.
            market = raw[name].notna()
            pay_groups = groups + "|" + features["pay_group"].astype(str)
            out[name] = np.nan
            out.loc[market, name] = _rank_normal(raw.loc[market, name], pay_groups[market])
        else:
            out[name] = _rank_normal(raw[name], groups)
    return out


def _latent(
    features: pd.DataFrame, weights: dict[str, dict[str, float]] | None = None
) -> pd.Series:
    weights = weights or WEIGHTS
    scores = _standardized(features, measures(features))
    row_weights = pd.DataFrame(
        [weights[pos] for pos in features["pos"]], index=features.index
    ).fillna(0.0)
    scores = scores[row_weights.columns]

    # A tiny but non-empty sample is noise, not signal: pull what the player did back toward the
    # position mean. Zero games is not a small sample, it is an observation.
    games = features["games"]
    tiny = (games > 0) & (games < MIN_GAMES_FOR_FULL_WEIGHT)
    shrink = pd.Series(1.0, index=features.index)
    shrink[tiny] = games[tiny] / MIN_GAMES_FOR_FULL_WEIGHT
    evidence = [c for c in scores.columns if c != "pay"]
    produced = [c for c in evidence if c not in {"role", "avail", "unit"}]
    scores[produced] = scores[produced].mul(shrink, axis=0)

    # Rookie-scale pay prices what a team expected on draft night, not what the player has done in
    # the NFL; letting it count would leak draft slot into the hidden truth. A player on his entry
    # deal, or with no deal on record, is priced at what his own season would fetch on the market
    # (the market's typical response to that evidence), so he neither gains nor loses for it.
    if "pay" in scores.columns:
        own_weights = row_weights[evidence]
        own = (scores[evidence] * own_weights).sum(axis=1) / own_weights.sum(axis=1).replace(
            0.0, np.nan
        )
        scores["pay"] = scores["pay"].fillna(ENTRY_DEAL_PAY_SLOPE * own.fillna(0.0))

    total = row_weights.sum(axis=1).replace(0.0, np.nan)
    return ((scores * row_weights).sum(axis=1) / total).fillna(0.0)


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
    return value


def shrink_toward_prior(values: pd.DataFrame) -> pd.Series:
    """A season under four games leans on the player's own latest full season, if recent enough.

    Every season also carries `PRIOR_SEASON_GAMES` games' worth of that prior (the light blend
    HANDOFF §6.2 allows). Only seasons strictly before the one being rated are read, so neither
    rule ever looks ahead.
    """
    games = values["games"]
    played = games > 0
    full = values[games >= MIN_GAMES_FOR_FULL_WEIGHT][["gsis_id", "season", "true_value"]]
    candidates = (
        values.loc[played, ["gsis_id", "season"]]
        .reset_index()
        .merge(full, on="gsis_id", suffixes=("", "_prior"))
    )
    lag = candidates["season"] - candidates["season_prior"]
    candidates = candidates[(lag >= 1) & (lag <= PRIOR_LOOKBACK_SEASONS)]
    prior = candidates.sort_values("season_prior").groupby("index")["true_value"].last()

    sample = games[prior.index]
    own_weight = (sample / MIN_GAMES_FOR_FULL_WEIGHT).clip(0.0, 1.0)
    own_weight *= sample / (sample + PRIOR_SEASON_GAMES)
    out = values["true_value"].copy()
    out[prior.index] = own_weight * out[prior.index] + (1.0 - own_weight) * prior
    return out


def build_true_values(
    seasons: list[int],
    features: pd.DataFrame | None = None,
    weights: dict[str, dict[str, float]] | None = None,
) -> pd.DataFrame:
    if features is None:
        features = pd.concat([season_features(season) for season in seasons]).reset_index()
    features = features[features["season"].isin(seasons)].copy()
    features["latent"] = _latent(features, weights)
    features["true_value"] = value_from_latent(features)
    features["true_value"] = shrink_toward_prior(features).round(1)
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
