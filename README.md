# Gridiron GM

A browser-based NFL general-manager simulation with a twist: you take over a real team in a real season
(2010 onward), and **you know how every player's career actually turned out**. Everyone else in the
league — every AI front office — only knows what the scouting consensus believed at the time.

> **Unofficial fan-made project. Not affiliated with or endorsed by the NFL, its teams, or the NFLPA.
> Data courtesy of [nflverse](https://github.com/nflverse) (CC BY 4.0).**

## How it works

- Pick a start year, a team, and a horizon of *x* seasons. Win the Super Bowl before the horizon ends.
- Run the draft (real historical classes), free agency and trades; the season is simulated week by week
  from roster strength. You never play the games.
- Every rating you see is a **period-consensus scouting grade**. Underneath, real players develop along
  their **actual careers**. The AI drafts and trades off the consensus. Your edge is hindsight.
- Once the timeline runs past real history, draft classes and development are procedurally generated
  from distributions fit to 2010–present.
- Trades show an acceptance-likelihood bar; how stingy the AI is, is a setting you choose at game start.

## Status

Phase 0 — foundations. See `docs/HANDOFF.md` for the full brief and phase plan, `docs/DESIGN.md` for
the visual system, `docs/DATA_CONTRACT.md` and `docs/ENGINE_CONTRACT.md` for the interfaces.

## Repository

| Path | What |
|---|---|
| `app/` | Vite + React + TypeScript client. Pure, deterministic engine under `app/src/engine`; screens under `app/src/screens`. Saves live in IndexedDB. |
| `pipeline/` | Python/pandas pipeline: ingests nflverse releases, fits ratings/consensus/outcome models, exports JSON chunks to `app/public/data`. |
| `docs/` | Handoff brief, contracts, design system, decision log. |

## Development

```sh
pnpm install                      # app workspace
pnpm -r typecheck && pnpm -r test # app checks
cd pipeline && uv sync && uv run pytest -q
```

## License

Code: MIT (`LICENSE`). Data: nflverse, CC BY 4.0 (`DATA_LICENSE.md`). No player photos, no team logos,
no data or code from other games. Non-commercial.
