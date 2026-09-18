# gridiron-pipeline

Python/pandas pipeline: downloads and caches nflverse releases (`.cache/`, gitignored), builds
the ratings / consensus / outcome-distribution models, and exports JSON chunks to
`../app/public/data/`, validated against the JSON Schemas in `../app/src/contracts/schemas/`.

Data courtesy of nflverse (CC BY 4.0). See `../DATA_LICENSE.md`.

```
uv sync
uv run pytest -q
make data                  # full build, seasons 2010-2025 (idempotent; never re-downloads cached files)
make data SEASONS=2015     # fast single-season path, for iteration
uv run python -m gridiron_pipeline validate   # schema + gzipped size budget check over app/public/data
```

`make data` builds with `--allow-placeholder-ratings`: when `pipeline/.cache/model/{true_values,
consensus}.parquet` (written by the ratings-model pipeline) are absent, `ovr`/`pot`/`trueValue`
fall back to a depth-order placeholder (starter 70, backups descending) and a loud warning is
logged. Once those parquet files exist, the same command picks up the real ratings automatically.

Unmatched ids (nflverse rows that couldn't be resolved to a `gsis_id`) are logged per season to
`.cache/unmatched_{season}.csv`; the pipeline never blocks on 100% matching.
