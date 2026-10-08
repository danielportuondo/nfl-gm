"""Regular-season weeks each player really missed, as announced ranges (`absences` in players.json).

Source is the weekly roster snapshot (`roster_weekly_{season}.csv`) plus the injury report. A week
counts as missed when the player is not available for his team:

- `injury`: reserve / PUP / non-football-injury status, or ACT but ruled "Out" on the injury report.
- `suspension`: suspended or on an exempt list.
- `out`: on no NFL roster that week, or on the practice squad (a game-day stand-in the sim has no
  slot for, so it reads as out of football), or cut/released/unsigned.

A healthy scratch (ACT or INA with no injury designation) is not an absence. A bye (the player's
team had no game) is not an absence either: it takes its neighbours' status, so one injury run spans
the bye instead of splitting in two.

Seasons before 2016 carry only the game-day active list (about 47 players a team a week), so a
healthy scratch has no row at all. There a no-row run between two active weeks reads as a scratch
(a player cut and re-signed shows a CUT row, which is out), and one at the edge of the season reads
as a scratch only for a single week. From 2016 the snapshot holds the whole 53, inactive players
included, and no row means no roster.

A run that is still open in the last regular-season week, for a player with no active postseason
row, is extended to `PLAYOFF_END_WEEK`: the engine reads `to > regular-season weeks` as "through the
playoffs" (an injured-reserve player does not come back for January in the sim either).

`benched` marks a healthy consensus starter who really sat (RG3 behind Cousins in 2015). Per team
and game week, the available players at a position are ranked by preseason consensus; one of the
top `STARTER_TEMPLATE[pos]` is benched when he took no snap on offense or defense (a starter hurt
early in a game took some, and is not benched) while a teammate at his position ranked below him by
consensus took at least
`BENCH_STARTER_MIN_SHARE`, i.e. the real starter sat behind him on paper. Ordinary backups never
rank in the top slots, so they are never flagged. A starter on that week's injury report who sat is
an injury week instead, and resting in the final regular-season week alone is not a benching. Snap
counts start in 2012; before that only quarterbacks are judged, by share of team pass attempts.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import pandas as pd

from gridiron_pipeline.ingest.load import load_injuries, load_weekly_roster
from gridiron_pipeline.model.data import load_snaps, load_stats_week
from gridiron_pipeline.model.validate import STARTER_TEMPLATE

log = logging.getLogger(__name__)

PLAYOFF_END_WEEK = 22

PRESENT = "present"
INJURY = "injury"
SUSPENSION = "suspension"
OUT = "out"
BENCHED = "benched"
_NEUTRAL = "neutral"
_UNKNOWN = "unknown"

# A full snapshot has at least this many ACT + INA rows per team-week (53 less the reserve lists).
FULL_SNAPSHOT_MIN_ACTIVE = 50
FULL_SNAPSHOT_MIN_SHARE = 0.9
SCRATCH_MAX_WEEKS_AT_EDGE = 1

BENCH_STARTER_MIN_SHARE = 0.40
BENCH_POSITIONS = tuple(p for p in STARTER_TEMPLATE if p not in ("K", "P"))


@dataclass(frozen=True)
class BenchInputs:
    """What the benched rule needs: who the consensus starters were and who really played."""

    consensus: dict[str, tuple[str, float]]  # gsis_id -> (position, preseason consensus ovr)
    share: dict[tuple[str, int], float]  # (gsis_id, week) -> share of his unit's snaps
    reported: frozenset[tuple[str, int]] = field(default_factory=frozenset)  # on the injury report
    positions: tuple[str, ...] = BENCH_POSITIONS


_STATUS_KIND: dict[str, str] = {
    "ACT": PRESENT,
    "INA": PRESENT,
    "RES": INJURY,
    "PUP": INJURY,
    "RSN": INJURY,
    "SUS": SUSPENSION,
    "EXE": SUSPENSION,
    "E01": SUSPENSION,
    "E14": SUSPENSION,
    "TRC": _NEUTRAL,
    "TRD": _NEUTRAL,
    "TRT": _NEUTRAL,
}
# Anything else (CUT, DEV, NWT, RET, RSR, UFA, RFA, UDF, no row at all) is out of football.
_KIND_RANK = {PRESENT: 0, _NEUTRAL: 1, INJURY: 2, SUSPENSION: 3, OUT: 4}


def _kind_of(status: object) -> str:
    return _STATUS_KIND.get(str(status), OUT)


def _best_kind(kinds: list[str]) -> str:
    """Several rows in one week (a trade): the player is as available as his best row."""
    return min(kinds, key=lambda k: _KIND_RANK[k])


def _fill_gaps(kinds: dict[int, str | None], weeks: range) -> dict[int, str]:
    """Replace bye / transaction-only weeks (None or neutral) with a neighbour's status."""
    played = [w for w in weeks if kinds.get(w) not in (None, _NEUTRAL)]
    out: dict[int, str] = {}
    for w in weeks:
        k = kinds.get(w)
        if k not in (None, _NEUTRAL):
            out[w] = k  # type: ignore[assignment]
            continue
        before = [p for p in played if p < w]
        after = [p for p in played if p > w]
        prev = kinds[before[-1]] if before else None
        nxt = kinds[after[0]] if after else None
        if PRESENT in (prev, nxt):
            out[w] = PRESENT
        else:
            out[w] = prev or nxt or OUT  # type: ignore[assignment]
    return out


def _settle_run(left: str | None, right: str | None, length: int, complete: bool) -> str:
    """What a run of no-row weeks was, given the definite status on each side (None = season edge).

    A gap inside one injury or suspension is that injury or suspension (the weekly snapshot misses
    reserve-list rows). Past that, a complete snapshot means no row, no roster; a partial one
    (see the module docstring) reads a run between two active weeks as a scratch.
    """
    listed = (INJURY, SUSPENSION)
    if left == right and left in listed:
        return left  # type: ignore[return-value]
    if complete:
        return OUT
    if left == PRESENT and right == PRESENT:
        return PRESENT
    if PRESENT in (left, right) and None in (left, right):
        return PRESENT if length <= SCRATCH_MAX_WEEKS_AT_EDGE else OUT
    for side in (left, right):
        if side in listed:
            return side  # type: ignore[return-value]
    return OUT


def _resolve_unknown(
    kinds: dict[int, str | None], weeks: range, complete: bool
) -> dict[int, str | None]:
    """Settle each maximal run of no-row weeks (byes inside it do not break it)."""
    out = dict(kinds)
    ws = list(weeks)
    skip = (None, _NEUTRAL)
    i = 0
    while i < len(ws):
        if out[ws[i]] != _UNKNOWN:
            i += 1
            continue
        j = i
        while j + 1 < len(ws) and out[ws[j + 1]] in (_UNKNOWN, *skip):
            j += 1
        run = [w for w in ws[i : j + 1] if out[w] == _UNKNOWN]
        left = next((out[w] for w in reversed(ws[:i]) if out[w] not in skip), None)
        right = next((out[w] for w in ws[j + 1 :] if out[w] not in skip), None)
        kind = _settle_run(left, right, len(run), complete)
        for w in run:
            out[w] = kind
        i = j + 1
    return out


def snapshot_is_complete(roster: pd.DataFrame) -> bool:
    """True when the weekly roster lists every player on the 53, inactive scratches included."""
    reg = roster[(roster["game_type"] == "REG") & roster["status"].isin(["ACT", "INA"])]
    per_team_week = reg.groupby(["team", "week"]).size()
    if per_team_week.empty:
        return False
    return float((per_team_week >= FULL_SNAPSHOT_MIN_ACTIVE).mean()) >= FULL_SNAPSHOT_MIN_SHARE


def team_game_weeks(games: pd.DataFrame, season: int) -> dict[str, set[int]]:
    """team -> regular-season weeks in which it had a game."""
    reg = games[(games["season"] == season) & (games["game_type"] == "REG")]
    weeks: dict[str, set[int]] = {}
    for team_col in ("home_team", "away_team"):
        for team, week in zip(reg[team_col], reg["week"], strict=True):
            weeks.setdefault(str(team), set()).add(int(week))
    return weeks


def derive_absences(
    roster: pd.DataFrame,
    injuries: pd.DataFrame | None,
    game_weeks: dict[str, set[int]],
    regular_weeks: int,
    player_ids: set[str],
    complete_snapshot: bool = True,
    played: frozenset[tuple[str, int]] = frozenset(),
    bench: BenchInputs | None = None,
) -> dict[str, list[dict]]:
    """gsis_id -> absence ranges `{from, to, reason}` for the ids that missed at least one week."""
    weeks = range(1, regular_weeks + 1)
    reg = roster[roster["game_type"] == "REG"]
    post = roster[roster["game_type"] != "REG"]
    active_post = set(post[post["status"] == "ACT"]["gsis_id"].dropna())

    kinds: dict[str, dict[int, list[str]]] = {}
    teams: dict[str, dict[int, str]] = {}
    for gid, week, status, team in zip(
        reg["gsis_id"], reg["week"], reg["status"], reg["team"], strict=True
    ):
        if gid not in player_ids or pd.isna(week):
            continue
        kinds.setdefault(gid, {}).setdefault(int(week), []).append(_kind_of(status))
        teams.setdefault(gid, {})[int(week)] = str(team)

    ruled_out: dict[str, set[int]] = {}
    if injuries is not None:
        inj = injuries[(injuries["game_type"] == "REG") & (injuries["report_status"] == "Out")]
        for gid, week in zip(inj["gsis_id"], inj["week"], strict=True):
            if gid in player_ids and not pd.isna(week):
                ruled_out.setdefault(gid, set()).add(int(week))

    resolved_by_player: dict[str, dict[int, str]] = {}
    team_at: dict[str, dict[int, str | None]] = {}
    for gid in sorted(player_ids):
        by_week = kinds.get(gid, {})
        team_by_week = teams.get(gid, {})
        known = sorted(team_by_week)
        raw: dict[int, str | None] = {}
        team_at[gid] = {}
        for w in weeks:
            before = [k for k in known if k <= w]
            nearest = before[-1] if before else (known[0] if known else None)
            team = team_by_week[nearest] if nearest is not None else None
            team_at[gid][w] = team
            if w in by_week:
                kind = _best_kind(by_week[w])
                if kind == PRESENT and w in ruled_out.get(gid, ()):
                    kind = INJURY
                raw[w] = kind
                continue
            on_bye = team is not None and w not in game_weeks.get(team, set())
            if w in ruled_out.get(gid, ()):
                raw[w] = INJURY
            else:
                raw[w] = None if on_bye else _UNKNOWN
        resolved = _fill_gaps(_resolve_unknown(raw, weeks, complete_snapshot), weeks)
        for w in weeks:
            if (gid, w) in played:
                resolved[w] = PRESENT
        resolved_by_player[gid] = resolved

    if bench is not None:
        _mark_benched(resolved_by_player, team_at, game_weeks, regular_weeks, bench)

    result: dict[str, list[dict]] = {}
    for gid in sorted(player_ids):
        ranges = _to_ranges(resolved_by_player[gid], weeks)
        # A benched starter is usually dressed in January too, so his active row says nothing.
        last = ranges[-1] if ranges else None
        if last and last["to"] == regular_weeks:
            if gid not in active_post or last["reason"] == BENCHED:
                last["to"] = PLAYOFF_END_WEEK
        if ranges:
            result[gid] = ranges
    return result


def _mark_benched(
    resolved: dict[str, dict[int, str]],
    team_at: dict[str, dict[int, str | None]],
    game_weeks: dict[str, set[int]],
    regular_weeks: int,
    bench: BenchInputs,
) -> None:
    """Present weeks a healthy consensus starter really sat become `benched` (see module doc)."""
    sat: dict[str, set[int]] = {}
    for week in range(1, regular_weeks + 1):
        groups: dict[tuple[str, str], list[str]] = {}
        for gid in sorted(resolved):
            team = team_at[gid][week]
            info = bench.consensus.get(gid)
            if team is None or info is None or resolved[gid][week] != PRESENT:
                continue
            if week not in game_weeks.get(team, set()) or info[0] not in bench.positions:
                continue
            groups.setdefault((team, info[0]), []).append(gid)
        for (_, pos), ids in sorted(groups.items()):
            ranked = sorted(ids, key=lambda g: (-bench.consensus[g][1], g))
            slots = STARTER_TEMPLATE[pos]
            starters, below = ranked[:slots], ranked[slots:]
            if not any(bench.share.get((g, week), 0.0) >= BENCH_STARTER_MIN_SHARE for g in below):
                continue
            for gid in starters:
                if bench.share.get((gid, week), 0.0) <= 0.0:
                    sat.setdefault(gid, set()).add(week)

    for gid, weeks_sat in sorted(sat.items()):
        final_team = team_at[gid][regular_weeks] or ""
        team_games = sorted(w for w in game_weeks.get(final_team, set()) if w <= regular_weeks)
        if len(team_games) >= 2:
            last, before_last = team_games[-1], team_games[-2]
            if last in weeks_sat and before_last not in weeks_sat:
                weeks_sat = weeks_sat - {last}
        for week in sorted(weeks_sat):
            resolved[gid][week] = INJURY if (gid, week) in bench.reported else BENCHED
        _bridge_byes(resolved[gid], team_at[gid], game_weeks, regular_weeks)


def _bridge_byes(
    resolved: dict[int, str],
    team_at: dict[int, str | None],
    game_weeks: dict[str, set[int]],
    regular_weeks: int,
) -> None:
    """A bye between two benched weeks is benched too, so one benching reads as one range."""
    for week in range(2, regular_weeks):
        team = team_at[week]
        on_bye = team is not None and week not in game_weeks.get(team, set())
        if on_bye and resolved[week - 1] == BENCHED == resolved[week + 1]:
            resolved[week] = BENCHED


def _to_ranges(resolved: dict[int, str], weeks: range) -> list[dict]:
    ranges: list[dict] = []
    for w in weeks:
        kind = resolved[w]
        if kind == PRESENT:
            continue
        last = ranges[-1] if ranges else None
        if last and last["to"] == w - 1 and last["reason"] == kind:
            last["to"] = w
        else:
            ranges.append({"from": w, "to": w, "reason": kind})
    return ranges


def played_weeks(season: int) -> frozenset[tuple[str, int]]:
    """(gsis_id, week) pairs in which the player recorded a stat or took a snap."""
    stats = load_stats_week(season)
    pairs = set(zip(stats["gsis_id"], stats["week"].astype(int), strict=True))
    snaps = load_snaps(season)
    if not snaps.empty:
        pct = snaps[["offense_pct", "defense_pct", "st_pct"]].fillna(0).sum(axis=1)
        taken = snaps[pct > 0]
        pairs |= set(zip(taken["gsis_id"], taken["week"].astype(int), strict=True))
    return frozenset(pairs)


def unit_snap_share(season: int) -> dict[tuple[str, int], float]:
    """(gsis_id, week) -> share of his unit's snaps; before snap counts, QB share of attempts."""
    snaps = load_snaps(season)
    if not snaps.empty:
        pct = snaps[["offense_pct", "defense_pct"]].fillna(0).max(axis=1)
        return {
            (gid, int(week)): float(p)
            for gid, week, p in zip(snaps["gsis_id"], snaps["week"], pct, strict=True)
        }
    stats = load_stats_week(season)
    qbs = stats[stats["position"] == "QB"]
    team_attempts = qbs.groupby(["team", "week"])["attempts"].transform("sum")
    share = (qbs["attempts"] / team_attempts.where(team_attempts > 0)).fillna(0)
    return {
        (gid, int(week)): float(s)
        for gid, week, s in zip(qbs["gsis_id"], qbs["week"], share, strict=True)
    }


def bench_inputs(players_obj: dict, season: int, injuries: pd.DataFrame | None) -> BenchInputs:
    consensus = {
        p["id"]: (p["pos"], float(p["scouting"]["ovr"]))
        for p in players_obj["players"]
        if p.get("scouting")
    }
    reported: frozenset[tuple[str, int]] = frozenset()
    if injuries is not None:
        listed = injuries[(injuries["game_type"] == "REG") & injuries["report_status"].notna()]
        reported = frozenset(
            (gid, int(week))
            for gid, week in zip(listed["gsis_id"], listed["week"], strict=True)
            if not pd.isna(week)
        )
    has_snaps = not load_snaps(season).empty
    return BenchInputs(
        consensus=consensus,
        share=unit_snap_share(season),
        reported=reported,
        positions=BENCH_POSITIONS if has_snaps else ("QB",),
    )


def attach_absences(players_obj: dict, season: int, games: pd.DataFrame) -> None:
    """Add `absences` to every player of a season chunk who really missed regular-season weeks."""
    roster = load_weekly_roster(season)
    reg = games[(games["season"] == season) & (games["game_type"] == "REG")]
    if roster is None or reg.empty:
        log.warning("season %d: no weekly roster; players carry no absences", season)
        return
    regular_weeks = int(reg["week"].max())
    ids = {p["id"] for p in players_obj["players"]}
    injuries = load_injuries(season)
    found = derive_absences(
        roster,
        injuries,
        team_game_weeks(games, season),
        regular_weeks,
        ids,
        complete_snapshot=snapshot_is_complete(roster),
        played=played_weeks(season),
        bench=bench_inputs(players_obj, season, injuries),
    )
    for player in players_obj["players"]:
        ranges = found.get(player["id"])
        if ranges:
            player["absences"] = ranges
