# gridiron-pipeline

Python/pandas pipeline: downloads and caches nflverse releases (`.cache/`, gitignored), builds
the ratings / consensus / outcome-distribution models, and exports JSON chunks to
`../app/public/data/`, validated against the JSON Schemas in `../app/src/contracts/schemas/`.

Data courtesy of nflverse (CC BY 4.0). See `../DATA_LICENSE.md`.

```
uv sync
uv run pytest -q
make data        # full build (idempotent; never re-downloads cached files)
```
