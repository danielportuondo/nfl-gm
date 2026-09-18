# Data license and attribution

All real-world football data in this repository — players, rosters, draft classes, schedules, results,
snap counts, injuries, combine results, contracts, and team names/colors — is derived from the
**nflverse** project and is used under the
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) license.

- Source: https://github.com/nflverse/nflverse-data and https://github.com/nflverse/nfldata
- Attribution: **Data courtesy of nflverse (CC BY 4.0).**
- Changes: the pipeline in `pipeline/` aggregates weekly stats to seasons, collapses positions into
  position groups, canonicalizes franchise codes across relocations, synthesizes ratings, consensus
  scouting grades, contracts and outcome distributions, and exports compact JSON to `app/public/data/`.
  Every exported file carries an `attribution` field.

What we deliberately do **not** ship: player photographs (`headshot_url` is dropped at ingest), official
team logos or wordmarks (URL columns are dropped; only team names, cities and colors are used), and any
data or code from other games.

Gridiron GM is an unofficial fan-made project. It is not affiliated with or endorsed by the NFL, its
teams, or the NFLPA. Non-commercial: no ads, no payments.

The game's source code is licensed separately under the MIT license (see `LICENSE`).
