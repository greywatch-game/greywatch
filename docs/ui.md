# The interface: five screens and the chrome

What each UI class owns, where a stylesheet lives, and how the screens between
the title and the world are driven by a pointer and a pad alike. Split out
of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the
contract for everything under `src/ui/`.

## The interface is five screens and the chrome

`src/ui/` holds one class per thing on screen, and `HUD` is not where a new one
goes: `OverlayScreen` owns the four full-screen cards, `DeployScreen` the deploy
map, `LoadoutScreen` the kit, `SettingsScreen` the settings list, `LobbyScreen`
the match browser, `Minimap` the corner map, `Scoreboard` the Tab board, and
`HUD` **only** the gameplay chrome. `TouchControls` is in the directory and is
deliberately not in that count — it draws like a screen and answers like a
gamepad; see the last section here.

## The front end, and the shell it replaced

**Every screen between the title and the world is a TITLE SCREEN now, laid out
the way the main menu is**: the menu, the round-over card, the pause, the kit
screen, the settings screen, the lobby and the deploy screen. Each is a grid of
NAMED AREAS of its own over a picture of the thing it is about — a map's
photograph, the weapon, the map's plan, the round itself — with a title that is
that thing's NAME, a column of plates the cursor walks, an intel plate that is
the first thing a small viewport drops, and the way out in a SYSTEM CORNER (the
pause's is its first row, for a reason its own section gives). What they share
is stated once, in `base.css`'s `:is(#overlay.card-menu,
#overlay.card-roundover, #overlay.card-pause, #loadout, #settings, #lobby,
#deploy)` block and `prompts.ts`: the unit `--u` (one pixel
of a 1080-line screen), the `--t-*` type scale, the plate, the chamfer, `--hit`
and the prompts drawn on their controls. The building card takes the unit and
none of the prompts, having nothing on it to press. A new screen copies one of
them — the settings screen for a list browsed like a title screen, the lobby
for one whose rows come and go — and adds its root to that `:is(...)` list.

**They replaced THE SHELL, and what the shell was for is still the argument.**
`.ui-screen` was a head, a body of a LIST and the PANEL describing the list's
cursor, and a foot carrying the hints and Back, anchored to the viewport rather
than centred in it: every one of these screens had been a ~600 px column
floating in the middle of the window, which on a 2560-wide monitor is a quarter
of the width in use and nothing within 500 px of an edge — a dialog box laid
over a game rather than the game's own front end. The shell fixed that and got
the rest wrong in the same way each time: its largest text was the screen's
OWN name ("LOADOUT", "SETTINGS", "VICTORY" in a corner), its panel was an open
column of leftover window, and its foot was a line of hints naming three
devices. Each screen left it as it became a title screen, the round-over card
last, and the frame was deleted with it. What survives from it is the
vocabulary (`.ui-eyebrow`, `.ui-facts`, the `#hud` tokens) and three of its
rules, below.

**Everything is sized in `clamp()` over `vmin`, and the reason is the phone.**
A screen drawn at one size and scaled down is a miniature of a desktop layout:
right proportions, unreadable type, a title bigger than the list under it. Sized
fluidly, the same markup is a phone layout at 390 px tall and a cinema layout at
1440. `vmin` rather than `vw`, because an ultrawide is short for its width and a
title scaled by width alone on a 2560x1080 is taller than the rows it heads.
The front end's `--u` is that rule as a unit, with a FLOOR in pixels under
every size that is read, so a phone's third-of-a-pixel unit does not set a
caption nobody can read.

**A screen over another SCREEN hides it; a screen over the SCENE does not.** A
front-end lid raised over other screens takes them off the glass —
`#hud.kitting`, `.setting`, `.lobbying`, by `visibility` so they come back
unredrawn — and lays a scrim shaped like its own layout over what is left. A
veil tuned to let a village through lets a wordmark and a rail of buttons
through with it, which reads as two screens up at once; the shell answered
that with an opaque variant of its veil (`.ui-solid`), and the answer outlived
it by being turned round.

**Nothing under `#hud` is scaled to a short viewport any more.** `--ov-scale`
drew a screen at the size it was authored for and scaled it down, and at its
old 0.45 a landscape phone got a legible desktop menu rendered at 45%. Each
front-end screen opted out as it was laid out for a phone by its own floors — a
scaled screen is a scaled 44 px target — and the pause was the last one on it,
so the ladder went with it. A new screen fits a phone by its floors, never by a
transform.

**The boot screen is the one piece of interface that is not in this directory**,
and the exception is what defines it: it covers the stretch before any module
has evaluated, so `src/ui/` could not draw it — the bundle it would be drawn by
is what the player is waiting for. It is markup in `index.html` with its styles
in that file's `<style>` block, and `main.ts` is the only code that touches it.
It is self-contained by necessity — in DEV `base.css` is injected from JS and
has not arrived either, so it may not use `--font`, `.frame`, or anything else
the interface shares. Nothing that reacts to game state may be added to it; that
is an interface, and it belongs here with a stylesheet of its own.

**It is nonetheless a TITLE SCREEN FOR THE GAME, standing in the menu's frame**,
because the menu is what it turns into. The title is GREYWATCH, set where the
menu sets a map's name and at the menu's scale — the one thing the screen is
about before there is a map to name; a load plate stands where Deploy will,
dark (the building card's plate exactly, bar along its bottom edge, so the
game's two waits read as one instrument); and a note on the right says what the
game plays on. **Its unit, gutters, type ladder and title clamp are COPIED from
`base.css` and `overlay.css`, not shared** — so a change to one of those owes
this copy a look, or the hand-off shifts the composition under the player.
**There is no photograph and there cannot be one**: the shots are hashed by
Vite and `index.html` may name nothing the build renames. **Nor is a picture
DRAWN in its place**: a night horizon painted in gradients and polygons (a
moon, two inked ridges) was tried and read as clip art, the one illustration
in an interface that decorates only with type, plates and light. So the screen
stands on the page's black under the front end's own lighting — the warm and
cold glows from the menu scrim's two corners, and the scanlines. The menu's
four templates, at the menu's breakpoints.

**The plate NAMES each await as it begins and never counts one** (`bootStage`:
fetching, finding a GPU, the physics engine, the graphics device, building the
world), because each is one await or one synchronous block with nothing inside
it to report. The last is the constructor, which on a phone is seconds of a
blocked main thread, so `main.ts` waits for a PAINT (`painted`) before starting
it — without that the plate said "graphics device" through the whole build. On
the way out it FADES (`#boot.done`, off the pointer at once) and is removed on
a timer, since `transitionend` never fires with the transition switched off
under reduced motion. **A failure fills both halves** (`bootFailed(cause,
message)`): the plate turns to "Cannot start" over the cause in a few words,
the bar goes and the edge turns red, and the note becomes the sentence a player
can act on — "not a secure origin", "no WebGPU", "no graphics device", "no
physics engine" or "start-up failed".

Each screen builds its own root element and appends it to `#hud`, which is why
construction order in `Game`'s constructor matters exactly once: `HUD` writes
`#hud.innerHTML` and would wipe anything already appended, so it is built first.
Stacking is not DOM order — `#overlay` (10), `#loadout` and `#lobby` (11) and
`#settings` (12) carry z-indices, because a pause can be taken with the deploy
map on screen. The kit and the lobby share a rung on purpose: both are lids
raised from the main menu and the two can never be up together.

**A list-shaped screen keeps its cursor by IDENTITY, not by index.** The lobby
is the one whose rows come and go under it — a refresh inserts matches ABOVE the
actions — and an index carried across a rebuild silently means a different row:
press Refresh, let a match appear, press Enter and you have created a match
instead, with the highlight having moved under your hand to say so. `sameRow`
matches an action by kind and a match by id, never by anything that changes
(a count going 3 → 4 is the same row). The settings screen is spared this only
because its rows are a static table.

**A row that PICKS is not a row that FIRES, and the pointer has to tell them
apart.** The lobby's match plates and its Start match button fire on a CLICK;
its three pickers only step a choice, on their arrows and their value, exactly
as the settings screen's steppers do. The plates used to fire on pointer-DOWN,
the edge a control that leaves a screen takes when the same press must go on to
take the pointer lock — and a join takes no lock, while the list it sits in
scrolls under a thumb on a phone, so a drag begun on a plate would have joined
the round under it. A click is never raised after a scroll. The pickers are
above **Start match** for the reason the menu puts Map above Deploy: the
parameters, then the button that spends them. They are what a match this client
CREATES will be built with and say nothing about the matches on the other page —
see [`docs/multiplayer.md`](multiplayer.md) for why joining one takes that
match's map instead.

**THE WAY OUT OF A SCREEN IS A FIXED PLACE, never a row in its own list** —
the SYSTEM CORNER, top right, where the menu keeps Online and Settings. It was
the shell's footer first (`.ui-back`, at the right-hand end of the hint line),
and the lobby's Back was a row for a while, which was the wrong shape twice
over: it sat under a list whose length is whatever the servers happen to be
running, so the one control every visitor eventually wants was the one whose
position nothing could predict; and it wore the same highlight and the same
Enter as *join this match*, when leaving and joining are not the same kind of
act. The pad and the keyboard never needed the row — Esc and B leave every one
of these screens through `Game`, which is what the prompt on the button says —
so what it cost a pointer to reach was the whole of what it bought.

The label is **Back** on every screen that returns to the one under it, and two
screens that leave the same way must not use two words for it. The round-over
card is the exception that proves it: it does not go BACK to anything, so its
corner says where it goes — **Main menu** offline, **Leave match** in one.

**The four cards are one class because they are one element** — three of them
share the menu's frame, its lockup, its hero and its intel plate. The bar for a screen of its own is
*state*: the deploy map has a selection and a canvas, the kit screen has four
slots and a turntable; a card that is markup plus a button has not earned one.

**Three of the four take the screen and the PAUSE does not.** All four stand in
one frame, but the menu, the building card and the round-over card stand over
the map's photograph, and the pause is one left-anchored column over a scrim
that fades out before the middle of the window. The round under a pause is this
round, frozen where it stood — the flag strip along the top, your own vitals,
the body you were lining up — so a full-bleed veil over it hides the thing the
pause is *in*. It is the same argument that keeps `setOverlaid` out of
`showPause`, stated as a layout instead of as a class. The list is on the left
because that is the side a pause menu has been on since consoles had two sticks,
and because the middle of the screen is where the shot it interrupted was being
lined up.

**The building card is a title screen for the MAP being built, and it stands in
the MENU's frame** — `#overlay:is(.card-menu, .card-building,
.card-roundover)` in `overlay.css`
is the unit, the scrim, the lockup, the hero and the intel plate, and only the
grid is each card's own. The title is the menu's hero exactly (`heroMarkup`), so
a player who pressed Deploy watches the column of decisions go and the same
title stay where it stood, with a LOAD PLATE where Deploy was: dark rather than
hot, because it is not a thing to press, its bar running along its bottom edge
as its hairline. The rest of the glass is spent on what a player WAITING can
read — a briefing plate (the rules with their numbers, the flags, the bodies a
side, the kit, and the enemy tier offline or "Online" in a match, where this
machine's tier decides nothing) and one FIELD NOTE (`fieldNotes.ts`), a line
about how this game plays, picked per load, never the last one, and never about
armour on a map that has none. The briefing goes where the menu's intel goes;
the note is the one read thing every template keeps, since a phone waits as
long as a monitor.

**What may be on it is decided by the freeze, not by taste.** Everything on it
has to be PAINTED in the two frames `Game.startRound` waits, because after them
the main thread is inside the build — so nothing that needs a later frame may be
part of what it says: no canvas (the menu's plan is not on it), no fetch, and
the photograph only when it is already decoded. The layers the menu stood on
still hold it when the player came from the menu on the same map; any other
map's picture has to decode first, and until it has, the front layer comes down
rather than leaving the last map's picture behind this one's name. And what
MOVES through the freeze is what the compositor moves alone: the bar, the
photograph's drift, and an entrance of `opacity` and `transform` short enough
to have landed before the build begins. Measured on Cinderhaven: the main
thread blocked for 11 s and a screencast kept receiving frames about every
16 ms, the bar sweeping and the picture drifting through all of it.

**The key-cap table is no longer one of the things they share, and that is the
whole reason it moved.** It hung under the menu's title and under the pause's list,
drawn from one table by one loop, which was right while the settings screen was
two toggles no pad could reach. Once that screen became a list a cursor lands on
from both places, the table belonged in it: the menu is five decisions and a
Deploy button, and a dozen rows of reference under them made the longest block on
the card the one nobody reads twice. It is one row of the menu and one plate of
the pause away, and the settings screen opens on the page that carries it.

**The building card is the fourth, and it is the only one the player cannot
act on.** It stands over the ~0.7 s of merges, occlusion bake and nav grid that
building a map costs, and it exists because a freeze and a load look identical
from the outside — before it, the card the player had just confirmed simply
stopped where it stood for the whole build. `Game.startRound` is what actually
buys it the frame it needs to be drawn in; see the state machine's `loading` in
[`CLAUDE.md`](../CLAUDE.md), and note that the rule there is **two**
`requestAnimationFrame`s, not one. It takes itself down in
`Game.finishBakeWait` rather than waiting to be dismissed, and `buildRound`
shows it again once the map is settled — a no-op for the same map, and a
rewrite without the entrance when a match's welcome moved the map under it.

**Its bar may only be animated with `transform` or `opacity`** — the one place
in this directory where the choice of animated property is a correctness
constraint rather than a matter of taste. For the whole life of that card the
main thread is inside the build, so nothing on it can move unless the
COMPOSITOR can move it alone, and the compositor only takes an animation that
needs neither layout nor paint. A bar animated on `width` or `left` renders
perfectly in every test and then stands still for the one second it exists for,
which reads as a hung game rather than a loading one. Measured: with a 5 s
block forced, the bar keeps producing distinct frames throughout and drops
none. The bar is also **indeterminate through the build**, and honestly so —
that work, like the boot screen's, is a single uninterruptible call, so there is
no progress to read even in principle, and an invented percentage always ends
up stuck at 90 while the real work finishes. The reflection bake after it DOES
have frames, so `setBuildProgress` turns the plate's words from BUILDING to
LIGHTING on its first call and gives the bar a figure on the first one that is
not zero — a bake always arrives reporting none of itself done, and a bar
stopped to show "0%" stands still over work that is happening.

**The settings screen is the third title screen, and the one that shows a
list can belong in the front end.** It was drawn in the shell — a heading, a
strip of four tabs, two sliders floating in the middle of a black page beside a
key table, a hint line naming three devices — and it read as a form. It is laid
out the way the menu and the kit screen are now: the PAGE's name is the title,
set large with its number hollow behind it and a strip of figures under it; the
pages are a tab strip the bumpers turn, the menu's reel in another guise; the
rows are a column of plates under it wearing the menu's sight brackets; an
INTEL plate on the right says what the cursor's row does and what it comes to
on this machine; Back is the system corner; the prompts are drawn on their
controls for the device in hand. Every block is a named grid area over four
templates, as on the other two.

- **It stands over the SCENE, not over a black veil.** Everything it can be
  raised over — the menu, the deploy map, the pause card — is DOM, so it takes
  them off the glass while it is up (`#hud.setting`, the kit screen's
  `.kitting` for the kit screen's reason: `visibility`, so what it covered
  comes back unredrawn) and lays a scrim shaped like its layout over what is
  left. Over the menu that is the map's photograph (`#menu-shot` is carved out);
  over a pause it is the round, and **a render scale, a shadow tier or the paper
  grain chosen there is SEEN changing behind the plate that chose it.**
  `#hud-fps` is carved out too — the Display page switches it on.
- **Two axes and a page.** Up and down walk the rows, left and right step the
  row's value, and the bumpers (LB/RB, Q/E) turn the page from anywhere. **The
  tab strip is ROW 0 of the cursor's list**, so the bumpers are an accelerator
  and never the only way in (this file's rule for every screen here): a pad
  player who never thinks to press one still walks up onto the strip and steps
  it with left and right. Turning a page from the strip leaves the cursor on the
  strip; from a row it goes to the TOP of the new page — row 3 of Display is not
  row 3 of anything else. The bumpers and the strip both CLAMP, being one choice
  reached by two keys.
- **Left/right clamp; Enter wraps.** Left on the lowest rung has to stay put, or
  a player stepping down a resolution list lands back at the top and reads it
  as the setting having refused; Enter is one key asked to reach every value, so
  it comes round. The stepper's arrows are drawn spent at the ends for the same
  reason, and a click on its VALUE is Enter under a pointer.
- **Hover moves the cursor here, where it does not on the kit screen.** The
  kit's rail is somewhere else and the mouse crosses other slots to reach it;
  here every row carries its own control, so the row under the pointer is
  always the one it is about to use. A press on a control also takes the cursor
  — there is no hover on glass.
- **`show()` resets the page as well as the row**, for the reason the kit screen
  resets its cursor — and because a screen that opens on Display because that
  is where you were last week hides the bindings from the player who came
  looking for them.
- **It is BUILT on a raise and PATCHED after**: the title on a page turn (which
  is how its wipe replays), the rows on a page turn (and they DEAL in), the
  values on a pick, the brackets and the intel on a cursor move. A slider
  patched rather than rebuilt is also what keeps a drag alive across the rungs
  it crosses.

**The settings list is a ROW TABLE, and every row is the same thing: a labelled
choice over one field of `Settings`.** A toggle is a two-option choice, so Off/On
and a three-rung resolution ladder go through one renderer, one key handler and
one hit-testing path. What a longer list changes is only how the cell is DRAWN.
A short list is a STEPPER — the console idiom, the chosen value between two
chevrons with a pip per option under it, so an Off/On reads as two and a shadow
tier as five without a word being read; it shows ONE option at a time and the
intel names them all. A row can ask for `style: "slider"` and be laid along a
track instead, because sixteen pips under a word are a ruler nobody reads.

**A page is what this list GROUPS by, and it replaced a heading row for a reason
that is about height.** A list that outgrows its column does not get a scrollbar
anyone looks for, it gets a row nobody sees. A heading buys an inch of separation
and spends the same height as a row; a page buys the whole rest of the list
back. The split rule is the mechanical one — a page that outgrows the column on
a landscape phone splits into another page, exactly as a section would have
split into another heading. (The list does scroll, as the last resort it is:
a pad on a landscape phone puts the bindings under the Input page's rows, and
the cursor's row is kept on the glass.)

**The bindings are drawn for the device IN HAND, under the Input page's rows.**
Both halves of every binding are prompts (`glyph`), so the root's `dev-*` class
draws the keyboard's caps or the pad's own buttons — the green A, the bumper
tab — and never both; a column of pad names beside a column of keys the player
is not holding was a table read by halves. Under a finger it gives way to a
sentence: the controls are drawn on the glass and name themselves. It carries
no `data-row`, so the cursor steps straight past it; it is in the column rather
than the intel because the intel is the first thing a small viewport drops, and
a 1280x720 laptop with a keyboard is not a viewport that should lose the
controls table.

**A row says what its value WORKS OUT TO, and that is computed rather than
written in the table.** "75%" and "1.25x" are both numbers over something the
screen never shows — a panel's pixel count, a rate in radians — so `figureFor`
resolves each against the machine (`1280x800`) or against `CONFIG.camera`
(`202° per 1000 px`, `160°/s at full stick`), and the gyro row reports what the
SENSOR is doing. A player comparing this game against the shooter they came
from is comparing sweeps, not multipliers. The figure is on the row's own PLATE
as well as in the intel, because that is the line a viewport with no room for
the intel still owes the player; the row's sentence comes back as the SAY line
under the list for the same reason.

**The Display page's title strip is the MACHINE** — the window, the pixel ratio,
the native size — and it is a function rather than a string because every figure
in it is measured when it is drawn (and redrawn on a resize while the screen is
up). A settings screen reporting the size the window was when the bundle loaded
is worse than one reporting nothing. Every other page's strip is one sentence,
so a page turn never moves the list under the title.

**The list's grid track is `minmax(0, max-content)` with a `1fr` row after the
say line**, not a `1fr` of its own: a short page would otherwise strand the say
line at the foot, a screen away from the row it describes.

- **The slider is positioned by option INDEX, not by value**, one rung per equal
  share of the track. That is what keeps it a choice over the same `options` the
  arrow keys step and the same list a codec validates against: a drag cannot land
  on a value a keypress could not reach. It also preserves a ladder's spacing —
  `CONFIG.camera.lookScales` is geometric, so an inch of drag is the same *ratio*
  of look speed wherever it is taken.
- **The drag lives on the WINDOW and its geometry is captured at the press**, so
  a drag that runs off the track, over another row or off the screen keeps
  moving the thumb it started on. The track's box is measured once — nothing
  about the row's layout depends on the value.
- **The thumb's size is declared in CSS and read back off the DOM**, never
  restated in the script. Both the paint (`left: calc(var(--t) * (100% -
  var(--thumb)))`) and the hit maths need it, and two copies of that number are
  two things that drift into a thumb sitting where the value is not. The script
  writes `--t` and nothing else.
- **Hover does not move the selection while a slider is held.** The drag is on
  the window, so the pointer wanders over other rows mid-drag, and taking the
  selection from one would walk the highlight onto a row the drag is not
  changing.

**A class on `#hud` belongs to whoever raises it.** `OverlayScreen` sets
`.overlaid`, `LoadoutScreen` sets `.kitting`, `SettingsScreen` sets
`.setting`, `HUD` sets `.paused`, `.editing` and
`.dying`. That is why a pause is two calls from `Game` rather than one: the card
goes up and the HUD's own aiming chrome comes down, and they are not the same
decision — `.overlaid` would take the tickets and vitals with it, which under a
pause are still true.

**The Tab board is a title screen for the STANDING, held over the round**, and
it is `Scoreboard` (`ui/Scoreboard.ts`, `scoreboard.css`) rather than a part of
`HUD`, because its lifetime is the ROUND's rather than the armed player's: it is
owed to the deploy screen, which takes the HUD's gameplay chrome off. It is
built straight after `HUD` and before every other screen. It read as a web table
in a dialog — CONQUEST the largest word on it, a spreadsheet of team totals, two
small grids of rows — and it is laid out as the front end is now. **The title is
the two reinforcement counts facing each other**, each in its own side's colour,
across the margin between them drawn as the round-over card draws it (the two
counts against each other, not against the pool: the HUD's own gauge over the
top of the screen already says how far each side has fallen, and what the board
adds is who is AHEAD). Each side's flags, points and kills sit under its
numeral, and an eyebrow says what is being played. **Each side's list is the
round-over card's board line for line** — a place, the side's mark down the
leading edge, the name, kills, deaths and the points it is ranked by, last and
brightest, the player's own line hot — because the card that ends a round shows
the top of this board, and two drawings of one board is a board a player learns
twice. The round goes DOWN behind it under a scrim rather than away, and the
entrance (a fade and a short rise, the margin bar growing in) is keyed to the
RAISE, never to a patch.

**It is sized on the FRONT END's unit rather than on the HUD's ladder** —
`#scoreboard` is on `base.css`'s `:is(...)` token list, so `--u`, the `--t-*`
type and `--cut` reach it, and it takes none of the prompts because nothing
on it is pressed. A 1440p monitor gets the 1080p board a third bigger and a
phone gets it at the floors; nothing is scaled to a short viewport (the old
`scale(0.8)` for a deep board on a phone is gone). **Its templates are the
front end's**: wide; a phone held sideways, where the title comes down to one
band and the caption under the bar goes; a smallest-phone rung that drops the
place column, the thing a twenty-character name in a match runs out of room
beside; and an upright fallback that stacks the sides and scrolls.

**A DEEP roster (over `DEEP_ROSTER`, 24 bodies: Sarab and Cinderhaven, offline
AND in a match) splits each side into two LISTS in rank order**, the top half
down the left and the rest down the right, each with its own heading. It used
to flow one list into CSS `columns`, which left the right-hand column's figures
unlabelled. **The name is the column that must not give**, since NOVEMBER-3 is
what every bot past the twelfth is called, so a deep line gives up the DEATHS
first, the PLACE next in a match (the ping column taking a track), and on a
phone the place always and, in a match, the kills. What is left on the
smallest phone in a 48-body match is who, their points and their connection.

**The board's frame is built once and patched by text; its LISTS are rebuilt as
markup, and their rows are BUILT rather than interpolated.** Tab is a held key,
so `Game.pushScoreboard` pushes the panel on every frame it is up; a key over
everything the lists say is what keeps that to a rebuild per change, and the
per-body rows are in that key because a kill anywhere reorders the column it
lands in. The standing has a key of its own and is written into the frame by
`textContent`, while every row goes through `document.createElement` and
`textContent`, because one of its fields is **a name another player typed**. The
server bounds that string's length; nothing bounds what is in it, and
`Scoreboard` is where it is finally drawn. A bot's name is not on the wire at
all: `entities/callsigns.ts` derives one from the roster index, which is the
same number on every screen.

**The ping column exists only in a match, and whether it does is TOLD rather
than derived.** Offline there is no server to be any distance from, so the
column is not there at all — a grid track added by a class on the panel.
In a match it is there from the first frame, because the authority's first table
arrives a second into the round and a column that grew when the first number
landed would reflow every name on the board under a player already reading them.
A body with no connection behind it (every bot, and a peer whose first ping has
not come back) gets an em dash and never a zero, which would read as the best
connection in the round. The number and the band its colour comes from are
`ui/ping.ts`, which the lobby's own reading also goes through — the same
connection is measured on both screens, and a player told "fine" on one and
"poor" on the other at the same number learns to trust neither.

**It is pushed from `tick`, in every state with a round behind it** — playing,
the death cam, and the DEPLOY SCREEN, which is where a player most wants it: in
a match that screen is where you sit out every reinforcement clock while the
round carries on without you. The push is one line after the state switch and
before the render, so the state a frame ENDS in decides, and the six ways out of
a round no longer each owe a `scoreboard.set(false)` — the one that forgot would
leave the numbers hanging over the next screen. It goes away under a lid
(`paused`, `loadout`, `settings`) because a lid is a screen the player asked
for. `#scoreboard` carries a `z-index` for exactly one reason: every screen
appends itself after `#hud`, so DOM order alone would bury it under the deploy
screen it is meant to be read over.

**Your side is the LEFT column, whichever side you were seated onto.** A board is
read from where the reader is standing, and a column that changes ends between
matches is one a player has to find before they can read it. The rows are sorted
by SCORE, then by kills, then by fewer deaths, on a stable sort, so bodies level
on all three keep roster order instead of trading places while somebody is
looking at them.

**Points rank the board, and that is the reason the column exists.** A round
is won on flags and lost on tickets, so the player who took three of them has
done more for the win than the one with four more kills — and a board ordered
by kills says the opposite in the one place everybody looks. The number is the
`ScoreBook`'s (`config/score.ts` is the table it spends); it closes the line,
brightest, where the round-over card puts it, and the figures are tabular
because a sorted column of proportional digits does not look sorted.

**The score FEED is where a player actually learns the scoring system**, and it
is a separate thing from the board: the board is behind Tab and shows a total,
while the feed says "+250 CAPTURE" at the moment the flag flips. One line per
award, so a headshot on an attacker in your own zone is three of them stacked —
that itemisation is the feature rather than a side effect, which is why the
authority sends one `score` event per award instead of a total. It is anchored
by its BOTTOM edge over the ammunition column, so the newest line sits still and
the older ones ride up off it; a top-anchored stack slides the line the player
is reading downward every time another award lands. It lives on the right
because that is where the HUD's numbers already are — centre is `#message` and
`#capture-status`, and anything that moves in the middle of the screen reads as
something to shoot at. `HUD.LABELS` is a total map over `ScoreKind`, so a new
award in `config/score.ts` does not compile until this file has decided what to
call it.

**`#capture-status` is UN-PANELLED, and it was the last piece of gameplay
chrome that was not.** It said which side of a capture boundary you are standing
on from inside a chamfered plate with a border and a near-opaque fill — the one
thing `base.css`'s house rules name outright as what makes a HUD look like a web
page, and `#hud-bottom` gave up for exactly that reason years earlier. This one
kept it longest because it sits in the middle of the screen where a player
cannot look away from it, which is the argument for the plate and, once it is
written down, the argument against. What replaced it is a soft radial scrim with
no edge anywhere in it: the same legibility over a lamp-lit street or bright
sand, and because it has no boundary it reads as the screen darkening under the
words rather than as a box laid over the village. The three lines carry the
hierarchy the plate was standing in for — the zone loud, the meter watched, the
state a caption under it — and the meter is skewed and segmented at the vitals
bar's own proportions, because two meters on one HUD drawn to two ideas read as
two different games.

**Nothing on that element may carry an ANIMATION, and the reason is one line in
`setCapture`.** The panel's className is rewritten on every whole percent the
meter moves, a className write restarts every animation on the element, and the
contested pulse used to live there — so it ran its first frame several times a
second and never got any further. It is on `.cap-state` now, whose only write is
a text node, and what it pulses is OPACITY for `#outbounds`'s reason: motion is
what the eye catches while its owner is being shot at, and a hue change is not.
The state line is also `nowrap`. The longest string it can hold is a contested
zone on Sarab, where `MapLayout.perTeam` bounds the count at 24, and a second
line would move the meter and the name into the middle of the screen every time
the number crossed the width.

**`#outbounds` is the one thing on the HUD that is the map's EDGE**, and it is
the loudest thing the chrome draws for exactly that reason. On the three maps
closed by the rim it never appears: there is a wall and the player is standing
against it. On one with a `MapLayout.borderland` there is no wall, no rock and
deliberately no invisible barrier to bump into (see [`docs/world.md`](world.md)),
so this panel IS the boundary, and a player who does not read it dies of
something they never saw. It sits at 13% — above `#message`'s 24%, because both
can be up at once when a flag falls while somebody is walking off the map — and
`Game` pushes it from `updateHud` beside `setCapture`, null while dying.

Two decisions inside it. The count is dark red from the FIRST second rather than
turning red at the end, because a warning that reads as advisory for six seconds
and as an emergency for four spends the six a player could still act on; what
`.urgent` changes is the RATE it pulses, since motion is what the eye catches in
peripheral vision while its owner is being shot at and a hue change is not. And
the count is rounded UP and written once a whole second, so it opens on the full
ten and shows a 1 only while there is genuinely under a second left.

**The minimap is PLAYER-CENTRED and HEADING-UP, and everything else about it
follows from that pair.** It used to be the whole map, north-up, matching the
deploy screen — which was a fair picture of a 240 m village and a useless one of
a 400 m vale, where a barn was two pixels and the five flags sat inside the
middle third. Now `CONFIG.minimap.viewRange` metres reach the mid-edge of the
canvas, the player is nailed to the centre, and the world turns under them, so a
bearing taken off the map is the bearing the picture above it is already
showing — the reason the arrow points up and never anywhere else.

Three things are owed for that, and each pays for a thing the old view got for
free. **NORTH**, which a turning map spends: the frame's mark is no longer a
static `N` but the heading the top of the canvas is pointing at, drawn `↑ NE`,
and it sits OUTSIDE the canvas in the gap above the frame because the rim inside
now carries lettered markers of its own. **The OBJECTIVES**, which a zoomed map
stops showing and which are the only reason to look at one: every control point
off the drawn disc is pinned to the rim on its own bearing, carrying its
letter, its owner's colour and the contested pulse, so the way to the next flag
is always on screen. The rim it is pinned to is the plate's own circle and the
pin is one EUCLIDEAN test, which is the second thing the round plate bought:
while the plate was a chamfered square the test had to be Chebyshev, because a
circle inscribed in a square posts a marker for a flag the player can already
see sitting in a corner. There are no corners now, so "off the map" and "past
the rim" have become one question.
And **the player's own arrow needs no clamp any more**: it was clamped because a
borderland let its owner stand eighty metres off the bitmap, and a canvas clips;
now it is the one marker with no arithmetic behind it at all.

**The PLATE is translucent and the SHAPE is the canvas's, and those two are
one decision.** The map used to paint an opaque rectangle over the village with
its chamfer clipped in CSS and its edge drawn as a solid layer showing a pixel
proud behind it — the `.hull` trick every chamfered panel in the interface uses.
Thinning the plate breaks that outright: an edge layer BEHIND a see-through
canvas is a lit rectangle rather than a line, and a CSS background under one is
the opaque square the plate stopped being. So `Minimap.ts` owns the shape now —
it clips the outline and strokes the hairline in canvas pixels, the CSS box and
the backing store already being the same size — and `minimap.css` is left
positioning the box and styling the compass.

**And the shape it clips is a DISC**, which is the one place this map departs
from the chamfered plate the rest of the interface is cut from, and it departs
on purpose: a heading-up map is a COMPASS ROSE, its boundary is a reach rather
than a frame, and a square boundary states a reach that is half again as long
along the diagonals as it is on the axes. `CONFIG.minimap.viewRange` is
therefore the radius in every direction now, where it used to be the mid-edge
and the corners quietly showed 85 m of a 60 m promise. The element stays square
— `--hud-map` sizes the box, the compass and the drop shadow are positioned
against it — and the circle is inscribed in it by `Minimap.outline`, the one
description of the shape that serves both the clip and the hairline. The shadow
follows the canvas's own alpha, so it comes out round for free; a
`border-radius` on the element would round the plate instead of the drawing and
clip the antialiased edge the canvas has already drawn. What that buys is the same
thing `#hud-bottom` and `#capture-status` buy: legibility from a scrim rather
than from a panel, and a map that sits IN the scene instead of on top of it.

**Everything drawn inside it is drawn in the HUD's own face**, read off the
element once with `getComputedStyle` rather than restated as a stack. Canvas
takes a font as a string and inherits nothing, so the flag letters were the
browser's UI face sitting in the corner of an interface set entirely in
`--font` — the one thing on this map that was not the same piece of software as
the rest of it.

**The backdrop is the shared PLAN, prerendered north-up and turned under the
player.** It is `mapPaint.ts`'s — the same ground, water, carriageways and
built mass the deploy screen and the menu draw, at this map's own
magnification — and what is this file's is only the two things a TURNING map
owes: `twelve`, which keeps a capture dial's zero at the top of the glass
whichever way the world is facing, and the contested pulse. The grid is drawn
as LINES and never lettered, because a lettered square would be read upside
down half the time and what the lattice is here for is the sense of speed a
moving one gives. The player's own arrow now stands on a dark pad: the plan
under it is a town drawn in pale grey mass rather than the flat near-black
plate that arrow was designed against, and a white arrow on a white roof is not
a marker.

**What the backdrop stops at is the PLAY SQUARE**, and on a map with a
borderland that edge is worth the pixel it costs — it is the line the leash is
counting its owner down against, so the ground past it is painted a duller tone
and the square's own border is stroked into the prerendered image. The backdrop
is prerendered at the SAME pixels-per-metre the canvas draws at, so turning and
scrolling it is a 1:1 blit and nothing blurs; that makes it as many pixels
across as the play square is metres times that scale — 733 px on Harrowmead's
400 m — which is why the scale is a fixed number and not something a zoom
control moves.

**The magazine strip is markup the WEAPON TABLE sizes**, and it is the one place
a number in `CONFIG.weapons` reaches the DOM. `HUD.setAmmo` builds one `<i>` per
round in the carried weapon's magazine — the count is what makes the strip
readable without reading the number — so the row's length is a weapon's
`magSize` and a new weapon can make it any width it likes. The box is therefore
FIXED at the health bar's 224 px and the ticks are fitted into it: the pitch
gives way, never the count, and never the strip's own width, which would
otherwise redraw the right-hand column every time the kit changed. Ticks keep
their authored 5 px until a magazine is bigger than 32 rounds; the LMG's belt of
75 is what closes them up.

**Past a 3 px tick the strip takes a second ROW rather than closing up further**,
because 75 rounds in one row is a 2 px tick behind a 1 px gap — a bar with a
texture, which is the one thing the strip exists not to be. The threshold is that
measurement and not a round number, so a future magazine earns the row by being
unreadable without one; today only the belt qualifies, and the SMG's 34 still
draws as one row. The second row is paid for out of the tick's HEIGHT, inside the
same 13 px box, or the ammo count and the weapon label under it would move every
time the kit changed — the whole point of fixing the box. **The rows are filled
by COLUMN, not by line**: consecutive rounds are the top and bottom of one
column, so the lit fraction of the strip is still the fraction of the magazine
left, which is the reading every one-row weapon gives and the only reason a
second row is allowed at all. Filled by line, the top row would stay full until
the belt was half gone.

**The stowed slot is the only thing on screen that says the second weapon
exists.** Everything else in the bottom-right corner describes the weapon in
the hands — the viewmodel shows one gun, the big count counts one magazine, the
strip is one magazine's ticks — so a player who never pressed the swap key had
nothing telling them there was a key to press, and a sidearm nobody knows about
is a sidearm nobody draws when the rifle runs dry. That is the whole of what it
is for, and it decides how it is drawn.

- **It shares the ammunition LINE rather than taking a row of its own**, at the
  far left of it, in the space a two- or three-digit number was already leaving
  empty. The line is spread across the same 224 px as the health bar, the strip
  and the kit caption, so the second slot costs the corner no height and no
  width — it is drawn in a hole that was already there. Two slots on one line,
  the carried magazine shouting at the right end and the slung one murmuring at
  the left, is the hierarchy stated as a layout instead of as a caption.
- **Three parts, each at its own weight, and the KEY is the brightest.** The
  group is not dimmed as a whole: the chip is the instruction and is drawn dark
  on near-white to be read at a glance (a hint you have to squint at is a hint
  nobody follows), the count is the fact you act on, and the name is only there
  to say which weapon the other two are about. It gets **no strip of its own** —
  a second row of ticks beside the magazine's is two instruments competing to be
  read, and a count is enough for a weapon you are not firing.
- **It carries a live count, not a capacity.** Each slot keeps its own magazine
  ([`weapons.md`](weapons.md)), so what is slung is what you would be swapping
  *to* — pushed every frame like the carried one, each write skipped while its
  string has not moved.
- **Two states raise its voice, and they are opposites.** `dry` is the slung
  magazine being empty too, the mirror of `#ammo-mag.low`: a swap will not save
  you. `ready` is there being nothing to fire in your hands (empty *or*
  reloading) while there is here — the one moment in a round when the second
  slot is the whole answer, since a draw is a third of a second where a reload
  is one and a half. **`ready` is a handover, not an alarm**: the carried
  readout already dims itself through a reload, so the stowed slot coming up as
  that goes down reads as the corner pointing at the faster option, and it earns
  no animation on top. Firing the last round starts a reload in the same call,
  so "empty and not reloading" is a state the HUD would never get a frame of —
  which is why `ready` counts the reload rather than excluding it.
- **The name and the key turn over with the hands, through `Game.applyCarry`**
  — the same push that moves the kit caption, so the two can never disagree
  about which weapon is which. `Player.slungSlot + 1` is the digit on the chip,
  which is the same one fact `drawSlot` and the `1`/`2` keys already share.

**One stylesheet per module that writes markup, imported by that module**
(`HUD.ts`→`hud.css` … `editor/EditorPanel.ts`→`editor/panel.css`); `main.ts`
imports `base.css` first. Vite bundles them into one hashed stylesheet the built
`index.html` links from its head. All of it was once ~2,050 lines inline in
`index.html`, which cost three things worth not paying again: no compile-time link
between markup and the rules styling it, so a renamed class was a silent visual
break; the editor's ~170 lines shipped in every production build; and a CSS-only
change moved no content-hashed filename. Three rules keep it that way:

- **`base.css` is for what two or more screens share** — the reset, the canvas, the
  `#hud` root, `.frame`, `.brackets`, `.hidden`, `@keyframes pulse`, the kit button, the design tokens and the two
  pieces of vocabulary left from the shell (`.ui-eyebrow`, `.ui-facts`), and
  THE FRONT END's unit, type scale, plate and prompts, which every title
  screen is measured in. A rule only one screen uses
  belongs in that screen's sheet however tempting the shared file is.
- **A screen's state rules go with whoever sets the class**, not whoever owns the
  element: `#hud.paused #deploy { opacity: 0.18 }` is in `hud.css` because
  `HUD.setPaused` puts `.paused` on, even though `#deploy` is the deploy screen's.
- **`index.html` gets no interface CSS, ever, with exactly two exceptions**, and
  both are there because they are what the page shows while there is no
  interface. The first is a black `html, body` background: a production build
  links the stylesheet render-blocking from the head, but the dev server injects
  it from JS, leaving one frame of default white — on a night game that reads as
  a camera flash. The second is the boot screen's own block, for the same reason
  one step further along. Neither may grow a rule that styles anything a module
  writes, and nothing else may be added beside them.

## The three maps are one drawing

**This interface draws the same place three times — the menu's intel plate, the
deploy screen and the corner minimap — and until they were made one drawing
they were three.** The menu plotted a placement as a grey square, because a
`Placement` is a point and a kit name; the deploy screen filled every collider
box flat `#39434a`; the minimap filled the same boxes translucent white over an
opaque plate. Each had its own idea of what a building, a road and a shoreline
looked like, none of them showed the ground, and a player who learned a map off
one of them had to learn it again off the next.

One description and one painter is the whole of the fix.
[`mapPlan.ts`](../src/ui/mapPlan.ts) is WHAT is drawn — the floor, the water,
the carriageways, the masses — and [`mapPaint.ts`](../src/ui/mapPaint.ts) is
what it LOOKS like. A screen supplies a projection and draws its own overlay on
top, which is the half each of the three knows something different about: the
menu has five control points and no round, the deploy screen has live
ownership and a cursor, the minimap has a heading and a rim.

**A plan is the static ground and nothing else, and that boundary is what keeps
one type from being three.** Flags, spawns, bodies, meters and cursors are the
screen's, because the three know different amounts about them; a plan that
carried the union would be three objects wearing one name. What IS shared
beyond the ground is the two marks that must be the same mark everywhere — a
control point's zone and the flattened hexagon `hud.css` clips its flag chips
to. A player reads B off the strip along the top of the HUD, off the deploy map
they picked it on and off the corner map on the way there, and three shapes for
one flag is three things to learn.

**The two adapters differ in one thing and it is not detail — it is WAITING.**
`planFromWorld` takes a built `GameMap` and is synchronous. `planFromLayout`
takes a `MapDef` and both of its bulk halves, either of which may not be here
yet, and draws what it has — see the menu's bullets under *Getting into a
round* for what that buys and what it costs.

**Colour means OWNERSHIP, and that is the rule a new layer has to hold.** The
ground, the water, the carriageways and the built mass are a value ramp off the
map's own hue and nothing else; the only saturated things on any of these three
surfaces are the flags, the bodies and the cursor. A drawing where the town is
as loud as the objective is a drawing a player has to search. The hue itself is
pulled most of the way to neutral before anything is multiplied by it: a
normalised map colour is a fully SATURATED one, so Harrowmead came back the
purest green the drawing owns and every gap between two of Hollowmere's
buildings read as a warm tan lane somebody had put there.

**The same plan is read at 0.15 px/m and at 4.2, and the layers gate
themselves on that.** The contour interval is chosen so the lines are never
closer than about nine pixels whatever the ground is doing, fences appear only
where a fence would be more than a stipple, and the grid's cell is a round
number of METRES near a tenth of the extent rather than a fixed count of
divisions — eight divisions of Hollowmere is 30 m and eight of Cinderhaven is
187, so the same drawing said two different things and neither of them was a
distance.

**A building is not a box; it is eight or ten WALLS, and every version of the
mass layer has had to answer that.** Drawn honestly a 0.25 m wall is a quarter
of a pixel on the menu's intel plate, so the town vanishes; thickened, the same walls are
a field of disconnected four-pixel dashes, which is what Hollowmere read as —
confetti, not a plan. So the rectangles are grown by a metre and a half a side
into an offscreen sheet, which welds a building's own walls into one silhouette
and leaves the street between two buildings open, and then the TRUE rectangles
are drawn back over that silhouette a shade brighter. The wall lines are there
to read at a magnification that can hold them and disappear into the mass at
one that cannot. One sheet composited once is also what keeps it honest where
shapes overlap: painted straight onto the plan, two translucent walls crossing
would be brighter than either and a dense quarter would glow.

**And it is filed by the long RUN, never by area.** At six square metres a 6 m
wall (1.5 m²) is dropped and a 2.5 m crate (6.25 m²) is kept, which left one
mass standing on the whole of Greyfen and drew Hollowmere as a scatter of
cover. The long axis is what separates a thing that ENCLOSES from a thing that
stands in the open, and it does it on all six maps at once.

**All three PRERENDER and blit.** The plan costs about 70 ms on Cinderhaven —
3,700 colliders, a 250 x 250 heightfield, a waterline bake and a road network
cut into 6,000 convex pieces — and the deploy screen redraws every frame a
player waits out a reinforcement clock. So each of the three builds the picture
once, when its map or its backing store moves, and spends a frame on the five
flags and the cursor. The minimap's translucency is one alpha on that BLIT
rather than an alpha per colour, which is also what lets the plan's own value
ladder survive instead of flattening a three-storey block and a yard wall into
one wash.

## The gauges' metric: one authored pixel, four rates

The front end above is the SCREENS. The chrome — the minimap, the reinforcement
gauge, the flag strip, the vitals, the ammunition, the killfeed, the driver's
band — is a different problem with a different answer, and this is it.

**It was authored in pixels for a 720p window**, and every number in `hud.css`
still is: a 224 px health bar, a 46 px ammunition numeral, a 13 px magazine
strip, a 220 px minimap. On a landscape phone that is roughly twice the chrome
it should be, on about a fifth of the area to put it in. The two symptoms are
the ones anybody notices first — the map is too big, and the readouts crowd the
middle of a screen that has none to spare.

**The fix is a UNIT, not a transform, and that distinction is the whole
section.** `--hud-u` in [`base.css`](../src/ui/base.css) is one authored pixel,
and every size in `hud.css` and `minimap.css` is stated as a multiple of it —
`calc(224 * var(--hud-u))`. A transform was what this used to be (`--hud-touch`,
on the bottom band and the minimap), and a transform can only do one thing to
everything it covers: at the scale that brings a 46 px numeral down to a phone's
size it takes a 10 px caption to six, which is not a caption any more. A unit
can be several units, and the HUD's three jobs want three of them:

| ladder | what it carries | floor |
| --- | --- | --- |
| `--hud-cap` | the micro-captions — VITALS, FRAG, the weapon's name, 8–13 px | 0.88 |
| `--hud-mid` | the ticket counts, the flag letters, the centre message, the vehicle readouts, 15–28 px | 0.78 |
| `--hud-num` | the two display numerals, health and ammunition | 0.66 |
| `--hud-u` | everything that is a SHAPE rather than a word — bar widths, insets, gaps, pips | 0.62 |

All four are `clamp()` over `vmin` against a reference of 800, so **a desktop
and a laptop are untouched** — a 1366x768 window lands at 0.96 and a 1080p one
saturates at 1 — and it is the phone the ramp is really for. `vmin` and not
`vh`, for the front end's own reason: an ultrawide is short for its width, and a
phone held upright is not a tall screen with room to spare.

**`--hud-map` is the minimap and is a SIZE rather than a unit**, because it is
the one readout whose cost is an AREA: 220 px is a tenth of a 1080p screen and a
third of a landscape phone, which is why it is the first thing that reads as too
big. `Minimap.ts` watches its own canvas and matches the backing store to
whatever the stylesheet resolved to, so the map is REDRAWN at its size rather
than resampled — see below.

**The TRIM is the on-screen controls asking for the corner.** `#hud.touching`
(`HUD.setTouching`, pushed per frame from `Game.pushTouchControls`) multiplies
the ladder by 0.78, and the captions by 0.94 for the reason they have a rung at
all. It is keyed on the CONTROLS being up and not on the viewport, which is the
case no ladder above can cover: **a tablet** is tall enough that none of them
has engaged and still has a 96 px trigger standing on top of its ammunition
count. What it replaced hid nothing and still does — every gauge is exactly as
true on a phone, and the band is laid out smaller rather than drawn smaller.

Three rules for anything added to `hud.css`:

- **Anything that MOVES during play moves on `transform` or `opacity`, never on
  a property that lays out or paints.** Every gauge fill is the whole track
  scaled down (`scaleX`, the flag cells' `scaleY`) rather than a `width` or a
  `height`, and the low-health glow is a still shadow whose layer pulses its
  opacity rather than a pulsing `box-shadow`. The fills were widths and the
  glow a shadow until 2026-10-04, and none of it showed in the profiler: the
  `hud` phase was ~0.1 ms either way, because layout and paint are the
  browser's work after the tick returns. What it did was relayout and repaint
  the capture meter and its flag cell on every frame the player stood in a
  zone, the hull's loader through every reload, and the health bar on every
  frame it was low — the work FINDINGS.md §13 suspects on a phone.

- **State a size as a multiple of the ladder, never in bare pixels** — the one
  exception below, and hairlines, rims and chamfers, which are a pixel because
  a pixel is what they are.
- **An INSTRUMENT is exempt, and the test is whether its size is a claim about
  the screen.** `#gun-marker` is where the barrel points and `#hitmarker` is a
  confirmation drawn at the point of aim. Neither is a design decision that a
  smaller screen should scale, and both are left in pixels on purpose.
  `#scoreboard` is exempt because it is not on this ladder at all: it is laid
  out as the front end is, on `--u` and the `--t-*` type, with templates of its
  own (see the board's section above).

**THERE IS NO `#crosshair`, and the empty middle of the screen is the aiming
model rather than a gauge that went missing.** This HUD draws nothing at the
centre that is a claim about where the rounds go, because the game already has
an honest instrument for that and it is not on the HUD: the sight fitted to the
weapon, which `applyFit` cancels onto the very axis `CombatSystem` sends bullets
down (`docs/weapons.md`). Hip fire is UNAIMED — `Player.spread` is still
simulated and still reaches every round, it is simply not drawn, so a hip shot
is a judgement about a weapon the player can see rather than a reading off a
ring that opens and closes, and the third-person handover that used to fade a
crosshair out as the sight came up has nothing left to hand over.

There used to be one, and what it cost is worth stating so it is not rebuilt by
halves: four ticks whose gap WAS the live spread in screen pixels, faded out
against `adsBlend` because two aiming marks stacked on each other read as a
smear, hidden by `.mounted`, `.overlaid`, `.paused`, `.dying` and `.editing`
because in each of those it would have been lying, and pushed a frame at a time
from `Game.updateHud` off a viewport height cached by the resize handler. **The
two marks drawn there anyway are exempt because neither is an aim** —
`#hitmarker` reports a round that has already landed, and `#gun-marker` is drawn
where a turret actually points, which in a third-person view is exactly not the
centre. **Anything new in the middle of the screen owes that same test.**

**AND THE HIT CONFIRMATION IS ANCHORED TO THE GUN MARKER RATHER THAN TO THE
MIDDLE OF THE SCREEN**, which is the one place those two rules meet. The
hitmarker is drawn at the point of AIM, and on foot that is the centre because
the camera is the eye and the rounds go down the axis it looks along. In a hull
it is not: the eye is twelve metres back, the gun is walking toward the
player's look at its own rate, and a confirmation left at the centre reported a
round that landed most of a screen away from the only mark the seat draws.
`HUD.anchorHitmarker` is written from `setGunMarker` itself and from nowhere
else, so the two marks cannot come to hold two ideas of where this player's
rounds are going, and a seat with no marker at all — a truck's driver, a
turret swung round behind the camera — falls back to the centre, having
nothing to coincide with. It FOLLOWS the marker for as long as it stands rather
than pinning itself where the gun was when the round left: a mark abandoned
beside a traversing turret is the same complaint one step quieter. It moves in
`left`/`top` for `setGunMarker`'s own reason, the per-frame transform being the
pop.

**The minimap is the one canvas in the tree that resizes itself.** `Minimap`
observes its own element, sets the backing store to the box times the device
ratio, and leaves the 2D context scaled by that ratio — so every line in the
file is written in CSS pixels and comes out crisp on a handset, which the old
fixed 220 px store never was at DPR 3. Two consequences worth knowing before
editing it: the pixels-per-metre scale moves with the box, so the prerendered
backdrop has to be rebuilt when the box does (`buildBase`, split out of `setMap`
for exactly that); and the drawn furniture splits in two — **a SHAPE follows the
box down** (the chamfer, the view cone, the rim gutter) while **a MARK that has
to be READ has a floor** (`MIN_BLIP`, `MIN_GLYPH`), because a blip drawn to
scale on a phone-sized map is a blip nobody can see.

**A phone held upright is not a layout, it is a layout worth not being broken.**
The game asks for landscape everywhere it can — the manifest for the installed
app, `enterFullscreenOnTouch` for the tab — but the orientation lock is
Android-only and refuses outside fullscreen, so a portrait viewport is one this
HUD really does get. The top band has three tenants (the map in a corner, the
gauge centred, the killfeed right) and at 390 px of width they stack on top of
one another; no ladder fixes a collision between a CORNER and a CENTRE, so the
centre column moves down past the map and takes the killfeed with it. Keyed on
the aspect ratio and not on a width, because the question is whether this
viewport is taller than it is wide — a narrow desktop window is still landscape.

## The menu's backdrop

**The main menu stands on a photograph of the map that is chosen**, and choosing
another cross-fades to that one's. The pictures are real screenshots of the
running game — `shots/<id>.avif`, taken by `npm run shots` — and there is nothing
else in the tree they could be: the game ships no authored art, so the only
honest picture of Coldharbour at dusk is Coldharbour at dusk.

**The vantage is committed beside the image** (`MAP_SHOTS` in
[`mapShots.ts`](../src/ui/mapShots.ts)): where the camera stood, what it looked
at, and the field of view if it is not the game's own. A screenshot is an opaque
rectangle that says nothing about how it was made, so without the pose a map
whose chapel moved would have a backdrop nobody could retake without hunting for
the shot again. With it, a re-frame is a two-number edit and `npm run shots` is a
re-run. `pos.y` is metres above the SURFACE rather than a world height, because
the two valleys are heightfields and "eye seven metres up" survives a terrain
edit that would leave an absolute 11.4 buried in a bank.

**The table is the menu's and not the map's**, which is the one thing here that
had to be decided rather than derived. A map's `blurb` lives on `MapDef` because
a map's own file is the only place that cannot fall out of step with it — but a
`MapDef` is imported by the SERVER (`Match.ts`, `simulate.ts`), which has no
screen and no use for a quarter of a megabyte of JPEG per map. What that costs is
that a fourth map gets no backdrop until somebody gives it a row, and **that is
not a broken screen**: `mapShotUrl` returns nothing, the picture fades out, and
the menu is the one it was before shots existed.

**It is a root of its own — `#menu-shot`, a child of `#hud` at z-index 9 — and
both halves of that are load-bearing.** It is a class of its own as well,
`MenuBackdrop` (`backdrop.css`), which `Game` builds just before the overlay and
hands to the two screens that stand on it — the overlay's cards and the lobby —
so there is one picture with one cross-fade and neither screen reaches it
through the other.

- It must survive the card. `showMenu` rewrites `#overlay`'s markup on every map
  step, and a layer that is removed and re-inserted has no before-change style to
  interpolate from: the cross-fade would be a jump cut, on exactly the press it
  exists for.
- It must sit under the VEIL. A child paints over its parent's background
  whatever its z-index, and the veil is `#overlay`'s background — so a picture
  inside the card would be a picture on top of the scrim that makes the type over
  it readable.

So the backdrop needs no scrim of its own: the card in front of it is the
scrim. **What the menu did NOT take was the shell's veil**, and that is the
change that turned this card from a form into a front end.

**The scrim is shaped like the LAYOUT rather than like a frame.** The shell's
veil was an ellipse — dense at the edges, lighter in the middle, the same in every
direction — which is right for a screen whose reading matter is in the middle of
it and wrong for a card whose controls are a column down one side. Tuned dense
enough to hold small type over Coldharbour's dusk sky it put the whole
photograph behind a wash; tuned light enough for the photograph it stopped
holding the type. **There is no single density that does both, because the two
demands are in different PLACES.** So `#overlay.card-menu` states its own
background: dark behind the column, a band along the bottom and the top where
there is type, a softer one at the right edge for the intel, and the middle of
the window let through at full strength. **The column's gradient is measured
from the COLUMN** (`--gx` and `--col` in its colour stops) rather than from the
window, so on a capped ultrawide it still falls off just past the controls
instead of darkening the empty margin and fading before it reaches them. The
portrait and short-landscape templates carry their own, because the controls
are somewhere else in both.

**The picture DRIFTS**, 46 seconds a length, alternating: a title screen on a
still photograph reads as a paused game, and the same photograph moving a few
percent reads as a place. The animation is on `#menu-shot` — the CONTAINER —
because the two picture layers already own their own `transform`, which is the
cross-fade's settle, and two animations on one property is one of them not
happening. It never goes below `scale(1.06)`, so no amount of the translation
can pull an edge into frame, and it is a transform, so it is a compositor layer
and costs the main thread nothing. `prefers-reduced-motion` stops it, along with
the card's entrance and the Deploy button's sheen; the cross-fade is left alone,
being a transition rather than an animation and the thing that stops a map
change being a jump cut.

**The cross-fade waits for the image to DECODE.** Two layers, one showing and one
being prepared, swapped on `img.decode()` — a fade into a layer the browser has
not finished decoding is a fade into a blank rectangle followed by a pop, which
on a cold boot is every first visit to this screen. Whichever pick is the latest
owns the swap: a decode that lands after a later choice has been made is dropped
rather than fighting it for the front layer, which is what makes holding Right
along the map row safe.

**Every card but the menu takes it down**, the pause included — what a pause
stands over is the round you are playing, and a photograph of a map behind the
map itself is the same place twice. Two things take it away for free and are
worth knowing about rather than re-deriving:

- `#hud.kitting > *:not(#loadout):not(#hud-fps)` already hides every other child
  of `#hud` while the kit screen is up, and the backdrop is one. That rule is not
  decoration: the weapon on the turntable is drawn by the SCENE through a hole
  the kit screen leaves in the middle of itself, so a full-bleed picture left
  standing at z-index 9 would be what you saw in the hole instead of the gun.
- It is never scaled to a viewport, and was not when `#overlay` still was:
  a photograph has no authored size to be scaled from, and `inset: 0` with
  `background-size: cover` already
  fills whatever viewport it is given — including a portrait phone, which crops
  the 16:9 shot rather than letterboxing the menu.

## Getting into a round

Four screens stand between the title and the world, each driven by a pointer
*and* by a pad, with no path that needs the other. The fourth is the lobby, and
it is the one that is optional: it is how a NETWORKED round is chosen, and
picking a match out of it leaves through `startRound` exactly as Deploy does —
a networked round and a single-player one are the same `loading -> deploy ->
playing` cycle, differing only in whether `Game.net` exists.

**Every screen here is a LIST: move the cursor, A picks, B backs out.** That
replaced a screen per verb — left/right for difficulty, `L`/Y for the kit, `O` for
settings — which is a keyboard's idea of a menu: every action needs its own button,
and an action nobody found a button for is one a pad cannot reach (the settings
screen was exactly that). `L`/Y and the bumpers survive as accelerators; none is
the only way in. `O` and `M` did not: Settings and Online are the system bar a
mouse clicks and the cursor reaches, and a letter matching neither label was a
prompt nobody could guess.

- **The cursor is `OverlayScreen`'s, and it is a class on rows that already
  exist.** `MENU_ITEMS` is the list, `activateMenu` is what A fires, and the mark
  is a pair of sight BRACKETS closing in on two corners of the row, plus the
  row's caption lighting — never a fill, since the tier buttons and Deploy are
  *already* filled hot to say what is chosen. **Anything drawn ON a chamfered
  control has to be INSET**: every button here is cut by a `clip-path`, which
  clips its own element's outline and box-shadow along with the corner. That is
  why the brackets are pseudo-elements of the ROW (which is not clipped), why a
  focused plate's ring is an inset shadow, and why Deploy's glow is a
  `drop-shadow` filter on its row rather than a shadow on the button.
- **A / Enter fire the cursor's row and BREAK; Start still starts the round from
  anywhere.** Both flags come up on the same frame for A, so the order is the whole
  mechanism — without the break, A on the settings row opens the screen and then
  deploys the player out from under it.
- **THE POINTER DEPLOYS ONLY THROUGH THE DEPLOY BUTTON**, on this card and the
  round-over one. `confirmPressed` was "a button went down anywhere", mouse and
  finger alike, which is fine on a card that is only a title and wrong the moment
  the menu grew controls: the map and difficulty rows fire on the click's mouse-UP
  while the confirm reads the mouse-DOWN a tick earlier, so **choosing a map or a
  difficulty started the round on the same press**. Neither flag carries a pointer
  now; the button carries the mouse and the tap by itself. Restoring a
  click-anywhere confirm to a screen that has controls on it restores that bug.
- **The cursor survives a redraw and resets when the card is RAISED**
  (`OverlayScreen.card`). `showMenu` is called again on every map step, every
  difficulty change and on the way back from the kit, settings and lobby
  screens; a cursor that jumped home each time would make the row you just left
  the one place you cannot stay. On the menu that is now structural rather than
  a guard: the card is BUILT on a raise and PATCHED by every later call.

**The LEFT STICK drives all of it, and holding a direction repeats.** It is the
left stick alone (the right one turns the kit turntable), read raw against
`input.menuStickThreshold` rather than through the movement deadzone, because a menu
step is discrete and a stick resting a third of the way over must not scroll a list.
`InputManager` folds keys, d-pad and stick into two DIRECTIONS rather than four
buttons, so opposing presses cancel and a diagonal resolves into one step per axis;
`stepNav` turns a held direction into the edge-and-repeat the menus read. The repeat
is what makes a stick usable (it has no detent to tap) and deliberately does not
extend to confirm or back.

**The BUMPERS turn the page, from anywhere** — LB/RB on a pad, Q/E or Page
Up/Down on a keyboard (`menuPrevPressed`/`menuNextPressed`, a third `stepNav`
axis so opposing presses cancel and a held one repeats). On the menu the page is
the MAP, which is what lets the map reel sit in the cursor's list without being
the only way to reach it: a player on Deploy can look through every map without
leaving the button they are about to press. Nothing in a round reads these —
RB is the grenade and E is the vehicle verb there.

**Every screen measures itself, and what is left screen-local is what only that
screen has.** `--col` is a TRACK of the menu's own grid rather than the one
content width every block measured to — which was what made these screens a
column in the middle of a window (see the front end, at the top of this file).

## The main menu

**A title screen, not a form.** The chosen map's photograph fills the window,
its NAME is the largest thing on the card — set over the picture like a title
card, with its number in the rotation hollow and enormous behind it — and the
wordmark is a lockup in the corner. Everything the round is made of is one
column down the left: the map reel, the enemy, the kit and Deploy, in the order
the decisions are made. Online and Settings are a system bar in the top corner.
The right-hand side is an INTEL plate on whatever the cursor rests on.

- **The cursor's list is a RING, and that is what keeps one list honest on a
  screen that is not one column.** `MENU_ITEMS` runs Online, Settings, map,
  enemy, kit, Deploy: up off the top of the column lands on the system bar,
  which is where the bar is on the glass, down off Deploy wraps up to it, and
  left and right walk ALONG the bar (`stepMenuItem`). The two value rows step
  their value on left and right and CLAMP; A cycles them and WRAPS, so a
  confirm always changes something.
- **The maps are a REEL of photographs** — every map on screen at once as a
  slim slice of its own picture, the chosen one opened to a full 16:9 frame.
  It replaced a stepper, which replaced a strip of names, and each of those
  failed in one of the two ways a map picker can: a strip gave seven maps an
  equal share of one column and every one read as `HOLLO…`; a stepper named one
  map and hid how many there were. A photograph needs no label to be told
  apart. **The two card widths are multiples of the card's HEIGHT stated in
  the SCRIPT** (`CARD_SLIM`, `CARD_WIDE`) and handed to the stylesheet, because
  `centreReel` has to know where the chosen card will END UP while its width is
  still transitioning. A reel longer than its row scrolls: natively under a
  thumb (`touch-action: pan-x`, the one gesture this interface hands back to
  the browser) and by being re-centred on every step under a pad or a key.
- **The reel's pictures are THUMBNAILS the client makes** (`shotThumbUrl`):
  each photograph decoded once, drawn down to 480 px, re-encoded as an object
  URL and cached for the session. Seven cards pointed at the full 3840x2160
  shots keep seven 33 MB bitmaps alive for a strip whose widest card is a
  couple of hundred pixels, which on the phone this menu is laid out for is
  real memory spent on nothing — and the downscales run ONE AT A TIME, because
  the reel asks for all seven in one turn and seven full decodes in flight
  together is the same quarter of a gigabyte for a moment. The backdrop still
  takes the full shot. A map with no photograph keeps its plate, which is not
  a broken card.
- **Every PROMPT is drawn on its control, for the device in hand** — a key cap,
  a pad button in the controller's own colours (A green, Y yellow, the bumpers
  as tabs), or nothing under a finger, where the control is its own prompt.
  Both labels are in the markup (`glyph`: `data-k`, `data-p`) and the card's
  `dev-*` class picks one, so picking up a pad turns every prompt over in one
  class write with no redraw. `Game` pushes the device every menu frame from
  `InputManager.padInHand`/`touchActive` — **but only once `anyDeviceUsed`**,
  because a phone's first frame has touched nothing and would otherwise be
  prompted for Enter; until then the card keeps its own guess off
  `(hover: none) and (pointer: coarse)`. The foot's hint line follows the same
  class and is absent under a finger.
- **A prompt ON a control is a key that fires THAT control wherever the cursor
  is; the foot holds the cursor's verbs, and nothing is said in both.** Deploy
  carried Enter and A, which fire the CURSOR's row — and the cursor follows the
  mouse, so once the pointer had crossed the reel, Enter beside Deploy cycled
  the map. It carries the pad's Start now (which does deploy from anywhere) and
  no key, and the foot's "Enter Select" is the honest line. The bumpers are
  drawn on the reel's chevrons and the kit title's, so neither foot names them
  again. The same test holds on the kit screen, and on any screen that draws
  prompts next.
- **The card is BUILT on a raise and PATCHED after** (`buildMenu`,
  `patchMenu`), and that is what lets a map change ANIMATE: the chosen card
  opens, the hero wipes the new name in (`.swap`), and the photograph
  cross-fades, all on elements that were already there. Written wholesale on
  every press, as it used to be, each of those was a jump cut. The patch writes
  classes and text and REPLACES only the hero, because replacing it is how the
  swap replays; the hero is rewritten only when the map actually changed, so a
  difficulty change does not re-announce the same map. **The entrance runs on
  a raise and never on a patch** — `.enter` goes on the root in `setCardClass`
  before the markup exists. At boot `Game` shows the menu and then enters the
  `menu` state inside one task; the second call is a patch, so the entrance the
  first one started runs on (it used to be thrown away, which is what the old
  `MENU_ENTER_MS` window existed to paper over).
- **The intel plate is REDRAWN on every cursor move and nothing else is.** It
  has no listener, no hover state and no transition, so a rewrite costs one box.
  The map row and Deploy both show the map's PLAN with a key to its marks —
  the one thing the photograph cannot tell you is where the flags are — the
  enemy row the tier's meter and reaction time, the kit its table. **It is a
  PLATE and not an open column** because it stands on the side of the picture
  the scrim deliberately leaves light.
- **ONE UNIT, `--u`, is one pixel of a 1080-line screen**, `clamp()`ed over
  `vmin`: a console front end scales with the vertical resolution, so a 1440p
  monitor gets the 1080p composition a third bigger rather than the same
  pixels with more emptiness round them — which is what the shell's `clamp(…,
  88px)` ceilings did to this card. **Everything READ is `max()` of the unit
  and a pixel FLOOR** (the `--t-*` type scale, prompts, hit areas), because a
  phone's unit is half a pixel and a caption set to scale there is a caption
  nobody can read; the floors are what make the phone templates a layout rather
  than a miniature. A SHAPE (a gap, a chamfer) follows the unit with no floor.
  **`--hit` is a finger** — 44 px under a coarse pointer and 0 otherwise — and
  sits under every control as a `min-height`, so a desktop is untouched.
- **The frame is capped at 2.4:1 and centred** (`--gx`): a 21:9 monitor is used
  edge to edge and a 32:9 one gets the same composition in its middle, rather
  than a column of controls a metre from the intel it is read against. The
  photograph is not capped; it is its own root and runs to the glass.
- **Four TEMPLATES over one set of named areas**, chosen by the two things that
  actually run out. WIDE is column, art, intel. Under 1100 px wide or 620 tall
  the intel GOES — it is the one block that is not a control — and the hero's
  own figures (points, extent, visibility) are what is left of it. A phone held
  SIDEWAYS (landscape, 560 tall or less) is two columns — the map on the left,
  the enemy, the kit and Deploy on the right under the thumb — the only shape
  in which four rows and a title fit 360 px of height at a size a finger can
  use; there the TITLE is sized off the width (`6vw`), because it shares the
  width with that column and eleven capitals sized off the height ran under the
  loadout plate. A phone held UPRIGHT stacks the column at the BOTTOM of the
  glass where the thumbs are, capped at 680 px so an upright tablet does not
  get a Deploy button half a metre wide, with the photograph cropped into the
  space above it. Under 560 px wide the system bar keeps its marks and loses
  its words.
- **Nothing scales the card on a short viewport**: it is laid out for those
  viewports by its floors, and a scaled card is a scaled 44 px target.

- **The intel's schematic is never drawn from a BUILT map**
  ([`MapThumb.ts`](../src/ui/MapThumb.ts)). The deploy screen draws out of the
  finished collider set, which is the honest way to draw a map you are standing
  in; the menu is the one screen in the game where there is no built map at
  all, and building one to illustrate a row costs the ~0.7 s the building card
  exists to cover. Its palette is the map's own `EnvironmentSpec`, so a seventh
  map is coloured by what it ships with rather than by a table here somebody
  has to remember to extend.
- **It is nonetheless the same drawing the other two make, and what buys that
  is the COLLIDER BAKE.** This panel used to plot a placement as a square,
  because a `Placement` is a point and a kit name and the footprint belongs to
  the builder — so the menu said "there is something here" where the deploy map
  said what shape it was. `MapDef.collision` is that shape, it is already
  generated for the authority, and it is behind an `import()` exactly as the
  floor is. What it costs is a second lazy chunk per map row looked at, the
  largest of them 132 kB gzipped on Cinderhaven.
- **So this panel can paint THREE times for one row, and that order is the
  feature.** Both bulk halves are lazy (`MapDef.heights`, `MapDef.collision`),
  `drawMapThumb` takes both as ARGUMENTS and goes and gets nothing, and
  `paintMapThumb` hands it whatever has already landed — on a cold boot,
  neither — and books a repaint per arrival through a callback the calling
  screen supplies (the menu's `paintThumb`, and the lobby's, which is the same
  drawing). What a player sees is a bare square, then the ground it is cut in,
  then the town on it. The row is re-tested inside every callback, because the
  cursor moves faster than a fetch and a chunk arriving for a map the player
  has scrolled off must not repaint the one they are looking at. A coarse map
  for a moment and then the real one is the honest order; a hole in the menu
  until two fetches return is not.
- **A `WaterRect` is an EXTENT and the waterline is DERIVED**, which is the one
  thing on these maps that cannot be read straight off the layout. The real
  surface is a flat plane and the world is opaque, so a body is only the part of
  its rect the floor does not stand in front of — and the rects say so plainly:
  Greyfen's flood is one 250 m rect over the whole valley and Harrowmead's leat
  is 404 m by 100, so drawing the rects reported both maps as open water end to
  end, with flags in it. `mapPaint`'s water layer bakes a depth mask over the
  union of the rects instead, against the same `waterY` the surface sits at and the same
  `TerrainField.surfaceAt` the real bed map is baked from, and draws nothing
  where that depth is not positive. **A map with no floor in hand draws no
  water at all** — a rect with nothing under it is not a shape, and that is
  exactly the mistake this note is about.
- **The prose those panels carry lives with the thing it describes**, not in
  this directory: a map's line is `MapDef.blurb` in
  [`world/maps.ts`](../src/world/maps.ts), a tier's is `blurb` beside its own
  `centre` in `CONFIG.bots.skill.difficulties`, and a weapon's is
  `WEAPON_BLURBS`, which the kit screen already owned and now exports. Every
  figure beside them is read off the same object the line is on — the flag
  count, the extent, the view distance, the reaction time — so a panel cannot
  describe a map or a difficulty that is not the one being played.
- **Only the controls opt into pointer events, never the rows.** `#hud` is
  `pointer-events: none`, so a row, a caption, the art and the grid's gaps stay
  inert and a click on any of them does nothing — which is what keeps Deploy
  the pointer's only way into a round. **The cost is that a new control is
  unclickable until it names itself**, and the failure is quiet from both
  sides: the keyboard fires it through `activateMenu`, which never touches the
  DOM, so the row works perfectly for whoever is testing with a pad and is dead
  under the mouse. On the menu every control states `pointer-events: auto` in
  its own rule in `overlay.css` (the reel's container too, or a thumb cannot
  scroll it); the deploy screen's kit button is `deploy.css`'s. The multiplayer
  button once shipped without it and read as a bug in the button rather than a
  missing rule.

## After the menu: the deploy screen

**The deploy screen is a title screen for the POSITION the cursor is on**, the
fifth front-end screen and laid out as the menu is — a column down the left
anchored to the foot, a stage beside it, an intel plate on the right. It read
as a form: a heading reading "Select deployment" over a square map in a black
veil, a status box, a Deploy button and a loadout bar floating in a column
beside it, and a hint line naming three devices along the bottom.

- **The title is WHERE YOU ARE ABOUT TO STAND.** The position's name set large
  (the flag's letter hollow behind it, HQ for the home base), an eyebrow
  saying which of how many and in what state, and a figure strip that is the
  ROUND — both sides' tickets in their colours and the flags held — always one
  line, so the round moving never moves the plates under it. It wipes when
  the cursor moves and is patched as the round does.
- **The MAP is the stage**, the plan `mapPaint` draws for all three maps,
  prerendered and blitted: the one thing on this screen a player reads a
  decision off. It is the biggest square its grid area leaves — sized off the
  area itself (`container-type: size`, `min(100cqw, 100cqh)`) rather than off
  the viewport, which is what let the old `--map` and its `--ov-scale` divide
  go. The cursor's spawn is drawn with four ticks aimed at it, which are the
  plates' sight brackets at the map's scale: one cursor, drawn twice.
- **The positions are a column of plates** — the home base and every flag held
  and not contested (`ConquestSystem.deployOptions`), so one plate at the start
  of a round and six at most. Each wears the mark the plan draws (the HUD
  strip's hexagon with the flag's letter, or the spawn marker's disc and
  chevron), its name, its state and a hairline of how far its meter stands
  toward this side. **A flag the enemy is standing in alone is still ours and
  still offered**, and it is drawn in THEIR colour, alarmed, with its meter
  falling: the one state a player most needs told before dropping into it.
- **The cursor is ON a position, always**, which is what lets Deploy carry
  Enter and A honestly: the confirm fires the cursor's row, and every row is a
  place to deploy. Up/down (and left/right, since the spawns are points on a
  map rather than a row or a column) walk the plates; the kit plate carries
  L/Y and Pause carries Esc/Start, each firing wherever the cursor is; the
  foot holds only the cursor's verb and the scoreboard's.
- **A plate or a marker PICKS and Deploy FIRES, and a plate is CLICKED, never
  hovered.** The plates stand over the Deploy plate, so a cursor that followed
  the hover would move to the last plate the pointer crossed on its way down to
  the button. A marker used to deploy on the spot, which on a phone — a few
  pixels on a map scaled to the viewport — dropped a player onto a flag they
  had tapped to read.
- **The Deploy plate FILLS over the reinforcement clock**, the seconds left set
  large at its end: dark and visibly not yet yours while `confirm()` is a
  no-op, then the menu's hot plate with its glow and sheen, naming the
  position it will spend — and in a match, the position a REQUEST was made
  for, which may not be the cursor's.
- **The intel is the position and the ROUND.** Its top half is rewritten when
  the cursor moves or its position changes KIND (quiet to under attack): the
  meter as a percentage, who is standing in the zone, and what deploying there
  means — for the home base, which flag is nearest and how far, the walk a
  player choosing it is signing up for. Its bottom half is patched every frame:
  both sides' tickets as bars, every flag as the HUD strip's hexagon filled as
  far as its meter leans. It is the first block a viewport drops; the tickets
  and flags are on the title's strip there.
- **It takes the HUD's gameplay chrome off** (`#hud.deploying`, the same list
  `.overlaid` hides, by `visibility`), because it draws the tickets and the
  flags itself and the HUD's copies under the scrim would say them twice. The
  scoreboard stays: a player waiting out a reinforcement is who holds Tab.
- **Pause is the system corner, and it is a phone's only way off the round from
  here** — there is no Escape under a finger, and the touch controls' pause is
  not up between lives.
- **Four templates**, the menu's: wide with the intel; under 1240 wide or 620
  tall without it (1240 because the map is square and height-led, so a third
  column on a tablet comes out of the map's side); a phone held sideways with
  the map a square down the left as tall as the glass and the column on the
  right under the thumb, the plates two across so six positions are three rows
  (one across under 740 wide, where two would ellipsize every name); an
  upright phone as a fallback, the map between the title and the plates.
- **Nothing scales it on a short viewport**, as nothing scales the other
  front-end screens.

**The menu's `Deploy` button is the only thing on it a pointer can deploy
with** (`bindMenu` → `Game.onStart`). It began as a redundant target beside a
click-anywhere confirm, which is why it exists at all: an instruction in prose is
not a target, and "click, press Enter, or press Start" made a pad player work out
which was theirs. It now carries the mouse and the finger by itself. It is also
where the menu's cursor starts, keeping Enter and A meaning "start the round" the
moment the title appears. The round-over card's **Another round** is the same
plate and the same rule.

**That button is why the deploy screen's confirm is `menuConfirmPressed`.** It
changes state on the down edge, which puts the `deploy` branch in front of the very
click that asked for it — and the first deploy of a round has `respawnT` at 0, so a
confirm counting the mouse fired immediately and dropped the player in at whichever
spawn the list started on, skipping the screen. Enter and pad A only; the map takes
its own clicks and the two buttons take their own.

**The spawn is steppable** (`DeployScreen.moveSelection`, wired to the menu
directions in `Game`'s `deploy` branch, so the stick steps it too). Both axes step
the same list: the spawns are points scattered over a map rather than a row or
column, so no direction *means* anything, and a direction that does nothing reads as
a screen ignoring the pad. The selection is stepped *before* `update()` redraws, so
the marker, the plate and the title — which names the selection, because a
highlight 300 px away is not a label — move on the frame the key was pressed.

**The Deploy plate (`.dp-go`) is the pointer's way off that screen**, since the
confirm takes no click and a plate or a marker only picks. Pointerdown: the same
event goes on to take the pointer lock, which it can only do once `spawnPlayer` has
moved the state to `playing`. It is drawn waiting (`.waiting`) while `confirm()` is
still a no-op.

## The round-over card

**A title screen for the RESULT, standing in the menu's frame**
(`OverlayScreen.showRoundOver`). It was the shell's last screen: a green VICTORY
in the corner of a black veil, the reinforcements in a box in the middle of it,
one button, and a hint line naming two devices — a dialog telling the player
what a game should be SHOWING them.

- **The result is the TITLE**, set where the menu sets a map's name, over the
  photograph of the ground the round was fought on, with that map's number
  hollow behind it. It is in the colour of the side that holds the ground —
  VICTORY amber, DEFEAT red — the one saturated word on the card, because colour
  means ownership. The hero's line says who ran out and who holds the map, and
  its facts are the flags held at the end and each side's kills.
- **The column is what the round came to, read top to bottom**: the two sides'
  reinforcements facing each other across the margin they finished on (the bar
  is the two counts against each other, not against the pool, so a 142–0 and a
  12–0 are drawn as different rounds), then the player's OWN round — where they
  placed, in hot at the caption's end, over points, kills and deaths — then what
  happens NEXT, where the menu keeps Deploy.
- **The intel plate is the top of the BOARD**, ranked by points as the Tab board
  is, eight lines with the player's own under a break when it did not make the
  cut. The Tab board belongs to the ROUND (`ScreenStack`'s `inRound`), so this
  is the one screen after it that can say who did the work. `Game.endRound`
  reads `scoreRows` once — the ledger offline, the authority's table in a match
  — and hands the card SIDES rather than teams. **A name may be twenty
  characters a person typed** (`MAX_NAME_LENGTH`), so the names go in by
  `textContent`, are not tracked out, and the plate is wider than the menu's
  intel so that a full-length one fits at every viewport the plate is drawn at.
- **The photograph is the building card's too.** Another round raises the
  building card for the same map, so pressing the button leaves the picture,
  the lockup and the frame where they stand and swaps the column for the load
  plate. A different map's picture has to decode first, and until it has the
  front layer comes down rather than leaving the last map's behind this result.
- **The way OUT is the system corner, in both rounds** — Main menu offline,
  Leave match in one, on Esc and B (`Game.updateMenuCard`, behind the confirm's
  half second, so an Escape pressed for a pause as the round ended does not
  throw the player out). The card had NO way off it: offline the only door was
  another round, and a phone could not leave a match from here at all. Escape
  is told from the pad's Start by the confirm edge beside it — Start raises both
  `pausePressed` and `confirmPressed`, and on this card it is Another round.
- **Four templates**, the menu's: wide with the board; under 1100 wide or 620
  tall without it; a phone held sideways with the result down the left and the
  column under the right thumb — the ballot across the whole foot, where three
  names have the width to be read (`:has(.ro-vote)`); an upright phone as a
  fallback.
- **Built on the raise and never rewritten.** The entrance deals the column in,
  wipes the result in as the menu wipes a map's name, and grows the margin bar
  from the left once its plate has landed. The ballot is the one block patched
  under it (`setVote`).

**In a MATCH the button is a BALLOT instead**, and the block it stands in
(`.ro-next`) is the only part of the round-over card that differs between an
offline round and a networked one. Offline the next round is the player's to
ask for; in a match the next MAP is the players' and the round is the
authority's, so what is drawn there is three candidates, a tally and a
countdown — and against a server that runs no vote, a dark WAIT plate in the
building card's load-plate shape ("Next round · the server is choosing"),
which is still exactly what is happening.

- **The ballot is a GRID OF EQUAL SHARES**, which is this file's rule about a
  row of picks, and the narrow rule changes the COUNT rather than the break —
  under 560 px it is one column, because three map names across a phone is
  three ellipses and a map you cannot read is not one you can vote for. The
  count sits on the tag's line rather than beside the name, so on a laptop's
  column the name has the plate's whole width.
- **A candidate is a PLATE carrying its map's photograph**, as the menu's reel
  and the lobby's plates draw a map (`VoteView.ids`, for the pictures and
  nothing else): a picture needs no label to be told apart, and the name is
  still on it for the map nobody has photographed.
- **WHERE THE CURSOR IS, WHAT YOU VOTED FOR AND WHAT IS WINNING ARE THREE
  FACTS AND THEY ARE DRAWN THREE WAYS.** `.sel` is the cursor (the menu's sight
  brackets, on an UNCLIPPED wrapper round the plate, since the plate's
  `clip-path` would take them off with its corner), `.on` is this player's vote
  (a hot ring, a hot bar, and a YOUR VOTE tag — the one thing on the row the
  player did), and `.lead` is what will actually be built if nothing moves (the
  count set white, the quietest, because it is a fact about the tally and the
  tally is already in the bars). A player whose own vote is losing has to be
  able to see both at once, and one highlight would say one of the three and
  imply the other two.
- **The tally is the authority's and the cursor is not**, which is why the two
  are separate fields on the screen as well as separate classes: arrowing
  along the row would otherwise cast four votes, and a locally-lit button under
  a tally that does not count it is the failure `docs/multiplayer.md` argues
  the addressed `choice` field out of.
- **The pointer votes and takes the cursor with it**, so a player who clicks and
  then reaches for the keyboard carries on from where they clicked. A click
  rather than a pointer-down: a vote changes a value on the card and leaves
  nothing.
- **The map NAMES go in with `textContent`**, as the board's player names do —
  a candidate this build has no row for is drawn as the id the authority sent,
  which is a string chosen by whatever is on the far end of the socket.
- **The bars are a `scaleX`**, so a new tally slides on the compositor, and
  **the countdown is `tabular-nums` in a fixed box**: it is rewritten once a
  second, which is exactly the cadence at which a label that steps sideways as
  the number narrows reads as a fault, and it is written once a second rather
  than once a frame because `Game` compares the whole second before it touches
  the DOM.
- **The foot is the ballot's cursor verbs for the device in hand**, and a card
  with no ballot has no hint line at all: one button needs none.

## The pause card

**A title screen for the ROUND it holds, and the one card that does not take
the screen** (`OverlayScreen.showPause`). It read as a web dialog: "PAUSED" in
hot capitals over a column of four filled buttons, and a hint line naming three
devices — the card's largest word was its own name, which is what a form says.

- **The title is the MAP the round is on**, set where the menu and the building
  card set it, because the round is what a pause is about. What the card IS
  goes in the eyebrow over it, and that line is the one that must differ
  between the two rounds: offline it says **Paused** in the hot colour, and in
  a match it says **Match live**, cold, with a pulsing dot — a match holds
  nothing under a pause (`docs/states.md`), and a card promising a hold over a
  round that is still being fought is the one lie this card could tell. The
  blurb under the title says the same in words, and its facts are the flags the
  viewer's side holds and the enemy tier (or "Online", where this machine's tier
  decides nothing). **No hollow numeral** behind the title: over a round rather
  than a photograph it lands on the minimap.
- **It stays anchored left and does not take the screen.** One column over a
  scrim measured from the column (as the menu's is) and gone before the middle
  of the window, centred down it so it clears the minimap above and the vitals
  below. No lockup, no system corner and no intel plate: nothing on it is a
  place to go INSTEAD, and what is read on it is in the column.
- **The column is the round, then what you can do about it**: the round-over
  card's Your round plate (`yourRoundInner`, one markup for both) asked
  mid-round — place, points, kills, deaths — then the acts. **Resume is first
  and is the menu's Deploy plate**, hot, with its prompt (Esc / B) on it; then
  Settings, the one act you come back from; then Restart round (offline only,
  `pauseActions`) and Quit to menu — **Leave match** in one, the round-over
  card's word for the same act. Each dark plate carries an icon, the act and
  what it does to THIS round ("From the top · 400 a side", "Your slot goes back
  to a bot"), so the two that end the round say so before they are pressed —
  and never the map's name, which is the title already and is what pushed a
  line off its plate on a tablet.
- **The way back is a ROW, the one place the pause differs from every other
  screen's system corner.** Resume is not a way out to another screen but the
  card's primary act: it is what Esc, Start and B do from anywhere, it is what a
  confirm on arrival must do, and a list whose length never changes puts row 0
  in a fixed place. A corner button over a live round would sit on the killfeed
  and be the one control a hand never reaches for first.
- **The cursor is the menu's sight brackets** on each row's unclipped wrapper,
  and on Resume the Deploy plate's glow and sheen besides; hover moves it, which
  is safe here because the column is the only thing on the card. The plates
  fire on a CLICK — none takes the pointer lock in the same press, `resume`
  asking for it once the button is up.
- **In a match the figures move**, so `Game` hands the card the round again every
  `CONFIG.pauseCard.refresh` seconds (`setPauseRound`, compared before it
  writes); offline the raise is the only call, the round being held.
- **Four templates, all one column**, so they are about HEIGHT: under 620 tall
  the blurb and the Your round plate go (and their grid rows with them — a gap
  is spent between empty tracks too); a phone held sideways brings the title
  down and drops the hint line; an upright phone runs the column across the
  glass with the scrim rising from the foot. The entrance is the menu's, dealt
  down the column, and QUICKER — a pause is raised on a key pressed every few
  minutes, and an entrance waited through each time is a slow pause menu.
- **It was the last screen on `--ov-scale`**, and that ladder went with it.

## The kit screen

**The MIDDLE of the kit screen is a turntable carrying the real viewmodel.** It
is not a second model, not a render target and not a second camera: `ViewModel`
simply has a pose that is not the carried one (`beginInspect` / `spinInspect` /
`updateInspect` / `endInspect`), and the weapon is already parented to the camera
and drawn in `VIEWMODEL_GROUP`.

- **THE BAY IS MEASURED, and that one change is what the rest of this section is
  downstream of.** The weapon is placed by back-projecting a SCREEN position, and
  that position used to be a constant — `CONFIG.viewmodel.inspect.anchorX: 0.46`
  — welded to a `--panel: 46%` in `#loadout`'s stylesheet, with a note in each
  file saying to change the other. Two numbers that had to agree meant the screen
  had exactly ONE possible layout: a full-height column beside a full-height
  hole. Everything else on it was then squeezed into that column — ten buttons,
  a chart and three paragraphs, with the footer under the bottom edge of a
  1280x720 window — next to half a screen of empty bay. `LoadoutScreen.stageBay`
  measures `.lo-well` every frame and hands the rect to `updateInspect` through
  `InspectParams.bay`, so the weapon goes wherever the hole is: **move the
  layout freely, in either orientation, and the weapon follows.**
- **What is left in `CONFIG` is the weapon's own SIZE, and the fit takes the
  worse of two axes.** `frameWidth`/`frameHeight` are the rifle's span as a
  multiple of the frame's HEIGHT (the axis Babylon's FOV is fixed on, which is
  why the old `aspectReference` could be retired with the anchor), `frameMargin`
  is how much of the bay it may fill, and the weapon is pushed back until both
  fit. The old form could only ever be told about the WIDTH; a measured bay can
  be short as easily as narrow. **`frameNearest` is the floor**, and it exists
  because the rule now runs the other way too: the bay on a monitor is roomier
  than the framing was ever authored for, so the fit is allowed under 1 and the
  spare room is spent on the weapon rather than on air around it.
- **The bay is a hole, and it no longer needs a scrim.** Everything the kit
  screen draws is DOM and DOM is above the canvas, so a backdrop over the bay
  would dim the weapon along with the world. What the weapon is read against is
  a card hung behind it IN THE SCENE (`CONFIG.viewmodel.inspect.backdrop`,
  [`weapons.md`](weapons.md)) — and because that card is cut to the WHOLE
  frustum, the map is already gone before a pixel of this stylesheet is drawn.
  That is what lets the screen be plates with air between them rather than one
  opaque column with a hard edge down the middle of the window; `.lo-scrim` was
  doing a job something else had taken over. `show()` still marks `#hud` so the
  CSS can hide the menu, the deploy map and every gauge while the kit is up.
- **The card's pool of light follows the bay**, repainted (`paintKitPool`) when
  the centre moves by more than a rounding error rather than baked once at
  build. A pool left at the old anchor is a bright patch on an empty corner
  with the weapon in the dark beside it, which is what a phone would have got.
- **The turntable rotation is a quaternion, and the only thing allowed to write
  one.** The carried pose is Euler, composed in the weapon's own frame, so at a
  side-on yaw the pitch a drag asks for arrives as a roll. `endInspect` dropping
  the quaternion is what lets the Euler pose come back at all — while one is set
  Babylon ignores `rotation` entirely.
- **It rotates about a derived pivot, not the node's origin** (which on a rifle
  is the receiver — a turntable about that would swing the weapon around the
  screen). `applyFit` measures the pivot from the weapon's own muzzle landmark.
- **The hands let go.** A forearm cut off at the elbow reads fine on a carried
  weapon and as a severed arm on a bench, so `ViewModel` hides the arm meshes for
  the duration — one place writes mesh visibility.

**A title screen for the weapon in your hands, laid out as the main menu is — and
consistent with the menu alone, on purpose.** The weapon's NAME is the title
across the top, with its number in the kit hollow and enormous behind it and its
figures in a strip under it; the SLOTS are a column of plates down the left,
anchored to the bottom as the menu's rows are; the options for the slot the
cursor is on are a RAIL under the weapon, the menu's reel in another guise; an
INTEL plate on the right describes the pick; Back is the system corner; the
hint line is the foot. Every block is a named grid area and the viewports are
four templates over them.

- **Two axes and a page, the menu's own grammar.** Up and down walk the slots,
  left and right walk the rail — each step APPLIED, as every pick here always
  was — and the bumpers (LB/RB, Q/E) turn the WEAPON from wherever the cursor
  is, because the weapon is this screen's page the way the map is the menu's.
  The same bumpers are drawn as the chevrons either side of the title's
  eyebrow, where the pointer and the finger can use them.
- **Back, Start/Escape and `L`/Y close it, and the CONFIRM does not.** Every
  pick is applied the moment it is made, so there is nothing to finish; A and
  Enter are what a player presses on an option they mean to pick, and a screen
  that closed on them threw a pad player out mid-choice. Back is the one drawn
  exit.
- **A pointer CLICKS a slot open; it does not hover one open.** The rail is
  under the stage and the column is to its left, so a hover rule re-opens every
  slot the mouse crosses on its way down to the rail. The old screen could move
  its cursor on hover because every block carried its own options.
- **NOTHING SHARING THE BAY'S COLUMN MAY CHANGE HEIGHT AS THE CURSOR MOVES.**
  The bay is measured, so a rail that grew for sixteen swatches or a title that
  wrapped on "Submachine Gun" would rescale the weapon under the player. The
  title is sized off its own box (`cqw`) and never wraps, the fact strip never
  wraps, and the rail is ONE height (`--rail-h`) for every kind of option.
- **A ROW OF PICKS IS A ROW OF EQUAL SHARES THAT NEVER WRAPS.** Each card is
  `flex: 1 1 0` between a floor and a cap stated per kind; with room they stop
  at the cap and auto margins on the end cards centre them under the weapon,
  without it they shrink together, and past the floor the rail SCROLLS —
  `pan-x` under a thumb, a wheel under the mouse, the lit card kept centred
  under a pad — with its edges faded on the side there is more. A row that
  cannot wrap cannot strand a card, which is this file's rule about rows of
  picks restated for a row that has to be one line.
- **The weapon cards carry the SHORT name** (`short` in `CONFIG.weapons`): the
  full one is the title over the rail, and six of "Submachine Gun" do not fit
  under a weapon. An optic card leads with its MAGNIFICATION — the names are
  words, the number is the choice.
- **The FINISH is the one slot that is not a trade, and the one rail that is a
  GRID**: sixteen swatches as eight columns of two inside the same height, so
  the slot with the most options is the one that never scrolls. A finish says
  what it is with colour because "Verdigris" and "Oxblood" are words you would
  otherwise try one at a time, so each option IS a swatch — three flat stops,
  furniture, receiver, fittings — and the name is on the rail's caption, the
  plate and the intel. The lit swatch is RINGED rather than filled (a hot fill
  would paint over the only thing it has to say), inset because the clip-path
  cuts an outer ring off.
- **The intel describes the cursor's slot**: the weapon's chart (six SEGMENTED
  bars, each a share of the best in the kit), an optic's zoom and aim speed, a
  pouch's counts, a finish's colours with a line saying it changes nothing. It
  is the first block a viewport short of room drops, and the title's strip
  takes back the two figures (`.x`) it was carrying in its bars.
- **The sidearm is named once, under the plates, as the one line of the kit
  nobody chooses** — no plate, no cursor, no rail. The kit screen is the only
  place the whole kit is shown, and a second weapon nobody knows about is one
  nobody draws.
- **It is BUILT once and PATCHED** (`draw`): the slot plates on an armour
  change, the title when the weapon changes (which is how `.swap` replays its
  wipe), the rail when the slot changes (and its cards DEAL in), the intel on a
  pick — except the weapon's own chart, whose bars are moved in place so they
  SLIDE. The entrance is keyed to `show`, the menu's `.enter`.
- **Four templates**, keyed on the two things that run out. WIDE is column,
  stage, intel. Under 1240 px wide or 620 tall the intel goes (later than the
  menu's 1100, because this rail needs six cards' width beside the column). A
  phone held SIDEWAYS — the phone layout, since the game asks for landscape
  everywhere it can — is the slot column full-height under the left thumb as
  equal plates, the title and the rail on the right, Back in the top corner and
  no hint line. A phone held upright is not a layout but must not break: one
  column, the slots a row of icon tabs.

`Game.updateKitStage` drives it, because `loadout` is the one lid state showing live
3D and owes by hand the per-frame pushes only `updateGameplay` makes. The camera
position is the load-bearing one — the cel shader fogs against `camPos`, which
outside a round is whatever the last gameplay frame left and `Vector3.Zero()` before
the first, so a kit opened off the main menu would fog the weapon to a grey
silhouette. It also puts up the three bench lamps (`CONFIG.lighting.kitLamps`),
through `LightingSystem` like every other light because a carried light always wins
a slot; they are far brighter than the shoulder lamp on purpose, since moonlight
alone on a night game's albedo is a black silhouette. **The third of them stands
BEHIND the eye and is there for the polish rather than for the light**: a mirror
hands back what is behind the camera, so with both lamps beyond the weapon every
reflection a chrome finish could return landed on the faces turned away from the
screen — which is what made the gold plate read as tan paint on the one screen
whose job is to sell it. `stowKit` is the single
teardown — screen, pose and lamps — and all four exits go through it, because a
carried light nobody removes survives `lighting.clear()` and follows the player into
the round.


## The lobby

**The lobby is a title screen for the MATCH the cursor is on**, the fourth
front-end screen and laid out as the settings screen is — the same named areas,
the same four templates, the same tab strip. It read as a web form: a heading,
five columns of small caps floating in the middle of a black page, and three
rows of chips under them, the map row's eight names running off its own edge.

**The match is the title.** The map it is running is set large, with its number
among the matches hollow behind it, an eyebrow saying which match of how many
and where, and a figure strip — the seats, the round trip, the state — that is
always one line, so moving the cursor never moves the list. On the strip the
title is the FIRST match, because the strip is where the screen opens and the
title of a screen full of matches should be one of them; with nothing listed it
is the list's own state in one word (*Searching*, *No matches*, *Offline*,
*Full*); on the other page it is the map a new match would be built on.

**The photograph behind it is that map's, and it is the MENU's photograph.**
The lobby is handed the same `MenuBackdrop` the overlay is, and puts the map its
cursor is about on it, which cross-fades `#menu-shot` exactly as a map step on
the menu does. It only does so while it is up, which is only ever over the menu
(the overlay's `showBackdrop` used to check the card for it). One backdrop
rather than a copy here, because the lobby is only ever raised over the menu and
the picture is already up behind it; the menu puts its own map back when
`closeLobby` redraws it. `#hud.lobbying` takes
the menu card off the glass (visibility, so it returns unredrawn) and carves out
`#menu-shot` and `#hud-fps`, the settings screen's `.setting` rule. A map id
this build has never heard of has no picture, and the backdrop fades out rather
than leaving another map's up.

**Two pages, because the list was two kinds of thing.** JOIN is a plate per
match, each carrying a slice of its map's photograph (the reel's thumbnails,
`shotThumbUrl`), the state under the name, the seats as the figure a row is
compared on, and — with more than one region — which server and the round trip
to it. NEW MATCH is the three pickers as the settings screen's steppers (region
only where there is a choice, map, bots) and **Start match**, a Deploy-weight
plate reading back what it would spend. The tab strip is row 0 of the cursor's
list, so a pad reaches both pages through the list alone; the bumpers (LB/RB,
Q/E) turn the page from anywhere and clamp, Enter on the strip wraps. The JOIN
tab carries the match count once any server has ANSWERED — a zero on a screen
that reached nobody is a measurement nobody took. An empty JOIN page is not an
empty column: it says what the servers said and offers **New match**, carrying
the bumper that does the same.

**Refresh and Back are the SYSTEM CORNER**, each with its key (R / the pad's X,
Esc / B), and each key fires its button wherever the cursor is. Neither is a
row: a control under a list whose length is whatever the servers are running is
one whose position nothing can predict. X is a reload only while a seat is
offered, and nothing is offered in a menu, so `reloadPressed` is both.

**The intel plate is what joining MEANS.** On a match: the seats as a strip of
pips (a person lit, a seat a bot is holding dim, and in a botless round an open
seat as an outline, because there it is genuinely empty), the round trip and the
state, the map's PLAN — `drawMapThumb`, the menu's schematic and the same
drawing as the deploy map — and a sentence per state. On a picker: every option
with the chosen one lit. On the strip: the page, and on JOIN each region with
what it answered and its round trip. Where a viewport has no room for the plate
the sentence comes back as the say line under the list.

**It is built on a raise and patched after, and the patch is what keeps it
usable while servers answer.** The rows are rebuilt only when their SET changes
— the identity keys, plus the empty state's sentence, which has no patch path of
its own — and a row that has just arrived deals itself in while the rows already
there hold still; counts, states and pings are patched in place. The cursor is
re-found by identity across every rebuild (above). The title is rewritten, with
its wipe, only when what it is ABOUT changes; the intel is rewritten when its
contents change, and fades only when the CURSOR moved. Every string off a
network — a map id, a region's name, a server's error — goes in through
`textContent` (`Fill`), including in the title and the intel.

**The match plates join on a CLICK** (see the pick/fire paragraph above), and
the whole root takes pointer events for the pause card's reason: the menu under
it confirms on mouse-DOWN.

## The controls a phone plays with

`TouchControls` lives in this directory, builds a root, appends it to `#hud` and
carries a stylesheet of its own, so by every rule above it is a screen. It is
counted as one nowhere, because **what it IS is a device**: `InputManager` polls
it once a frame exactly as it polls a gamepad (`setTouchSource`), and nothing
downstream of that poll has heard of it. The distinction is worth keeping because
it decides where a change goes — a new control is a button in that file and a
term in `InputManager.update`, never a new callback into `Game`.

The shape of the set — floating stick left, look drag right, cluster over both,
a fire button that also steers — is the one Call of Duty Mobile and Delta Force
Mobile both arrived at, and the argument for each part is in the file's own
header where the code that implements it can be read beside it.
[`pwa.md`](pwa.md) carries the half that is about the phone rather than the
game: when the controls are drawn, why a tap arrives twice, and why the layer is
`fixed` rather than `absolute`.

What belongs *here*, with the other screens:

- **It is the one thing on `#hud` that is drawn for exactly one state.** Every
  other screen is raised and lowered by a transition; this one is pushed from
  `Game.tick` every frame (`pushTouchControls`) next to the scoreboard's push and
  for the same reason — the state a frame ENDS in decides, so no boundary owes a
  call. `playing` alone, which is narrower than `inRound`: the deploy screen is a
  map you tap a spawn on and the death cam is four seconds of watching, and in
  both there would be a body's worth of controls over a body nobody is driving.
- **Taking it away drops what it was holding.** `setVisible(false)` calls
  `releaseAll`, and that is the whole reason visibility is a method rather than a
  CSS class: a pause taken with the trigger down must not come back with the
  trigger down. The class rules in `touch.css` (`#hud.paused #touch` and its
  three neighbours) are the one-frame belt to that brace — the push lands on the
  next tick, and a trigger drawn over the pause card for a frame is a trigger
  somebody tries to press.
- **Everything it draws that it cannot know is pushed in**, exactly as every
  gauge in `HUD` is and with the same write guards: whether the body is crouched
  (it owns no crouch latch — `InputManager` has one already, shared with `C` and
  the pad's B), whether the magazine wants attention, what the two vehicle verbs
  would do right now, and what the player is sitting in. Nothing else about the
  round reaches it.
- **THE CLUSTER IS THE CONTROLS OF WHATEVER THE PLAYER IS IN, and a button
  outside them is OFF THE GLASS rather than dimmed** — the rule `#hud-kit` and
  `#vehicle` already follow one layer up, arrived at here the hard way. A
  keyboard can leave every key bound because a key nobody presses costs nothing;
  a 260 px cluster cannot, and `touch.css` puts the collective exactly where
  JUMP and CROUCH are on purpose (Space and Ctrl are the same two keys, so the
  position is the muscle memory). While the body's buttons stayed up in a hull,
  that placement drew the hull's controls straight over the body's.
  So every button declares its `modes` — `foot`, `driver`, `gunner` — and
  `Game.pushTouchControls` pushes which one is live (`setMode`). It is the SEAT
  and never the KIND: a gunner has no sticks and no collective, a driver has no
  optic, and nothing in this game branches on what kind of vehicle it is holding.
  Three rules come with it:
  - **`shows()` is the one place that decides what is drawn**, where the mode
    table and the pushed facts meet. A new button answers `modes` or does not
    compile; a new GATE is an arm in that switch and nothing else moves.
  - **What leaves the glass is LET GO of** — the finger's press, its role, and
    its latch. A latch on a button nobody can see is one the player cannot turn
    off, which is how a body used to come back out of a tank still aiming.
  - **The mode cannot say everything**, so the trigger takes a second push:
    a DRIVER has a main gun only on a hull that has one (`Vehicle.armed`), and a
    trigger that fires nothing is the same bad bargain as a collective in a
    gunner's chair.
- **The two VEHICLE VERBS are contextual, and they are the whole reason a phone
  can drive.** Every other control on the layer is a key that has always been
  there, because a key is something a player presses to find out what it does —
  and glass has nothing to press until something is drawn under it. So `setUse`
  gives the boarding verb a label and puts it on screen and null takes it away,
  and `setSeatOffer` does the same to the SWAP button, which is the weapon swap
  on foot and the crossing to the other chair in a hull — one button for two
  verbs, exactly as the pad's Y already is. `Game` decides both, from the same
  `offerUse` and `swapPrompt` that write the HUD's own prompts, so the sentence
  on the button and the sentence on the HUD cannot disagree. Taking an offer
  away LETS GO of the button (a finger resting on `EXIT TANK` when the hull
  brews up must not be reported held when the next offer puts it back), and
  `releaseAll` puts the whole cluster back to a body's, because here the class
  is not a look but the control's whole existence.
- **Two of its behaviours are SETTINGS, and neither is a second device.** The
  stick floats or is fixed (`Settings.touchStick`), and the fire button may
  also aim (`Settings.touchAutoAds`). Both are toggles CoD Mobile ships under
  those names ("Fixed Joystick", "ADS fire"), and both are ones players split
  on, which is the test for a behaviour becoming a setting rather than a
  decision. Neither adds a field to the `TouchFrame`: a fixed stick still
  reports a deflection, and aim-on-fire still reports `ads` and `fire`, so
  `InputManager` and everything after it are unchanged. The settings screen
  gives them a **Touch** page of their own, with touch look and the gyro,
  because five phone rows under the Input page's two would have put its
  foot off a landscape phone and nothing on these screens scrolls. Three
  rules come with them:
  - **A fixed stick's position is the SHEET's and the maths MEASURES it**
    (`claimStick` reads the ring's box at the press), the rule the kit screen's
    bay follows. Its lift is stated in `--hud-u` because what it has to clear,
    the vitals, is sized in that unit; a pixel lift that clears them on a phone
    sits on them on a tablet.
  - **Aim-on-fire's round WAITS for the sight.** Hip fire here is unaimed and
    hip spread is 7.5x to 90x the aimed figure, so a round fired as the sight
    starts to rise is wasted. `Game` pushes whether the blend has reached
    `CONFIG.touch.autoAds.fireAt`; the layer holds the trigger until it has, and
    a press is OWED one round so a tap that lifts first still fires. What
    `setAutoAds` is given is the setting AND the situation (on foot, and an
    item that is `sighted`), because the layer cannot see either.
  - **Both pushed halves are dropped by `releaseAll`**, the rule the crouch lamp
    already follows: an owed round must not leave the moment a pause lifts.
- **GYRO AIMING is a DEVICE beside this one, not a part of it**
  (`src/core/GyroInput.ts`, `Settings.touchGyro`: off, while aiming, always).
  It draws nothing and owns no finger, so it lives in core and is polled by
  `InputManager` (`setGyroSource`) into a fourth look path, `gyroYaw/Pitch`,
  which only the two cameras read. What a player needs to know about it is
  what the settings screen tells them: the row's plate and its sentence carry
  the sensor's real state (`setGyroStatus`), and the speed row resolves to degrees of view
  per 90 degrees of phone. Three rules reach outside the file:
  - **It is PLAYER SPACE**: yaw is the turn about GRAVITY and pitch the tilt
    about the screen's horizontal, so a phone held tilted back turns cleanly.
    Yaw read off the phone's own vertical turns at the cosine of the grip and
    rolls into every turn.
  - **It takes the OPTIC's multiplier and not the aim assist's slowdown.** A
    scope steadies the wrist by its own ratio, as it does the drag; the
    slowdown exists for a thumb's imprecision and would make a wrist tracking a
    target lag behind it.
  - **"Aiming" is the camera's own `adsBlend > 0.5` step on foot and the
    gunner's sight in a hull**, and it applies in both cameras, because a look
    setting that held in one view and not the other is a lie about one of them.
    It is not gated on touch being in hand: a phone with a pad clipped to it is
    who wants a gyro most.
- **The buttons are `.frame`s**, the same chamfered hull the panels use, cut on
  the same two corners. Not decoration: `base.css` bans `border-radius` on
  gameplay chrome, and a set of round translucent buttons is precisely the "web
  card" that rule exists to keep off this HUD.
- **The one control that is not input is the pause button**, and it is a callback
  out (`onPause`) like every other screen's, guarded on the state in
  `wireScreens` like every other one. A phone has no Escape key, so without it a
  round cannot be left at all.
