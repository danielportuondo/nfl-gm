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
"""

from __future__ import annotations

import logging

import pandas as pd

from gridiron_pipeline.ingest.load import load_injuries, load_weekly_roster
from gridiron_pipeline.model.data import load_snaps, load_stats_week

log = logging.getLogger(__name__)

PLAYOFF_END_WEEK = 22

PRESENT = "present"
INJURY = "injury"
SUSPENSION = "suspension"
OUT = "out"
_NEUTRAL = "neutral"
_UNKNOWN = "unknown"

# A full snapshot has at least this many ACT + INA rows per team-week (53 less the reserve lists).
FULL_SNAPSHOT_MIN_ACTIVE = 50
FULL_SNAPSHOT_MIN_SHARE = 0.9
SCRATCH_MAX_WEEKS_AT_EDGE = 1

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

    result: dict[str, list[dict]] = {}
    for gid in sorted(player_ids):
        by_week = kinds.get(gid, {})
        team_by_week = teams.get(gid, {})
        raw: dict[int, str | None] = {}
        for w in weeks:
            if w in by_week:
                kind = _best_kind(by_week[w])
                if kind == PRESENT and w in ruled_out.get(gid, ()):
                    kind = INJURY
                raw[w] = kind
                continue
            known = sorted(team_by_week)
            before = [k for k in known if k < w]
            nearest = before[-1] if before else (known[0] if known else None)
            team = team_by_week[nearest] if nearest is not None else None
            on_bye = team is not None and w not in game_weeks.get(team, set())
            if w in ruled_out.get(gid, ()):
                raw[w] = INJURY
            else:
                raw[w] = None if on_bye else _UNKNOWN
        resolved = _fill_gaps(_resolve_unknown(raw, weeks, complete_snapshot), weeks)
        for w in weeks:
            if (gid, w) in played:
                resolved[w] = PRESENT
        ranges = _to_ranges(resolved, weeks)
        if ranges and ranges[-1]["to"] == regular_weeks and gid not in active_post:
            ranges[-1]["to"] = PLAYOFF_END_WEEK
        if ranges:
            result[gid] = ranges
    return result


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


def attach_absences(players_obj: dict, season: int, games: pd.DataFrame) -> None:
    """Add `absences` to every player of a season chunk who really missed regular-season weeks."""
    roster = load_weekly_roster(season)
    reg = games[(games["season"] == season) & (games["game_type"] == "REG")]
    if roster is None or reg.empty:
        log.warning("season %d: no weekly roster; players carry no absences", season)
        return
    regular_weeks = int(reg["week"].max())
    ids = {p["id"] for p in players_obj["players"]}
    found = derive_absences(
        roster,
        load_injuries(season),
        team_game_weeks(games, season),
        regular_weeks,
        ids,
        complete_snapshot=snapshot_is_complete(roster),
        played=played_weeks(season),
    )
    for player in players_obj["players"]:
        ranges = found.get(player["id"])
        if ranges:
            player["absences"] = ranges
