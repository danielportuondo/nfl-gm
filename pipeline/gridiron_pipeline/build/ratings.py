"""Consensus scouting + true value per player-season.

Reads ratings-model's outputs (`pipeline/.cache/model/{true_values,consensus}.parquet`) when
present. When absent, `--allow-placeholder-ratings` must be passed and a loud warning is logged;
placeholders are derived from depth order alone (starter 70, backups descending to 45) — never
from anything resembling a real outcome.
"""

from __future__ import annotations

import hashlib
import logging

import pandas as pd

from gridiron_pipeline import CACHE_DIR
from gridiron_pipeline.model.data import availability

log = logging.getLogger(__name__)

MODEL_DIR = CACHE_DIR / "model"


def _jitter(gsis_id: str, season: int, spread: float) -> float:
    """Deterministic pseudo-random value in [-spread, spread] from (id, season)."""
    h = hashlib.sha256(f"{gsis_id}:{season}".encode()).digest()
    unit = int.from_bytes(h[:4], "big") / 2**32  # [0, 1)
    return (unit * 2 - 1) * spread


def _clip(v: float) -> float:
    return max(40.0, min(99.0, v))


class Ratings:
    def __init__(self, allow_placeholder: bool):
        self.allow_placeholder = allow_placeholder
        self._consensus = self._load(MODEL_DIR / "consensus.parquet")
        self._true_values = self._load(MODEL_DIR / "true_values.parquet")
        if self._consensus is None or self._true_values is None:
            if not allow_placeholder:
                raise RuntimeError(
                    "ratings-model outputs not found in pipeline/.cache/model/ "
                    "(true_values.parquet, consensus.parquet). Pass --allow-placeholder-ratings "
                    "to build with depth-order placeholders instead."
                )
            log.warning(
                "!!! ratings-model outputs missing — using PLACEHOLDER ovr/pot/trueValue "
                "derived from depth order only. Not real ratings. !!!"
            )
        self._consensus_idx = (
            {(r.gsis_id, r.season): r for r in self._consensus.itertuples()}
            if self._consensus is not None
            else {}
        )
        self._true_idx = (
            {(r.gsis_id, r.season): r.true_value for r in self._true_values.itertuples()}
            if self._true_values is not None
            else {}
        )
        self._availability, self._last_played, self.latest_season = self._real_participation()

    def _real_participation(
        self,
    ) -> tuple[dict[tuple[str, int], float], dict[str, int], int | None]:
        """Share of the season each player was on the field, and the last season he played at all.

        Both come from the model's `games` column, i.e. real participation, never from roster
        snapshots (which keep camp bodies and players who retired in August).
        """
        if self._true_values is None:
            return {}, {}, None
        tv = self._true_values
        avail = availability(tv)
        by_season = {
            (gsis_id, int(season)): float(a)
            for gsis_id, season, a in zip(tv["gsis_id"], tv["season"], avail, strict=True)
        }
        last_played = tv[tv["games"] > 0].groupby("gsis_id")["season"].max()
        return by_season, {g: int(s) for g, s in last_played.items()}, int(tv["season"].max())

    def availability(self, gsis_id: str, season: int) -> float | None:
        return self._availability.get((gsis_id, season))

    def retired_before(self, gsis_id: str, season: int) -> bool:
        """True when the player never takes the field in `season` or later (real data only).

        Always False for the last real season: nobody has a future yet, so "never again" is unknown.
        """
        if self.latest_season is None or season >= self.latest_season:
            return False
        if (gsis_id, season) not in self._availability:
            return False  # unrated: no evidence either way
        return self._last_played.get(gsis_id, 0) < season

    @staticmethod
    def _load(path) -> pd.DataFrame | None:
        if not path.exists():
            return None
        return pd.read_parquet(path)

    def _placeholder_scouting(
        self, gsis_id: str, season: int, depth: int | None, rookie: bool
    ) -> dict:
        base = 70.0 if depth == 1 else max(45.0, 70.0 - 5.0 * ((depth or 4) - 1))
        ovr = _clip(base + _jitter(gsis_id, season, 3.0))
        pot = _clip(ovr + (10.0 if rookie else 2.0) + _jitter(gsis_id, season + 1, 2.0))
        confidence = 0.3 if rookie else 0.75
        return {"ovr": round(ovr, 1), "pot": round(pot, 1), "confidence": confidence}

    def for_player_season(
        self, gsis_id: str, season: int, pos_group: str, depth: int | None, rookie: bool
    ) -> tuple[dict, float]:
        row = self._consensus_idx.get((gsis_id, season))
        if row is not None:
            scouting = {
                "ovr": round(float(row.ovr), 1),
                "pot": round(float(row.pot), 1),
                "confidence": round(float(row.confidence), 2),
            }
        else:
            scouting = self._placeholder_scouting(gsis_id, season, depth, rookie)

        true_value = self._true_idx.get((gsis_id, season))
        if true_value is None:
            true_value = scouting["ovr"]
        return scouting, round(float(_clip(true_value)), 1)

    def prospect_scouting(self, gsis_id: str, draft_season: int, round_: int, pick: int) -> dict:
        """Pre-draft consensus for a prospect (slot/combine/age only, never real future)."""
        row = self._consensus_idx.get((gsis_id, draft_season))
        if row is not None:
            return {
                "ovr": round(float(row.ovr), 1),
                "pot": round(float(row.pot), 1),
                "confidence": round(float(row.confidence), 2),
            }
        # Placeholder: slot-based grade, higher picks graded higher, first-round tighter spread.
        base = 68.0 - 0.09 * pick
        ovr = _clip(base + _jitter(gsis_id, draft_season, 3.0))
        pot = _clip(ovr + 8.0 + _jitter(gsis_id, draft_season + 1, 3.0))
        return {"ovr": round(ovr, 1), "pot": round(pot, 1), "confidence": 0.2}

    def udfa_scouting(self, gsis_id: str, season: int) -> dict:
        row = self._consensus_idx.get((gsis_id, season))
        if row is not None:
            return {
                "ovr": round(float(row.ovr), 1),
                "pot": round(float(row.pot), 1),
                "confidence": round(float(row.confidence), 2),
            }
        ovr = _clip(42.0 + _jitter(gsis_id, season, 2.0))
        pot = _clip(ovr + 5.0 + _jitter(gsis_id, season + 1, 3.0))
        return {"ovr": round(ovr, 1), "pot": round(pot, 1), "confidence": 0.1}
