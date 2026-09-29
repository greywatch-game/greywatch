# Craft: a front end, not a form

What the two redesigns learned, as a stance, a vocabulary and a list of traps.
`docs/ui.md` holds the argued contract; this is the working knowledge.

## The stance

Think like a game UI designer, not a web one:
- **The screen is ABOUT something, and that thing is the title.** The menu's
  title is the map's name over its photograph; the kit's is the weapon's name
  over the weapon. A screen whose largest text is its own name ("LOADOUT",
  "SETTINGS") is a form.
- **One cursor, drawn on the thing it is on.** Sight brackets on the row's
  corners, the caption lighting — never a fill, because the fill already
  means CHOSEN. Where the cursor is, what is chosen, and (on a ballot) what is
  winning are three facts drawn three ways.
- **Show the options for ONE thing at a time** (the kit's rail is the cursor
  slot's options, not every slot's). Everything on screen at once is the web
  instinct and it is what made the old kit screen a wall.
- **Every prompt is drawn ON its control for the device in hand**, not in a
  paragraph of hints naming three devices.
- **Motion says what changed**: an entrance on the raise, a wipe when the
  title changes, cards dealt in when a list changes kind, bars that slide.
  Opacity and transforms only (the compositor's), `prefers-reduced-motion`
  honoured, and never on a patch that changed nothing.
- **Use the space the viewport has.** A 1440p monitor gets the 1080p
  composition bigger (`--u`), not the same pixels with more emptiness; a
  landscape phone gets a layout of its own, not a miniature.

## Which frame

- **The shell** (`.ui-screen` in `base.css`: head, body, foot; a rail and a
  panel) is for a screen whose job is its LIST and nothing else — only the
  round-over card is left in it. A new list screen goes there and gets
  `.ui-foot`/`.ui-back` for free. (The lobby was one and left: a list of
  matches reads as a front end once each match is a TITLE — its map's name
  over its photograph. So did the deploy screen: a list of spawns reads as
  one once the POSITION under the cursor is the title and the map's plan is
  the stage.)
- **The front end** (`:is(#overlay.card-menu, #overlay.card-building, #loadout, #settings, #lobby, #deploy)` in
  `base.css`, plus `prompts.ts`) is for a screen whose job is to SHOW
  something — or a list the player browses like a title screen rather than
  fills in like a form (the settings: the PAGE is the title, the pages a tab
  strip the bumpers turn, the rows plates; the lobby: the MATCH under the
  cursor is the title, over its own map's photograph). It is a grid of named
  areas of the screen's own, sized off the shared unit. A fifth front-end
  screen adds its
  root to that `:is(...)` list rather than copying the block, and its Back
  goes in the SYSTEM CORNER (top right), where the menu keeps Online and
  Settings.
- **A front-end screen raised over OTHER screens hides them** (`#hud.kitting`,
  `#hud.setting`, `#hud.lobbying`: `visibility`, so they come back unredrawn)
  and lays a scrim shaped like its own layout over the scene, instead of an
  opaque veil. One raised over the MENU may drive the menu's photograph
  (`OverlayScreen.showBackdrop`) rather than keep a second copy of it; the
  menu puts its own map back when it is redrawn on the way out.

## The shared vocabulary (front end)

| thing | where it is defined | rule |
| --- | --- | --- |
| `--u` | `base.css` | one pixel of a 1080-line screen, `clamp()`ed over `vmin` |
| `--t-cap/-body/-row/-big` | `base.css` | every READ size is `max(floor px, n * --u)`; a SHAPE (gap, chamfer) is `n * --u` with no floor |
| `--hit` | `base.css` | 44 px under a coarse pointer, 0 otherwise — a `min-height` under every control |
| `--gx`, `--gy` | `base.css` | gutters; `--gx` caps the frame at 2.4:1 and centres it |
| `--plate-mm`, `--plate-edge`, `--cut` | `base.css` | a control's plate, its hairline, its chamfer |
| `glyph(key, pad)` | `prompts.ts` | a prompt; the root's `dev-kbm/-pad/-touch` class picks the label |
| the title | per screen | white, 900, tight, hard black drop; a hollow numeral behind it |
| the eyebrow | per screen | hot, `--t-cap`, tracked 0.3em, over the title |
| a row with a cursor | per screen | a `position: relative` wrapper carrying `::before/::after` brackets around a clipped plate |
| the intel plate | per screen | gradient plate, eyebrow + h3 + a 48u hot underline, then what the pick IS, then a paragraph |
| the hint line | per screen | bottom right, `data-dev` spans, absent under touch |
| entrance | per screen | `.enter` on the root on a RAISE only; staggered `rise`/`from-left`/`drop`/`arrive` |

Colours are `base.css`'s tokens: `--hot` is the selection and the chosen
value, `--mine`/`--theirs` are sides, cyan (`#35f0ff`) is the cold accent and
the wordmark's lift. Every chamfered thing is cut with the same
`polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), …)`.

## The four templates

Keyed on what actually runs out, in this order in the stylesheet:
1. **WIDE** — the default: column, stage or art, intel.
2. **NO INTEL** — `(max-width: …), (max-height: 619px)`: the intel goes, and
   whatever it carried that a player picks on comes back somewhere smaller
   (the menu's hero facts, the kit's two extra figures). The width is the
   screen's own: 1100 on the menu, 1240 on the kit, whose rail needs six
   cards beside the column. Find it with the 1180x820 and 1280x720 views.
3. **LANDSCAPE PHONE** — `(orientation: landscape) and (max-height: 560px)`:
   the real phone layout. Controls in the reach of the thumbs (the menu's on
   the right, the kit's slots down the left as full-height equal plates), the
   wordmark, the hint line and the decoration gone, Back in the top corner,
   and a further `(max-width: 740px)` rung for the smallest.
4. **PORTRAIT** — a fallback that must not break: one column, a list as a
   row of icon tabs.

## Traps that have already cost time

- **A screen raised over a FREEZE gets the frames before it and no more.**
  The building card is painted in the two frames `Game.startRound` waits and
  then the main thread is inside the build, for 11 s on Cinderhaven: nothing
  on it may need a later frame (no canvas, no fetch, no decode), and only
  `opacity`/`transform` animations keep moving. It is proved with a CDP
  screencast across a real `startRound`, never with a screenshot, which waits
  for the main thread and so photographs either side of the freeze.

- **A control that did not opt into `pointer-events: auto` is dead under the
  mouse and perfect under a pad**, because `#hud` is `pointer-events: none`
  and the pad never touches the DOM. `audit.mjs` reports it as DEAD. (The
  kit screen's root opts in wholesale because it is a lid that covers
  everything; the menu opts in per control because a click on its art must do
  nothing.)
- **Playwright's `click()` never reaches the interface** — the canvas is read
  as intercepting. Click with `el.click()` or `dispatchEvent` inside a step.
- **Anything drawn on a clipped control must be INSET** — a `clip-path` cuts
  an outer ring, an outer shadow and a pseudo-element off with the corner.
  Rings are inset box-shadows; brackets live on an unclipped wrapper; a glow
  is a `drop-shadow` filter on the wrapper.
- **A hover rule that moves the cursor fights a layout where the mouse
  travels across other rows** to reach the control it wants. The kit's slots
  are CLICKED open because the rail is under the stage and the column is to
  its left.
- **A block beside something MEASURED must be a constant height.** The kit's
  bay is measured every frame; a title that wraps or a rail that grows for
  one kind of option rescales the weapon under the player. Size a title off
  its own box (`container-type: inline-size` + `cqw`) and `nowrap` it.
- **A row of picks is equal shares and never wraps.** A wrapping flex row
  strands its last button at some width nothing but a screenshot finds. A grid
  of `1fr`, or `flex: 1 1 0` between a floor and a cap with auto margins on
  the end items and a scroller past the floor. Where it must wrap, it wraps
  into aligned columns (the kit's finish grid is 8x2).
- **Long names are the design problem, not an edge case.** "Submachine Gun",
  "Anti-Vehicle Mines", "Cinderhaven", "Proving Ground" decide the widths.
  Prefer a short name where the full one is already the title (the kit's
  weapon cards say SMG); a figure may take a second line; an ellipsis on a
  name the player needed is a defect `audit.mjs` lists as CLIPPED.
- **A shared-CSS move can change the menu silently.** Specificity decides:
  `:is(#overlay.card-menu, #loadout)` keeps the ID weight the menu's own
  rules had, so the menu's later overrides still win. Photograph the menu
  before and after.
- **A list whose length varies must not be a `1fr` track**, or the line
  under it (the settings' say line) is stranded at the foot on a short page.
  Size it `minmax(0, max-content)` with a `1fr` spacer row after: it grows to
  its content, and only shrinks (and scrolls) when the glass cannot hold it.
- **A scroller that gives its cursor brackets room with a negative margin
  must not take the BOTTOM back**, or a row scrolled past paints over the
  block under the list.
- **Touch is guessed until a device is used** (`guessDevice`), and `Game`
  pushes the real one only once `input.anyDeviceUsed` — a phone's first frame
  has touched nothing and would otherwise be prompted for Enter.
- **The entrance must run on a RAISE and never on a patch**: remove `.enter`,
  read `offsetWidth`, add it back in `show`; reset the `shown` record so the
  first draw writes without the change animations.
- **Headless touch viewports report `(pointer: coarse)`** only with
  `hasTouch`/`isMobile` on the context — `lib.mjs` sets both for the phone and
  tablet views, which is why `--hit` shows up there and not on the desktop
  ones.
- **A list that scrolls on a phone must not fire on pointer-DOWN.** A drag
  that starts on a row to scroll the list would fire the row. The lobby's
  match plates join on `click`, which a browser never raises after a scroll;
  pointer-down is for a control whose press must go on to take the pointer
  lock (the deploy screen's), which a join does not.
- **A plate that PICKS sits above the button that FIRES, so it is clicked
  and never hovered** — the deploy screen's positions are over its Deploy
  plate, and a hover cursor would move to the last plate the pointer crossed
  on its way down to the button. The same goes for a map marker: it picks.
- **A square STAGE sizes itself off its own area, not the viewport** — the
  deploy map is `min(100cqw, 100cqh)` inside a `container-type: size` grid
  area, so every template gets the biggest square its layout leaves without
  a per-template `vh`/`vw` guess (which is what the old `--map` was).
- **A block with no patch path must be in the list's SHAPE key.** The lobby's
  empty state lives inside the list and is rebuilt only when the list is, so
  its sentence is part of the key; left out, it said "Searching" forever
  after the server had answered.
