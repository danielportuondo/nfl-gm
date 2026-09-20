# Changelog

All notable changes to Gridiron GM. Dates are build dates; the project was built in six phases on 2026-09-17/18
(see `docs/HANDOFF.md` for the plan and `docs/DECISIONS.md` for what was decided along the way).

## 1.5.0 — 2026-09-20

### Changed
- A new game opens at the draft of the year you pick: take over the 2013 Colts and you run the 2013
  draft, sign undrafted rookies, work free agency and break camp before the 2013 season. Saves from
  earlier versions continue unchanged.
- The header labels offseason phases by the season they prepare ("2013 offseason · Draft").

### Added
- Dashboard alert while a draft is waiting or under way.
- Trade offers name picks with their overall number once the order is set ("2013 R1 #24 (IND)").

## 1.4.0 — 2026-09-20

### Added
- Season Recap draws the playoff bracket: seeds, byes, scores and 2px connectors, AFC over NFC, the
  Super Bowl on the right. Recaps saved before this release keep the old text list.
- Six major awards on the Season Recap: most valuable player, offensive and defensive player of the
  year, offensive and defensive rookie of the year, coach of the year (the team that beat its
  consensus expectation by the most). All from box scores, records and consensus; the league
  leaders list stays underneath.
- Save file panel on Settings: export the game as JSON, import one back. New Game offers the same
  import for a fresh browser or another device. Importing replaces the current game and its autosave
  after a confirm.

## 1.3.0 — 2026-09-20

### Added
- Cutdown helper on the Roster screen: while you are over 53 or over the cap before the season, the
  game lists its suggested cuts with dead money and savings, lets you keep anyone, and releases the
  rest in one action.
- Settings tab: theme (dark, light or system), the three game settings adjustable mid-game, and
  Start over, which returns to the New Game screen after a confirm. The saved game stays on offer as
  Continue until you start a new one.

### Fixed
- Half-width panels now stack on phones (≤ 720 px), as the design always said they should.

## 1.2.0 — 2026-09-19

### Added
- New Game: the mandate plate leads in your team's colors, with the helmet, the year and the goal, and
  updates as you choose. Teams are picked from a helmet wall grouped by division.

### Changed
- Practice-squad, futures and minimum-tender camp bodies no longer start the game as free agents from
  2016 on. Unsigned players on day one: 2019 1,326 → 494, 2023 1,337 → 482. League data 2.3 → 2.1 MB.
- The ratings model reads the refreshed contracts data (deals through 2026 instead of May 2022) and the
  injury model keys position on the roster, so safeties are fit as safeties from 2016 on.

### Fixed
- The injury target in the brief now states the band the calibration harness enforces.

## 1.1.0 — 2026-09-19

### Added
- Suggested trades on the Trade Center: up to four deals other front offices would take today, each an
  upgrade at one of your weakest positions. Accepting one is a done deal; dismissing hides it for the week.

### Fixed
- Stars who spent a season on injured reserve no longer start the game as free agents (the 53-man export
  ranked by depth chart and snaps only). Players rated 70+ in the day-one pool on a 2023 start: 89 → 33.
- Safeties exist again from 2016 on. nflverse labels every safety and corner `DB` in those seasons and the
  pipeline mapped all of them to cornerback; the finer depth-chart position now decides.
- Generated draft prospects can no longer have a ceiling below their floor.
- The value bar on AI-initiated offers reads "Fair / Lopsided / Favours you" instead of an acceptance
  likelihood the deal does not depend on.

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
