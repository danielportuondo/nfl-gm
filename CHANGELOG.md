# Changelog

All notable changes to Gridiron GM. Dates are build dates; the project was built in six phases on 2026-09-17/18
(see `docs/HANDOFF.md` for the plan and `docs/DECISIONS.md` for what was decided along the way).

## 1.0.0 — 2026-09-18

First complete release: a browser NFL general-manager sim with a hindsight twist. Start in any season 2010–2025
with any team and a 1–10 season horizon; the league knows only the consensus of its time, the sim knows what
really happened.

### Added
- Season awards on the recap: passing, rushing and receiving leaders, touchdowns, sacks and interceptions,
  computed from the season's box scores.
- Trade counters. When the AI declines but one more asset would close the gap, its counter appears under
  incoming offers and can be accepted from there.
- Playthrough screenshots (dashboard, trade, recap, report card) in the README.

### Fixed
- Real salaries were missing from every season (a dollars-vs-millions unit slip when the contracts source
  moved to the daily parquet); rosters now carry recorded salaries where nflverse has them and league payroll
  sits at 89–92 % of the cap instead of 73–77 %.
- Players drafted before 2010 were priced off the 2025 cap; the cap lookup now uses the earliest known cap for
  seasons before the table.
- Post-2011 rookie deals were about twice the real scale; the top of the scale is era-aware.
- AI teams at the cap past the data could end the preseason under the 46-man minimum; they now reach the
  floor with minimum deals and swap salary out until legal.
- The same trade package could be re-offered until a coin flip landed; the roll is now seeded by the package.
- The calibration harness now applies injuries between weeks like the season loop does.
- The expiring-contracts alert pointed at Finances; re-signing lives in Free agency.

### Balance (Phase 5)
- Game-strength scale, injury rate, overtime and one-point windows, future-pick discount, free-agent
  acceptance curve and rookie guarantees tuned against 2012–2023 seasons; calibration inside the §6.3 bands.

## 0.5.0-alpha — 2026-09-18

- All screens (dashboard, roster, schedule, standings, draft room, trade center, free agency, league browser,
  player card, about) on the retro design system; engine modules for league, sim, draft, trade, free agency,
  lifecycle and history; the data pipeline over nflverse; IndexedDB saves; CI with typecheck, unit tests,
  truth-isolation lint and the six-season headless run.
