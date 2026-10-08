"""Real absences by week: reasons, byes, scratches, benched starters and the playoff extension."""

from __future__ import annotations

import pandas as pd

from gridiron_pipeline.build.absences import PLAYOFF_END_WEEK, BenchInputs, derive_absences

WEEKS = 10
BYE = 5
GAME_WEEKS = {"AAA": {w for w in range(1, WEEKS + 1) if w != BYE}}


def roster_rows(gsis_id: str, statuses: dict[int, str], team: str = "AAA", post: str | None = None):
    rows = [
        {"gsis_id": gsis_id, "week": w, "status": s, "team": team, "game_type": "REG"}
        for w, s in statuses.items()
    ]
    if post:
        wild_card = {"gsis_id": gsis_id, "week": 11, "status": post, "team": team}
        rows.append({**wild_card, "game_type": "WC"})
    return rows


def absences(
    rows: list[dict],
    injuries: list[dict] | None = None,
    ids: set[str] | None = None,
    complete: bool = True,
    played: frozenset[tuple[str, int]] = frozenset(),
):
    inj = (
        pd.DataFrame(injuries, columns=["gsis_id", "week", "game_type", "report_status"])
        if injuries is not None
        else None
    )
    return derive_absences(
        pd.DataFrame(rows, columns=["gsis_id", "week", "status", "team", "game_type"]),
        inj,
        GAME_WEEKS,
        WEEKS,
        ids or {r["gsis_id"] for r in rows},
        complete_snapshot=complete,
        played=played,
    )


def test_reserve_run_is_one_injury_range_across_the_bye():
    statuses = {w: "ACT" for w in range(1, 4)} | {w: "RES" for w in (4, 6, 7, 8, 9, 10)}
    out = absences(roster_rows("p1", statuses, post="ACT"))
    assert out["p1"] == [{"from": 4, "to": 10, "reason": "injury"}]


def test_season_ending_run_extends_through_the_playoffs_unless_he_is_back_in_january():
    statuses = {w: "ACT" for w in range(1, 7)} | {w: "RES" for w in range(7, 11)}
    out = absences(roster_rows("p1", statuses))
    assert out["p1"] == [{"from": 7, "to": PLAYOFF_END_WEEK, "reason": "injury"}]
    back = absences(roster_rows("p2", statuses, post="ACT"))
    assert back["p2"] == [{"from": 7, "to": 10, "reason": "injury"}]


def test_a_bye_is_not_an_absence_and_a_healthy_scratch_is_not_either():
    statuses = {w: "ACT" for w in range(1, 11) if w != BYE} | {3: "INA"}
    assert absences(roster_rows("p1", statuses, post="ACT")) == {}


def test_ruled_out_on_the_report_while_active_is_an_injury_week():
    statuses = {w: "ACT" for w in range(1, 11) if w != BYE}
    out = absences(
        roster_rows("p1", statuses, post="ACT"),
        injuries=[{"gsis_id": "p1", "week": 3, "game_type": "REG", "report_status": "Out"}],
    )
    assert out["p1"] == [{"from": 3, "to": 3, "reason": "injury"}]


def test_suspension_and_practice_squad_and_unsigned_weeks_get_their_own_reasons():
    sus = {w: "SUS" for w in range(1, 4)} | {w: "ACT" for w in range(4, 11) if w != BYE}
    out = absences(roster_rows("sus", sus, post="ACT"))
    assert out["sus"] == [{"from": 1, "to": 3, "reason": "suspension"}]

    late = {w: "DEV" for w in range(1, 5)} | {w: "ACT" for w in range(6, 11)}
    out = absences(roster_rows("ps", late, post="ACT"))
    assert out["ps"] == [{"from": 1, "to": 4, "reason": "out"}]

    nobody = absences([], ids={"ghost"})
    assert nobody["ghost"] == [{"from": 1, "to": PLAYOFF_END_WEEK, "reason": "out"}]


def test_only_known_players_are_returned():
    statuses = {w: "RES" for w in range(1, 11)}
    out = absences(roster_rows("p1", statuses) + roster_rows("p9", statuses), ids={"p1"})
    assert set(out) == {"p1"}


def test_partial_snapshot_reads_a_gap_between_active_weeks_as_a_scratch():
    scratched = {w: "ACT" for w in (1, 2, 9, 10)}
    assert absences(roster_rows("p1", scratched, post="ACT"), complete=False) == {}
    cut = {w: "ACT" for w in range(1, 5)}
    out = absences(roster_rows("p2", cut), complete=False)
    assert out["p2"] == [{"from": 6, "to": PLAYOFF_END_WEEK, "reason": "out"}]
    signed_late = {w: "ACT" for w in range(7, 11)}
    late = absences(roster_rows("p3", signed_late, post="ACT"), complete=False)
    assert late["p3"] == [{"from": 1, "to": 6, "reason": "out"}]
    cut_and_resigned = {1: "ACT", 2: "ACT", 3: "CUT", 4: "CUT", 9: "ACT", 10: "ACT"}
    back = absences(roster_rows("p4", cut_and_resigned, post="ACT"), complete=False)
    assert back["p4"] == [{"from": 3, "to": 8, "reason": "out"}]


def test_a_gap_in_the_reserve_list_rows_is_still_the_same_injury():
    statuses = {1: "ACT", 2: "ACT", 3: "RES", 4: "RES", 9: "RES", 10: "RES"}
    for complete in (True, False):
        out = absences(roster_rows("p1", statuses, post="ACT"), complete=complete)
        assert out["p1"] == [{"from": 3, "to": 10, "reason": "injury"}]


def test_a_week_with_a_stat_line_or_snaps_is_never_an_absence():
    statuses = {w: "ACT" for w in range(1, 4)} | {w: "RES" for w in range(4, 11)}
    out = absences(
        roster_rows("p1", statuses, post="ACT"),
        played=frozenset({("p1", 4), ("p1", 6)}),
    )
    assert out["p1"] == [
        {"from": 5, "to": 5, "reason": "injury"},
        {"from": 7, "to": 10, "reason": "injury"},
    ]


def qb_room(star_share: float, starter_share: float = 1.0, reported=frozenset()):
    """A 72 who sits behind a 65, with a 50 third-stringer who never plays."""
    present = {w: "ACT" for w in range(1, WEEKS + 1) if w != BYE}
    rows = [
        row for gid in ("star", "real", "third") for row in roster_rows(gid, present, post="ACT")
    ]
    consensus = {"star": ("QB", 72.0), "real": ("QB", 65.0), "third": ("QB", 50.0)}
    share = {
        (gid, w): s for w in present for gid, s in (("star", star_share), ("real", starter_share))
    }
    return rows, BenchInputs(consensus=consensus, share=share, reported=reported)


def with_bench(rows: list[dict], bench: BenchInputs):
    return derive_absences(
        pd.DataFrame(rows, columns=["gsis_id", "week", "status", "team", "game_type"]),
        None,
        GAME_WEEKS,
        WEEKS,
        {r["gsis_id"] for r in rows},
        bench=bench,
    )


def test_a_healthy_consensus_starter_who_sat_behind_the_real_starter_is_benched():
    out = with_bench(*qb_room(star_share=0.0))
    # Dressed for the playoffs says nothing about playing, so the benching runs through January.
    assert out == {"star": [{"from": 1, "to": PLAYOFF_END_WEEK, "reason": "benched"}]}


def test_ordinary_backups_are_never_benched():
    assert with_bench(*qb_room(star_share=1.0, starter_share=0.0)) == {}


def test_a_starter_on_the_injury_report_who_sat_is_hurt_not_benched():
    out = with_bench(*qb_room(star_share=0.0, reported=frozenset({("star", 3)})))
    assert out["star"] == [
        {"from": 1, "to": 2, "reason": "benched"},
        {"from": 3, "to": 3, "reason": "injury"},
        {"from": 4, "to": PLAYOFF_END_WEEK, "reason": "benched"},
    ]


def test_resting_in_the_final_week_alone_is_not_a_benching():
    rows, bench = qb_room(star_share=1.0)
    share = bench.share | {("star", WEEKS): 0.0}
    rested = BenchInputs(consensus=bench.consensus, share=share)
    assert with_bench(rows, rested) == {}
