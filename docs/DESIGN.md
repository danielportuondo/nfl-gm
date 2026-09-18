# Gridiron GM — visual system

Produced in Phase 0 by the orchestrator with the `/frontend-design` skill from the brief in
`docs/HANDOFF.md` §6.11. Every `ui-builder` dispatch invokes `/frontend-design` first, then implements
this document for its screens. Extend it; never contradict it. Requests to change it go in the agent's
report under "DESIGN REQUESTS".

## 1. Direction

**The war-room draft board: chalk-white pixel type on deep felt green, chunky magnet-tile panels with
hard-cut shadows, and one saturated hue on any screen — the team's own colors — until you are on the
clock, when the whole frame turns gold.**

Why this and not the obvious retro look: the subject is a front office, not an arcade cabinet. The
objects a GM actually stares at are the draft board (a felt wall with magnetic name plates), the depth
chart whiteboard, the cap sheet, and the stadium scoreboard. Those give us the material palette (felt,
chalk, magnets, bulbs) and the structural devices (plates, wells, strips) without borrowing another
game's screens. Pixel type keeps the Retro Bowl warmth; Barlow keeps the tables honest at 13px.

### Plan → review → what changed
First pass reached for a near-black ground with amber "bulb" accents and Press Start 2P. Both are
defaults: the black-plus-one-neon look appears on every retro dashboard, and Press Start 2P is the font
you get when you type "pixel font". Revised to a **green felt ground** (clearly green, never a tinted
black), **team colors as the moving accent** (specific to this subject: the palette changes with the
franchise you are looking at), and **Pixelify Sans + Barlow**. Removed pill badges, blurred shadows,
all-caps eyebrow labels, and middle-dot meta strings. Kept one looping animation in the entire app (the
on-the-clock blink) and one page-load reveal.

## 2. Tokens (CSS variables)

All tokens live in `app/src/ui/tokens.css` on `:root` (dark, the default). The light theme redefines
only the color tokens under `:root[data-theme="light"]` and, for the default "system" setting, under
`@media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) }`. Never hard-code a color,
size, radius or duration in a component.

### 2.1 Color — dark (default) "night game"

```css
:root {
  --surface-0: #0E1F17; /* app ground: the field at night */
  --surface-1: #163127; /* sunken wells (tables, inputs) */
  --surface-2: #1F4334; /* raised panels */
  --surface-3: #2A5744; /* hover / selected rows / secondary buttons */
  --line:      #0A1610; /* borders, hard shadows, facemasks */

  --text-1: #F3ECD2;    /* chalk: primary text            (≥ 11:1 on surface-2) */
  --text-2: #C9C2A6;    /* secondary text, table headers  (≥ 7:1)  */
  --text-3: #8E9A88;    /* hints, disabled                (≥ 4.5:1 on surface-1) */
  --text-inverse: #F3ECD2; /* text on --line backgrounds */

  --accent: #F2B33D;    /* gold: primary action, focus ring, on-the-clock, the trophy */
  --on-accent: #0A1610;
  --danger: #E0553F;    /* challenge-flag red: errors, injuries, cap breaches */
  --on-danger: #FFF6EE;
  --positive: #7FD8A4;  /* mint: likely / healthy / under cap */
  --on-positive: #0A1610;

  /* Team context — set on the nearest ancestor by <TeamScope team="KC"> from teams.json */
  --team-primary: #1F4334;
  --team-secondary: #F3ECD2;
  --on-team-primary: #F3ECD2; /* computed: whichever of --text-1/--line clears 4.5:1 */
}
```

### 2.2 Color — light "whiteboard"

```css
:root[data-theme="light"] {
  --surface-0: #E9EEE6;
  --surface-1: #F7F8F3;
  --surface-2: #FFFFFF;
  --surface-3: #DDE6DA;
  --line:      #17281F;
  --text-1: #17281F;
  --text-2: #3F5148;
  --text-3: #6E7F76;
  --text-inverse: #F7F8F3;
  --accent: #B8781A;   --on-accent: #FFFFFF;
  --danger: #B93B29;   --on-danger: #FFFFFF;
  --positive: #1F8A57; --on-positive: #FFFFFF;
}
```

Rules: `body` always sets `background: var(--surface-0); color: var(--text-1)`. No gradients anywhere.
No opacity tricks for hierarchy — use the surface steps. The only saturated colors on a screen are
`--accent`, `--danger`, `--positive` (each used for meaning, never decoration) and the team pair.

### 2.3 Type scale

Two families, clearly distinct in role. Sizes are a 1.2 ratio from a 15px body, rounded to whole
pixels; display sizes sit on multiples of 4 so pixel glyphs align.

```css
:root {
  --font-display: 'Pixelify Sans Variable', 'Pixelify Sans', 'Courier New', monospace;
  --font-body: 'Barlow', 'Helvetica Neue', Arial, sans-serif;

  --fs-1: 0.8125rem; /* 13 — dense tables, captions          (Barlow)   */
  --fs-2: 0.9375rem; /* 15 — body                            (Barlow)   */
  --fs-3: 1.0625rem; /* 17 — lead paragraphs, player names   (Barlow)   */

  --fd-1: 1rem;      /* 16 — buttons, tabs, badges, meter %  (Pixelify) */
  --fd-2: 1.25rem;   /* 20 — panel titles                    (Pixelify) */
  --fd-3: 1.5rem;    /* 24 — screen titles, modal titles     (Pixelify) */
  --fd-4: 2rem;      /* 32 — scoreboard numbers, ratings     (Pixelify) */
  --fd-5: 3rem;      /* 48 — hero: ON THE CLOCK, final score (Pixelify) */

  --lh-body: 1.45;
  --lh-display: 1.1;
  --ls-display: 0.02em; /* Pixelify tightens at 16px; give it air */
}
```

- Body copy max line length 70ch. Sentence case everywhere; capitals only in abbreviations (`KC`, `QB`).
- Numbers in tables, meters and the scoreboard: `font-variant-numeric: tabular-nums`. If a face lacks
  tabular figures at a size, give the cell a fixed `min-width` instead — columns never wobble.
- Ratings (40–99) are always Pixelify, never Barlow: a rating is a game number, not a spreadsheet number.

### 2.4 Space, radius, border, shadow, motion, layering

```css
:root {
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  --r-0: 0;    /* tables, name plates, meter segments */
  --r-1: 2px;  /* panels, modals, inputs */
  --r-2: 6px;  /* buttons, badges */

  --bw: 2px;         /* every border */
  --bw-plate: 6px;   /* team-colored left bar on plate panels */

  --shadow-raise: 4px 4px 0 var(--line);  /* raised panel, button at rest */
  --shadow-hover: 3px 3px 0 var(--line);  /* button hover */
  --shadow-press: 1px 1px 0 var(--line);  /* button active */
  --shadow-none: none;                    /* sunken wells, plates */

  --t-snap: 90ms;    /* discrete state changes; pair with steps() */
  --t-quick: 140ms;  /* hover, press */
  --t-reveal: 380ms; /* the page-load reveal total */
  --stagger: 35ms;
  --ease-mech: steps(3, end);            /* "mechanical" motion: 3 frames */
  --ease-out: cubic-bezier(.2, .9, .3, 1);

  --z-rail: 10; --z-strip: 20; --z-modal: 100; --z-toast: 110;
}
```

Shadows are **hard-cut, never blurred**: that is the pixel bevel. Hierarchy comes from the shadow
step (raise → hover → press → none) and the surface step, not from radius. Radius encodes *kind*:
0 for things that sit on a grid, 2 for containers, 6 for things you press.

## 3. Fonts

| Role | Face | Package | Why |
|---|---|---|---|
| Display | **Pixelify Sans** (variable 400–700, OFL) | `@fontsource-variable/pixelify-sans` | A pixel face with real lowercase and weights, so headings and buttons feel like the game without shouting in caps; far less worn than Press Start 2P. |
| Body / data | **Barlow** (400, 500, 600, OFL) | `@fontsource/barlow` | Low-contrast grotesque with a slightly squared, sporty voice (it reads like a stadium sign), narrow enough for dense cap tables at 13px. |

Load in `app/src/ui/fonts.ts`: `import '@fontsource-variable/pixelify-sans'` and
`import '@fontsource/barlow/400.css'`, `/500.css`, `/600.css`. Self-hosted, no CDN. `font-display: swap`
with the fallback stacks above so text never blocks.

## 4. Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ STRIP  [KC plate] Chiefs  2015 · Week 7   5–1   Cap $12.4M free   3 seasons left │ sticky, --z-strip
├──────────┬───────────────────────────────────────────────────────┤
│ RAIL     │ BOARD                                                 │
│ Dashboard│  ┌ panel ─────────┐  ┌ panel ──────────────────┐      │
│ Roster   │  │ Next game      │  │ Alerts                  │      │
│ Schedule │  └────────────────┘  └─────────────────────────┘      │
│ Standings│  ┌ sunken well ────────────────────────────────┐      │
│ Draft    │  │ table                                       │      │
│ Trades   │  └─────────────────────────────────────────────┘      │
│ Free ag. │                                                       │
│ Finances │                                                       │
│ League   │                                                       │
└──────────┴───────────────────────────────────────────────────────┘
```

- **Strip** (top, sticky, `top: env(safe-area-inset-top, 0px)`): team plate, season and week, record,
  cap space, horizon countdown. Readouts are separated by a 2px `--line` vertical rule with `--sp-3`
  on each side — separate gauges on one scoreboard, which is what they are. Height 48px desktop.
- **Rail** (left, 200px, `--surface-1`): screen list in Pixelify 16, active item gets a 6px
  `--team-primary` left bar and `--surface-3` fill. At ≤ 720px the rail becomes a **bottom tab bar**
  (5 tabs: Dashboard, Roster, Schedule, Draft/Trades by phase, More) with `padding-bottom:
  env(safe-area-inset-bottom, 0px)`.
- **Board** (content): max-width 1200px, `padding: var(--sp-5) var(--sp-4)`; 12-column grid, gap
  `--sp-4`; panels span 4/6/8/12 columns and stack to 12 at ≤ 720px. Gutter never below 16px.
- **Alignment**: everything left-aligned. Numbers right-aligned in tables. The one centered composition
  in the app is the on-the-clock hero (and the end-game report card, which reuses it).
- At **390px**: strip wraps to two rows (plate + record / cap + horizon); tables scroll horizontally
  inside their well with the first column (sprite + name) frozen; the draft board becomes a single
  column of name plates with the on-the-clock panel pinned above the tab bar.

## 5. Motion plan

Three kinds of motion, nothing else.

1. **Page-load reveal (once per screen): "lights on".** Panels appear in DOM order with
   `animation: lights-on 1ms steps(1, end) forwards; animation-delay: calc(var(--i) * var(--stagger))`
   — each panel simply *is there* one frame later, like scoreboard bulbs striking. ≤ 12 panels, so the
   whole reveal finishes inside `--t-reveal`. No fades, no slides. Panels below the fold get no delay.
2. **Interaction feedback (answers the user).** Buttons move 1px down-right on hover
   (`--shadow-hover`) and 2px on press (`--shadow-press`), `--t-quick`. Rows highlight instantly
   (no transition). Modals and toasts enter with `--ease-mech` over 120ms — three discrete frames,
   like a card being slapped onto the board. Meter bars fill segment by segment: `steps(20)` over 300ms.
3. **The on-the-clock moment (the one bold thing).** When the user's pick comes up in the Draft Room:
   - The strip turns `--accent` with `--on-accent` text; the readouts are replaced by
     `ON THE CLOCK` in Pixelify 48 (the only all-caps display text in the app, because that is what the
     board says) and a `steps(2)` 1s blink — **the only looping animation in the product**.
   - The user's team plate scales 1 → 1.06 → 1 once over `--t-quick`.
   - Incoming offers drop in from the right one at a time, 120ms apart, `--ease-mech`. Each offer's
     acceptance bar then chalks in left → right.
   - Making the pick slides the name plate onto its slot in the board grid; the strip returns to team
     colors on the next frame. No confetti.
   - Optional pick-clock tick sound is a hook, off by default.

`@media (prefers-reduced-motion: reduce)`: no stagger, no blink (static gold strip), no translate on
offers or plates; meters render at their final fill. Everything still *changes*; nothing *moves*.

## 6. Background and texture

- The app ground (`--surface-0`) carries a **2px dither**: a 4×4 checker of `--text-1` at 4% opacity,
  as a `repeating-conic-gradient` or 4×4 SVG data URI, `background-size: 4px 4px`. That is the
  period-authentic texture — dithering, not film grain or noise.
- Panels are flat. Texture belongs to the felt, not the magnets.
- **Yard-line motif**, used exactly twice: the Dashboard hero panel and the End Game report card get
  horizontal 2px `--line` rules at 30% every 40px with 8px hash marks at each edge — the field seen
  from the press box. Never under a table.

## 7. Sprite system

Team-colored generic silhouettes. No faces, no skin, no photos, no logos.

- **Grid**: 16×16 base, authored as SVG with integer coordinates and `shape-rendering="crispEdges"`,
  rendered at 2× (32px) in tables and lists, 4× (64px) on the Player Card and draft plates, 6× (96px)
  in the on-the-clock hero. Never non-integer scales.
- **Two sprites per player**: `<HelmetSprite>` (side profile facing right) and `<BustSprite>` (shoulders
  + jersey, number in Pixelify 700 in `--on-team-primary`).
- **Palette per sprite (≤ 6)**: `--team-primary` (shell/jersey), `--team-secondary` (stripe, sleeve
  ends, number outline), `--line` (outline, facemask, visor), `color-mix(in oklab, var(--team-primary),
  white 22%)` (one highlight row), `--surface-2` (neutral fill where needed). The visor is `--line`:
  a silhouette, not a person.
- **Five body silhouettes by position group**: `QB` (slim pads, visor), `SKILL` (RB/WR/TE/CB/S: sleek,
  gloves in secondary), `BIG` (OL/DL: wide pads, no visible neck), `LB` (medium pads, arm bands),
  `SPECIAL` (K/P: single-bar facemask, no gloves). Helmet is shared; facemask differs for `SPECIAL`.
- **Overlays**: injured → 6×6 `--danger` cross at bottom-right; rookie → 5×5 `--accent` star at
  top-right; free agent → helmet drawn in `--surface-3`/`--text-3` (no team).
- Components: `app/src/ui/sprites/{HelmetSprite,BustSprite}.tsx` taking `team`, `pos`, `size`,
  `number?`, `status?`; colors flow from the enclosing `<TeamScope>` or an explicit `team` prop.
  Mark `aria-hidden="true"`; the adjacent text names the player.

## 8. Component primitives (`app/src/ui/primitives/`)

| Primitive | Spec |
|---|---|
| **Panel** | `--surface-2`, `--bw` `--line` border, `--r-1`, `--shadow-raise`, padding `--sp-4`. Header row: title Pixelify `--fd-2` left, one optional action right. Variants: `sunken` (`--surface-1`, no shadow — tables, forms), `plate` (a `--bw-plate` `--team-primary` left bar — "this is a team"), `attention` (`--accent` border — **only** for things that need the user's action now). |
| **Button** | Pixelify `--fd-1`, `padding: 10px 14px`, min-height 40px, `--bw` border, `--r-2`, `--shadow-raise` (3px variant). `primary` = `--accent`/`--on-accent`; `secondary` = `--surface-3`/`--text-1`; `danger` = `--danger`/`--on-danger`; `ghost` = transparent with border. Hover → `--shadow-hover` + 1px translate; active → `--shadow-press` + 2px; disabled → 50% opacity, `--shadow-none`; busy → label changes ("Sim week" → "Simming…"), no spinner. Label is a verb. |
| **Table** | Lives in a `sunken` panel. Header sticky, Barlow `--fs-1` 600 `--text-2`. Rows 32px (28px `dense`). Hover `--surface-3`, no transition. Selected row: 3px `--accent` left border. Numbers right-aligned tabular; ratings in Pixelify. Sort indicator is a 6px pixel triangle. First column (sprite + name + position badge) frozen when scrolling horizontally. Always a `<caption>` (visually hidden if the panel title already names it). |
| **Meter** | 20 segments of 5%, 2px gaps, 12px tall, `--r-0`, segments `--surface-1` unfilled. Fill color by value: < 0.35 `--danger`, 0.35–0.65 `--accent`, > 0.65 `--positive` (cap usage inverts: > 0.95 is `--danger`). Value label right, Pixelify `--fd-1`. `role="meter"` with `aria-valuenow/min/max` and a text label. Fills with `steps(20)`. Used for acceptance likelihood, scouting confidence, cap usage, horizon progress. |
| **Badge** | `position`: Barlow `--fs-1` 600 on `--line` with `--text-inverse`, `--r-1`, `2px 6px`. `team plate`: `--team-primary` fill, 3px `--team-secondary` bottom border, abbreviation in Pixelify `--fd-1`. `status`: Rookie (`--accent` outline), Injured (`--danger` fill), Expiring (`--text-2` outline), Diverged is never shown (internal). |
| **Modal** | Centered Panel, max-width 560px, backdrop `--surface-0` at 80% with the dither. Title Pixelify `--fd-3`. Footer buttons right-aligned, primary rightmost. Focus trapped; `Esc` closes; returns focus to the opener. Enters with `--ease-mech` scale .94 → 1 over 120ms. |
| **Toast** | Panel with a `--bw-plate` left bar: info `--text-2`, success `--positive`, warn `--accent`, error `--danger`. Barlow `--fs-2`. Bottom-right on desktop, top on ≤ 720px (above the strip). Auto-dismiss 5s, paused on hover/focus, max 3 stacked. `role="status"`. |
| **Strip**, **Rail/Tabs**, **NamePlate** (draft-board tile: bust sprite, name, position badge, consensus ovr/pot in Pixelify), **StatTile** (a number in Pixelify `--fd-4` with a Barlow label *under* it; no gradient, no icon) | Composite primitives built from the above; specs in §4 and §5. |

## 9. Copy and voice

Plain verbs, sentence case, the user's vocabulary. Buttons say what happens: **Make pick**, **Offer
trade**, **Sim week**, **Sim to next event**, **Sign at ask**, **Release**, **Save game**. The same
action keeps the same name across the flow (a "Save game" produces "Saved").

- Mandate card: "Your mandate: win the Super Bowl by 2017. That's 3 seasons."
- Empty offers: "No offers yet. Teams call when your pick lines up with their biggest need."
- Cap breach: "Over the cap by $4.2M. Release or trade a contract to continue."
- Declined trade: "Kansas City passed. They'd listen if you added a 2016 third-round pick."
- Never: "Submit", "Oops", exclamation marks, or any phrase about the future you are not supposed to know.

## 10. Quality floor (not announced, always met)

Text contrast ≥ 4.5:1 in both themes; `:focus-visible` ring `3px solid var(--accent)` with 2px offset;
all controls reachable and operable by keyboard (rail and tab bar with arrow keys, draft board as
`role="grid"` with roving tabindex, modals trap focus); 40px minimum touch targets; `prefers-reduced-motion`
honored per §5; sprites `aria-hidden` with text alternatives; tables with captions and `scope`d headers;
works at 390px with a 16px side gutter and no horizontal page scroll; dark default, light option, and
`data-theme` persisted in `localStorage` (wrapped in try/catch).

## 11. Screen notes (build order per HANDOFF §6.11)

- **New Game** — a three-step board (year → team → horizon + settings) as a single column of panels;
  the team step is a 32-plate grid keyed by team colors; the "Your mandate" card is a `plate` panel
  in the chosen team's colors and is the first thing that ever wears them.
- **Dashboard** — hero panel with the yard-line motif: record, next opponent (two helmet sprites facing
  each other), horizon meter. Beside it: cap StatTiles, alerts list, "Sim week" / "Sim to next event".
- **Roster & Depth Chart** — table (dense) with position filter; depth chart as columns of NamePlates
  you can reorder by keyboard (move up/down) and pointer.
- **Player Card** — bust sprite at 4×, name in Barlow 17, position and team badges, consensus ovr/pot
  in Pixelify 32 with the confidence meter under them, contract, season-by-season stats table.
  Nothing on this screen is derived from truth.
- **Schedule & Results** — week rows with helmet sprites and scores; three sim buttons in the header.
- **Standings** — eight division tables, clinch badges.
- **League Browser** — team plate grid → that team's roster/picks/cap in a plate panel.
- **Draft Room** — the showcase (§5.3). Board grid of NamePlates by round, your picks column, the
  on-the-clock panel (`attention` variant), offers list with meters, pick log in a sunken well.
- **Trade Center** — two plate panels (yours / theirs) with asset pickers, a single Meter between them
  that updates live, the AI's counter as a toast-styled inline panel.
- **Free Agency** — pool table with asks; your offers panel; bidding result as a toast.
- **Finances** — cap table by season (sunken), expiring contracts, dead money as `--danger` rows.
- **Season Recap** — awards as NamePlates, playoff bracket drawn with 2px `--line` connectors.
- **End Game** — the on-the-clock hero composition reused: gold strip, "Super Bowl champions" or
  "Horizon reached", then the GM report card (StatTiles) and "Keep playing".
- **About** — attribution and the disclaimer from HANDOFF §2, verbatim, in Barlow 15.

## 12. Do not

Blurred shadows; gradients; pill radii; all-caps labels outside abbreviations and the on-the-clock
hero; eyebrow labels above headings; middle-dot separators; monospace for data; arrows appended to
button text; icons as decoration; spinners; a different accent per screen; any color not in §2; any
photo, logo or wordmark; any rating that did not come from `state.scouting`.
