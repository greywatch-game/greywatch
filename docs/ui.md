# The interface: five screens and the chrome

What each UI class owns, where a stylesheet lives, and how the screens between
the title and the world are driven by a pointer and a pad alike. Split out
of [`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the
contract for everything under `src/ui/`.

## The interface is five screens and the chrome

`src/ui/` holds one class per thing on screen, and `HUD` is not where a new one
goes: `OverlayScreen` owns the four full-screen cards, `DeployScreen` the deploy
map, `LoadoutScreen` the kit, `SettingsScreen` the settings list, `LobbyScreen`
the match browser, `Minimap` the corner map, and `HUD` **only** the gameplay
chrome. `TouchControls` is in the directory and is deliberately not in that
count — it draws like a screen and answers like a gamepad; see the last section
here.

## The shell

**Every screen between the title and the world is drawn in one frame, and the
frame is anchored to the VIEWPORT rather than centred in it.** `.ui-screen` in
[`base.css`](../src/ui/base.css) is three grid rows — a head, a body, a foot —
with fluid gutters: the head carries the screen's name on the left and a meta
slot on the right under a hairline, the foot carries the input hints and the
way out along the bottom edge, and the body takes everything between them.

What it replaced is the reason it exists. Every one of these screens used to be
a ~600 px column floating in the middle of the window — `--col` on `#overlay`,
a 680 px `.se-panel`, a 640 px `.lb-panel`. On a 2560-wide monitor that is a
quarter of the width in use and nothing within 500 px of an edge, which is what
makes a screen read as a dialog box laid over a game rather than as the game's
own front end. The head and the foot now run to the glass; `--ui-max` (1680 px)
caps the BODY, so an ultrawide gets a wide composition rather than a stretched
one. That split is the whole trick — the chrome touches the edges, the reading
matter does not.

**The body is a LIST and the PANEL that says what the list's cursor is on.**
`.ui-rail` is the list column and `.ui-panel` the one beside it, and the second
is what turns leftover window into a reason to have it: which map, drawn and
described; which enemy, and what that tier is like to fight; what is in your
hands and what it does. A wide screen that puts the same six rows in the middle
of more emptiness has not used the space, it has just left more of it.

`.ui-panel` is an OPEN column with a rule down its edge, not a box. It was a
chamfered plate first and the plate was the wrong shape: the panel is full
height because it is one side of the screen, while what it holds runs from four
lines to a schematic — so on the short rows a box read as an oversized empty
container. A screen that wants a plate adds `.frame` and the rule steps aside.

**Everything is sized in `clamp()` over `vmin`, and the reason is the phone.**
A menu drawn at one size and scaled down is a miniature of a desktop layout:
right proportions, unreadable type, a title bigger than the list under it. Sized
fluidly, the same markup is a phone layout at 390 px tall and a cinema layout at
1440. `vmin` rather than `vw`, because an ultrawide is short for its width and a
title scaled by width alone on a 2560x1080 is taller than the rows it heads.

**One column when there are not two columns' worth of room**, keyed on width AND
on aspect — a narrow window has no room for a panel beside a rail, and a nearly
square one has room and no HEIGHT to spend on stacking. The panel GOES rather
than shrinking (`.ui-optional`), because half a panel says less than none and
takes the rail's room to say it. `--ui-lean` is the same pair of queries as a
custom property, for the screens that drop optional matter of their own.

**A screen over another SCREEN is opaque; a screen over the SCENE is not.**
`.ui-veil` is the backdrop — a warm glow off the lower-left corner and a cold one
off the upper-right (the friend/foe pair the whole HUD is coloured by, and what
gives the frame a direction to be lit from), a vignette, a diagonal hatch, and
the scanlines every card here already had. The menu, the round-over card and the
deploy screen stand over a live 3D view and let it through. The settings list and
the lobby stand over the MENU — DOM over DOM — and add `.ui-solid`, which closes
the vignette: a veil tuned to let a village through lets a wordmark and a rail of
buttons through with it, which reads as two screens up at once.

**`--ov-scale` is a safety valve now, not the layout.** It is still the mechanism
described further down — draw the screen at the size it was authored for and
scale it down — but the fluid frame fits the viewport it is given, so the ladder
is 1 until a viewport is shorter than anything the clamp minimums fit in
(380 px), and gentle when it does engage. At the old 0.45 a landscape phone got a
legible desktop menu rendered at 45%. Raising it back toward those numbers undoes
the responsive layout wholesale.

**The kit screen carries the head without the frame**, and it is the one
exception. Its right half is a hole the 3D turntable is placed through, so a
grid with a foot across the bottom would put a row of key chips over the weapon;
it keeps its own two-column flex and takes `.ui-head` and `.ui-foot` bounded to
its panel column. That is why the title rule is scoped to `.ui-head` rather than
to `.ui-screen`.

**The boot screen is the one piece of interface that is not in this directory**,
and the exception is what defines it: it covers the stretch before any module
has evaluated, so `src/ui/` could not draw it — the bundle it would be drawn by
is what the player is waiting for. It is markup in `index.html` with its styles
in that file's `<style>` block, and `main.ts` is the only code that touches it:
taken down two frames after the `Game` constructor returns, or turned into one
of the three failure messages when the game cannot start at all — "needs
WebGPU", "no graphics device" or "no physics engine". It is self-contained
by necessity — in DEV `base.css` is injected from JS and has not arrived either,
so it may not use `--font`, `.frame`, or anything else the interface shares.
Nothing that reacts to game state may be added to it; that is an interface, and
it belongs here with a stylesheet of its own.

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
apart.** The lobby's rows fire on pointer-DOWN — that is the edge everything
which leaves a screen uses — but its Map row only steps a choice, and the map
buttons inside it take ordinary clicks on the way UP, exactly as the menu's own
map and difficulty rows do. Firing the row on the down edge as well would cycle
the choice under the finger and then set the clicked one, which lands in the
right place by luck and flickers getting there. The row is above **New match**
rather than below it for the reason the menu puts Map above Deploy: the
parameter, then the button that spends it. It is the map a match this client
CREATES will be started on and says nothing about the matches listed above it —
see [`docs/multiplayer.md`](multiplayer.md) for why joining one takes that
match's map instead.

**THE WAY OUT OF A SCREEN IS A BUTTON IN ITS FOOTER, never a row in its own
list.** The settings screen, the kit screen and the lobby all end on the same
line — what the keys and the stick do, then Back at the right-hand end of it —
and it is `.ui-foot` / `.ui-back` in `base.css` rather than three copies, so a
fourth list-shaped screen gets the whole convention by naming it. The lobby's
Back was a row for a while and it was the wrong shape twice over: it sat under a
list whose length is whatever the servers happen to be running, so the one
control every visitor eventually wants was the one whose position nothing could
predict; and it wore the same highlight and the same Enter as *join this match*,
when leaving and joining are not the same kind of act. The pad and the keyboard
never needed the row — Esc and B leave all three screens through `Game`, which
is what the chips on the button say — so what it cost a pointer to reach was the
whole of what it bought.

The label is **Back** on all three, including the kit screen, which said "Done"
until this was shared. Every one of them applies a pick the moment it is made,
so there is nothing on any of them to be finished with, and two screens that
leave the same way must not use two words for it. Where the keys genuinely
differ, the screen's own hints say so: Enter changes a settings row and closes
the kit screen, and only the pair that works everywhere is on the button.

**The four cards are one class because they are one element** — they share the
shell, the title block and the Deploy button. The bar for a screen of its own is
*state*: the deploy map has a selection and a canvas, the kit screen has three
slots and a turntable; a card that is markup plus a button has not earned one.

**Three of the four take the screen and the PAUSE does not.** `setCardClass` is
what decides it: the menu, the round-over card and the building card get the
frame and the veil, and the pause gets a left-anchored column over a scrim that
fades out before the middle of the window. The round under a pause is this
round, frozen where it stood — the flag strip along the top, your own vitals,
the body you were lining up — so a full-bleed veil over it hides the thing the
pause is *in*. It is the same argument that keeps `setOverlaid` out of
`showPause`, stated as a layout instead of as a class. The list is on the left
because that is the side a pause menu has been on since consoles had two sticks,
and because the crosshair is in the middle.

**The building card is the one that stays centred and bare**, and the freeze it
covers is why. Everything on it has to be PAINTED before the main thread stops,
so a panel with a canvas in it would be a schematic drawn on the frame the
player was already waiting through. A name, a word, and a bar.

**The key-cap table is no longer one of the things they share, and that is the
whole reason it moved.** It hung under the menu's title and under the pause list,
drawn from one table by one loop, which was right while the settings screen was
two toggles no pad could reach. Once that screen became a list a cursor lands on
from both places, the table belonged in it: the menu is five decisions and a
Deploy button, and eleven rows of reference under them made the longest block on
the card the one nobody reads twice. It is one row of the menu and one item of
the pause list away, and the settings screen opens on the page that carries it.

**The building card is the fourth, and it is the only one the player cannot
act on.** It stands over the ~0.7 s of merges, occlusion bake and nav grid that
building a map costs, and it exists because a freeze and a load look identical
from the outside — before it, the card the player had just confirmed simply
stopped where it stood for the whole build. `Game.startRound` is what actually
buys it the frame it needs to be drawn in; see the state machine's `loading` in
[`CLAUDE.md`](../CLAUDE.md), and note that the rule there is **two**
`requestAnimationFrame`s, not one. It takes itself down at the end of
`Game.buildRound` rather than waiting to be dismissed.

**Its bar may only be animated with `transform` or `opacity`** — the one place
in this directory where the choice of animated property is a correctness
constraint rather than a matter of taste. For the whole life of that card the
main thread is inside the build, so nothing on it can move unless the
COMPOSITOR can move it alone, and the compositor only takes an animation that
needs neither layout nor paint. A bar animated on `width` or `left` renders
perfectly in every test and then stands still for the one second it exists for,
which reads as a hung game rather than a loading one. Measured: with a 5 s
block forced, the bar keeps producing distinct frames throughout and drops
none. The bar is also **indeterminate**, and honestly so — the work behind both
it and the boot screen's is a single uninterruptible call, so there is no
progress to read even in principle, and an invented percentage always ends up
stuck at 90 while the real work finishes.

**The settings list is a ROW TABLE, and every row is the same thing: a labelled
choice over one field of `Settings`.** A toggle is a two-option choice, so Off/On
and a three-rung resolution ladder go through one renderer, one key handler and
one hit-testing path. What a longer list changes is only how the cell is DRAWN:
the control column is fixed, which is ~60 px a button for three options and 10 px
for sixteen — narrower than one character — so a row can ask for
`style: "slider"` and be laid along a track instead.

**It is split into PAGES, and the page selector is ROW 0 rather than a key of its
own.** That is the whole tab mechanism: up and down reach the row, left and right
step it, Enter wraps it — exactly what every other row on the screen already
reads, so a pad needs no bumper nobody would think to press and the screen needs
no second hit-testing path (the tabs are `.se-opt` buttons like any short option
list). It is not in `Settings` and not in a page's rows because what it changes is
on this screen rather than in the store. Switching pages puts the cursor back on
the selector: row 3 of Display is not row 3 of anything else, and the row the
player is standing on is the one they just used. `show()` resets the page as well
as the row, for the reason the kit screen resets its cursor — and because a
screen that opens on Display because that is where you were last week hides the
key table from the player who came looking for it.

**A page is what this list GROUPS by, and it replaced a heading row for a reason
that is about height.** Nothing in this HUD scrolls, so a list that outgrows its
panel does not get a scrollbar, it gets a foot the player cannot see. A heading
buys an inch of separation and spends the same height as a row; a page buys the
whole rest of the list back. The split rule is the mechanical one — a page that
outgrows the panel splits into another page, exactly as a section would have
split into another heading.

**The key-cap table is the one thing on the screen that is not a choice, and it
is in the PANEL beside the list rather than under it.** It carries no
`data-row`, so the cursor steps straight past it — it is not a row, it is what
the Controls page is *about*. Eleven rows under a list of three sliders was the
longest block on the screen and the thing that decided the panel's height;
beside that list it costs it nothing. Its own three columns (action / keyboard /
pad) are set independently of the list's, because an action name is short where
a setting's label is long and matching the two would leave the key chips
stranded mid-panel with the pad column adrift at the far edge.

**The row HINT moved into that panel with it, and the list is two columns now.**
A hint is a sentence of prose, and it was in a cell as wide as a control, set at
10 px, clipped whenever the panel narrowed. One row's hint at a time, given a
column of its own, is both more of it and less of it on screen: the row you are
standing on gets a heading and a readable line, and the four you are not stop
competing with their own controls for width. The page selector is answered there
like any other row, which is the same argument that made it a row at all.

**The Display page's panel carries a `facts` block instead of a table**, and it
is a function rather than a string because every figure in it is measured when
it is drawn — the window, the pixel ratio, what the ladder above actually comes
to on this machine. A settings screen reporting the size the window was when the
bundle loaded is worse than one reporting nothing. It is also what keeps that
page's panel from being a heading and one sentence in a column the height of the
screen.

**A viewport too narrow for the panel gets the hint back as a third column and
loses the key table**, and that is the right thing to lose. A window that narrow
is a phone held sideways; the table names a keyboard and a pad, and the game on
that device is played with the touch controls, which are drawn on screen and
name themselves.

- **The slider is positioned by option INDEX, not by value**, one rung per equal
  share of the track. That is what keeps it a choice over the same `options` the
  arrow keys step and the same list a codec validates against: a drag cannot land
  on a value a keypress could not reach. It also preserves a ladder's spacing —
  `CONFIG.camera.lookScales` is geometric, so an inch of drag is the same *ratio*
  of look speed wherever it is taken.
- **The drag lives on the WINDOW and its geometry is captured at the press**,
  because `draw` rebuilds `innerHTML` wholesale: the element under the finger is
  destroyed and replaced the first time the value crosses a rung, and a listener
  or a pointer capture bound to it dies one rung in. The track's box is measured
  once — nothing about the row's layout depends on the value — so a drag survives
  the redraw, leaving the row, and running off the end of the screen.
- **The thumb's size is declared in CSS and read back off the DOM**, never
  restated in the script. Both the paint (`left: calc(var(--t) * (100% -
  var(--thumb)))`) and the hit maths need it, and two copies of that number are
  two things that drift into a thumb sitting where the value is not. The script
  writes `--t` and nothing else.
- **Hover does not move the selection while a slider is held.** The redraw a drag
  causes lands a fresh row under a pointer that has not moved between rows, and
  taking the selection from it would walk the highlight onto a slider the player
  is not dragging.

**A hint says what the value WORKS OUT TO, and that is why hints are computed
rather than written in the table.** "75%" and "1.25x" are both numbers over
something the screen never shows — a panel's pixel count, a rate in radians —
so `hintFor` resolves each against the machine (`1280x800`) or against
`CONFIG.camera` (`202° per 1000 px`, `160°/s at full stick`). A player comparing
this game against the shooter they came from is comparing sweeps, not
multipliers.

**A class on `#hud` belongs to whoever raises it.** `OverlayScreen` sets
`.overlaid`, `LoadoutScreen` sets `.kitting`, `HUD` sets `.paused`, `.editing` and
`.dying`. That is why a pause is two calls from `Game` rather than one: the card
goes up and the crosshair comes down, and they are not the same decision —
`.overlaid` would take the tickets and vitals with it, which under a pause are
still true.

**The scoreboard is the one markup rebuild left in `HUD`, and its rows are BUILT
rather than interpolated.** Tab is a held key, so `Game.updateHud` pushes the
panel on every frame it is up; a key over everything the markup says is what
keeps that to a rebuild per change, and the per-body rows are in that key
because a kill anywhere reorders the column it lands in. The team summary is a
template literal — a map name and two names out of `CONFIG` — while every row
under it goes through `document.createElement` and `textContent`, because one of
its fields is **a name another player typed**. The server bounds that string's
length; nothing bounds what is in it, and this file is where it is finally
drawn. A bot's name is not on the wire at all: `entities/callsigns.ts` derives
one from the roster index, which is the same number on every screen.

**The ping column exists only in a match, and whether it does is TOLD rather
than derived.** Offline there is no server to be any distance from, so the
column is not there at all — a fourth grid track added by a class on the panel.
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
a round no longer each owe a `setScoreboard(false)` — the one that forgot would
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

**Score leads the row, and that is the reason the column exists.** A round is
won on flags and lost on tickets, so the player who took three of them has done
more for the win than the one with four more kills — and a board ordered by
kills says the opposite in the one place everybody looks. The number is the
`ScoreBook`'s (`config/score.ts` is the table it spends), the team's own total
is drawn in that team's colour because it is the summary of the whole round, and
the figures are tabular because a sorted column of proportional digits does not
look sorted. The panel's `min-width` grew with the column: `#scoreboard` is
inside `#hud` and so is NOT scaled by `--ov-scale`, which makes that width a
promise to the shortest viewport the game runs on.

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
`#capture-status`, and anything that moves under the crosshair reads as
something to shoot at. `HUD.LABELS` is a total map over `ScoreKind`, so a new
award in `config/score.ts` does not compile until this file has decided what to
call it.

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
off the drawn square is pinned to the rim on its own bearing, carrying its
letter, its owner's colour and the contested pulse, so the way to the next flag
is always on screen. The rim it is pinned to is the SQUARE's and not a circle
inscribed in it — the corners are drawn map like anywhere else, and a circular
rim would post a marker for a flag the player can already see sitting in one.
And **the player's own arrow needs no clamp any more**: it was clamped because a
borderland let its owner stand eighty metres off the bitmap, and a canvas clips;
now it is the one marker with no arithmetic behind it at all.

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
  `#hud` root, `.frame`, `.brackets`, `.hidden`, the `--ov-scale` short-viewport
  block, `@keyframes pulse`, the kit button, the whole SHELL (`.ui-screen`,
  `.ui-veil`/`.ui-solid`, `.ui-head`/`.ui-eyebrow`/`.ui-meta`, `.ui-body`,
  `.ui-rail`, `.ui-panel`, `.ui-facts`, and the design tokens the five screens
  are measured and coloured in), and `.ui-foot`/`.ui-back` (the hint line and
  the Back button three screens end with). A rule only one screen uses
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

## The menu's backdrop

**The main menu stands on a photograph of the map that is chosen**, and choosing
another cross-fades to that one's. The pictures are real screenshots of the
running game — `shots/<id>.jpg`, taken by `npm run shots` — and there is nothing
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
both halves of that are load-bearing.**

- It must survive the card. `showMenu` rewrites `#overlay`'s markup on every map
  step, and a layer that is removed and re-inserted has no before-change style to
  interpolate from: the cross-fade would be a jump cut, on exactly the press it
  exists for.
- It must sit under the VEIL. A child paints over its parent's background
  whatever its z-index, and the veil is `#overlay`'s background — so a picture
  inside the card would be a picture on top of the scrim that makes the type over
  it readable.

So the backdrop needs no scrim of its own: it is the shared veil, at
`#overlay.card-menu`'s own density. `--veil-in`/`--veil-out` are the vignette's
alpha in the middle and at the edge, and they exist for precisely this question.
**One density has to hold two opposite pictures**, and that is what set it: the
night village is nearly black already and cannot spare a point of scrim, while
the city at dusk is a bright grey sky behind the faintest type on the screen
(`--dim`, the row labels). 0.34 in, 0.9 out, is where the chapel still reads as a
chapel and Coldharbour's labels still hold against the towers. The edge stays
dense, because the wordmark, the rail and the foot hints all live out there.

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
  decoration: the weapon on the turntable is drawn by the SCENE through a hole in
  the kit screen's scrim, so a full-bleed picture left standing at z-index 9
  would be what you saw in the hole instead of the gun.
- It is deliberately NOT in the `--ov-scale` list in `base.css` beside
  `#overlay`, `#deploy`, `#settings` and `#lobby`. That ladder draws a screen at
  the size it was authored for and scales it down; a photograph has no authored
  size to be scaled from, and `inset: 0` with `background-size: cover` already
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
screen was exactly that). The dedicated keys survive as accelerators; none is the
only way in.

- **The cursor is `OverlayScreen`'s, and it is a class on rows that already
  exist.** `MENU_ITEMS` is the list, `activateMenu` is what A fires, and the mark is
  a caret on the label plus a ring on the control — never a fill, since the tier
  buttons and Deploy button are *already* filled hot to say what is chosen. **The
  ring has to be INSET on anything chamfered**: every button here is cut by a
  `clip-path`, which clips its own element's outline and box-shadow along with the
  corner, so an offset outline draws on the tier group (a plain div) and silently on
  nothing else.
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
  (`OverlayScreen.card`). `showMenu` is called again on every difficulty change and on
  the way back from the kit and settings screens; a cursor that jumped home each time
  would make the row you just left the one place you cannot stay.

**The LEFT STICK drives all of it, and holding a direction repeats.** It is the
left stick alone (the right one turns the kit turntable), read raw against
`input.menuStickThreshold` rather than through the movement deadzone, because a menu
step is discrete and a stick resting a third of the way over must not scroll a list.
`InputManager` folds keys, d-pad and stick into two DIRECTIONS rather than four
buttons, so opposing presses cancel and a diagonal resolves into one step per axis;
`stepNav` turns a held direction into the edge-and-repeat the menus read. The repeat
is what makes a stick usable (it has no detent to tap) and deliberately does not
extend to confirm or back.

**Each screen hangs off the SHELL's tracks, and what is left screen-local is
what only that screen has.** `--col` is gone — the one content width every
block measured to was what made these screens a column in the middle of a
window (see the shell, at the top of this file). `#deploy` still declares
`--map`, because the map's side is genuinely the number the orders panel beside
it is measured against.

- **The menu's rows all state the same three tracks**, so the labels line up
  down the rail and every control begins on one edge — a label column sized to
  `max-content` is measured per row, and five rows would find five widths. Each
  row is a box of its own rather than `display: contents`, because each one now
  carries a selection: a plate and an accent bar down its left side. The control
  column is `minmax(0, 1fr)`, so the four difficulty tiers and the kit button
  span the same width.
- **The panel beside the rail is redrawn on every cursor move and the rows are
  not.** The rows carry the selection as a class on elements that already exist,
  for the reasons below; the panel has no listener, no transition and no hover
  state on it, so rewriting it costs one box's layout and nothing that can be
  seen going wrong. `start` gets a DEPLOYMENT BRIEF rather than nothing, and
  that is where the cursor opens — the map, the enemy and the kit, which are
  the whole of what the button under it is about.
- **The map row's schematic is drawn from the LAYOUT, never from a built map**
  ([`MapThumb.ts`](../src/ui/MapThumb.ts)). The deploy screen draws its map out
  of the finished collider set, which is the honest way to draw a map you are
  standing in; the menu is the one screen in the game where there is no built
  map at all, and building one to illustrate a row costs the ~0.7 s the building
  card exists to cover. Everything it reads — the heightfield, the water rects,
  the scatter regions, the placements, the flags — is a module constant that was
  in the bundle before the player pressed anything, and its palette is the map's
  own `EnvironmentSpec`, so a fourth map is coloured by what it ships with
  rather than by a table here somebody has to remember to extend.
- **A `WaterRect` is an EXTENT and the waterline is DERIVED**, which is the one
  thing on that schematic that cannot be read straight off the layout. The real
  surface is a flat plane and the world is opaque, so a body is only the part of
  its rect the floor does not stand in front of — and the rects say so plainly:
  Greyfen's flood is one 250 m rect over the whole valley and Harrowmead's leat
  is 404 m by 100, so drawing the rects reported both maps as open water end to
  end, with flags in it. `drawWater` bakes a depth mask over the union of the
  rects instead, against the same `waterY` the surface sits at and the same
  `TerrainField.surfaceAt` the real bed map is baked from, and draws nothing
  where that depth is not positive. **A map with no `WaterEnvSpec` draws no
  water here**, because `WaterSystem.build` returns on the same test.
- **The prose those panels carry lives with the thing it describes**, not in
  this directory: a map's line is `MapDef.blurb` in
  [`world/maps.ts`](../src/world/maps.ts), a tier's is `blurb` beside its own
  `centre` in `CONFIG.bots.skill.difficulties`, and a weapon's is
  `WEAPON_BLURBS`, which the kit screen already owned and now exports. Every
  figure beside them is read off the same object the line is on — the flag
  count, the extent, the view distance, the reaction time — so a panel cannot
  describe a map or a difficulty that is not the one being played.
- **Only the controls opt into pointer events, never the rows.** `#hud` is
  `pointer-events: none` and the menu's confirm is a mouse-down anywhere, so a row
  that claimed events would turn its labels, hints and the grid's gaps into dead zones
  where a click does nothing instead of starting the round. **The cost is that a new
  control is unclickable until it names itself**, and the failure is quiet from both
  sides: the keyboard fires it through `activateMenu`, which never touches the DOM, so
  the row works perfectly for whoever is testing with a pad and is dead under the
  mouse. The screen-openers share one list in `base.css` (`kit-open`,
  `settings-open`, `mp-open`, `#deploy-kit`) and the selection ring is a second list
  in `overlay.css` — a fifth opener goes in **both**, not just the first. The
  multiplayer button shipped in neither and read as a bug in the button rather than a
  missing rule.
- **`#deploy-actions` is a column**, now that the buttons are in an orders panel
  beside the map rather than under it. They were a wrapping row because the
  map's width was all they had, and on a 768-tall laptop the longest kit
  ("Marksman rifle · Scope") did not fit beside a Deploy button — so the row
  broke and gave two full-width buttons anyway. Every input hint is in the
  frame's foot, which is the one row this screen has for them.
- **The deploy screen's foot is the only one CENTRED**, and the HUD is why. It
  is the one screen here drawn over gameplay chrome that is still up: the vitals
  are in the bottom-left corner and the ammunition column is in the
  bottom-right, which are exactly the two ends a full-width foot puts its hints
  and its button on. The middle of that edge is the one part of it the HUD
  leaves empty.
- **Its one-column rule is keyed on WIDTH alone**, unlike every other screen's.
  Those collapse on height as well, because a rail and a panel side by side in a
  short window have the room and not the height. This screen's second column is
  240 px of buttons beside a map that is height-led — so a short window is
  exactly where the two belong side by side, and stacking them there takes the
  map's height away to spend on the thing that did not need it. A landscape
  phone keeps both columns; a portrait one is what the rule is for.

**The menu and round-over card carry a `Deploy` button**
(`OverlayScreen.bindStart` → `Game.onStart`), and it is the **only** thing on either
card a pointer can deploy with. It began as a redundant target beside a
click-anywhere confirm, which is why it exists at all: an instruction in prose is not
a target, and "click, press Enter, or press Start" made a pad player work out which
was theirs. It now carries the mouse and the finger by itself. It is also where the
menu's cursor starts, keeping Enter and A meaning "start the round" the moment the
title appears.

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
the marker and the status line — which names the selection, because a highlight
300 px away is not a label — move on the frame the key was pressed.

**`#deploy-go` is the pointer's way off that screen**, since the confirm no longer
takes a click. Pointerdown, like the map's markers: the same event goes on to take
the pointer lock, which it can only do once `spawnPlayer` has moved the state to
`playing`. It greys itself (`.waiting`) while `confirm()` is still a no-op.

**The right half of the kit screen is a turntable carrying the real viewmodel.** It
is not a second model, not a render target and not a second camera: `ViewModel`
simply has a pose that is not the carried one (`beginInspect` / `spinInspect` /
`updateInspect` / `endInspect`), and the weapon is already parented to the camera
and drawn in `VIEWMODEL_GROUP`.

- **The stage is a hole in the screen's scrim.** Everything the kit screen draws is
  DOM and DOM is above the canvas, so a backdrop over the stage would dim the weapon
  along with the world. `#loadout`'s scrim stops at the panel column and the stage
  gets a vignette instead; `show()` marks `#hud` so the CSS can hide the menu, the
  deploy map and every gauge while the kit is up.
- **What the weapon is read against is therefore in the SCENE, not in the
  stylesheet**, and the vignette's first stop is fully transparent because of it.
  It used to open at alpha 0.5 over the middle of the stage — where the weapon is
  — so the frame was drawing the one thing the screen exists to show at half
  strength, and the map behind it at half strength too, which is a contrast
  problem the DOM cannot solve from the wrong side of the canvas. The dark card
  now behind the weapon (`CONFIG.viewmodel.inspect.backdrop`,
  [`weapons.md`](weapons.md)) is what holds the map down; the vignette is left
  closing the corners of the bay and nothing else.
- **The stage's geometry is shared with `CONFIG.viewmodel.inspect`.** The pose is
  placed by back-projecting a SCREEN anchor, and the anchor works out to exactly the
  CSS `--panel` fraction (the stage's centre is `(1+p)/2` across, which in NDC is
  `p`). Both are fractions of the viewport, so a resize moves them together; the
  distance additionally gives way on a viewport narrower than `aspectReference`,
  because apparent size follows the vertical FOV while the room to fit in is a share
  of the width.
- **The turntable rotation is a quaternion, and the only thing allowed to write
  one.** The carried pose is Euler, composed in the weapon's own frame, so at a
  side-on yaw the pitch a drag asks for arrives as a roll. `endInspect` dropping the
  quaternion is what lets the Euler pose come back at all — while one is set Babylon
  ignores `rotation` entirely.
- **It rotates about a derived pivot, not the node's origin** (which on a rifle is
  the receiver — a turntable about that would swing the weapon around the screen).
  `applyFit` measures the pivot from the weapon's own muzzle landmark.
- **The hands let go.** A forearm cut off at the elbow reads fine on a carried
  weapon and as a severed arm on a bench, so `ViewModel` hides the arm meshes for the
  duration — one place writes mesh visibility.
- **The FINISH row is the one pick on this screen that is not a trade, and it
  is drawn like the other two anyway.** Every other choice here costs
  something — a magnification is a field of view, a burst is four tenths of a
  second — and a finish costs nothing, so it gets no bar on the chart and never
  moves one. What it has instead is the stage. Two consequences: its buttons
  carry a three-stop SWATCH along the top edge (furniture, receiver, fittings,
  in the order the eye reads a weapon), because "Verdigris" and "Oxblood" are
  words you would otherwise have to try one at a time; and its COPY is written
  under the weapon rather than beside the bars, because a finish is the one pick
  whose whole effect is the thing already turning on the turntable. The swatch
  is absolutely positioned into padding the button already has, so a finish
  button measures exactly like a weapon's — four pixels taller, times three
  rows, is a whole row's worth on the viewport with least height to give.
- **A third row of buttons is 45 px of panel, and the panel is what paid for
  it.** Two pixels off each row's padding and each gap, a smaller flex BASIS for
  the two rows whose names are one short word each (68 against the weapon row's
  96, which is sized for "SUBMACHINE GUN"), and a row gap on the detail card
  stated apart from its column gap — only one of the two is ever spent, and a
  single number was charging the stacked case for a gutter it does not have.
  Between them the screen fits 1280x720 again, and a landscape phone fits the
  five optics on one line where it used to break them 3 + 2.
- **`.lo-panel` scrolls at every height now, and centres SAFELY.** It used to do
  both only below 560 px, so between there and a full desktop a window that ran
  out of room simply put the footer under the bottom edge with no way to reach
  it — and a column centred in a box it is taller than overflows equally at both
  ends, which puts the head out of reach too. `justify-content: safe center`
  drops to flex-start exactly when that would happen. A third row of buttons is
  not the sort of thing that should be able to strand the way off a screen.
- **On a landscape phone the whole HEAD goes**, and it is the same argument
  that already took the prose. This is the one screen outside `--ov-scale`, so
  it has to fit a 390 px-tall window on its own; the eyebrow says what kind of
  screen this is, the slot opposite names the weapon carried, and the STAGE's
  own caption already says the second under the weapon itself. Two lines of
  head there is the Back button falling off the bottom.

`Game.updateKitStage` drives it, because `loadout` is the one lid state showing live
3D and owes by hand the per-frame pushes only `updateGameplay` makes. The camera
position is the load-bearing one — the cel shader fogs against `camPos`, which
outside a round is whatever the last gameplay frame left and `Vector3.Zero()` before
the first, so a kit opened off the main menu would fog the weapon to a grey
silhouette. It also puts up the two bench lamps (`CONFIG.lighting.kitLamps`),
through `LightingSystem` like every other light because a carried light always wins
a slot; they are far brighter than the shoulder lamp on purpose, since moonlight
alone on a night game's albedo is a black silhouette. `stowKit` is the single
teardown — screen, pose and lamps — and all four exits go through it, because a
carried light nobody removes survives `lighting.clear()` and follows the player into
the round.


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
- **The three things it draws that it cannot know are pushed in**, exactly as
  every gauge in `HUD` is and with the same write guards: whether the body is
  crouched (it owns no crouch latch — `InputManager` has one already, shared with
  `C` and the pad's B), whether the magazine wants attention, and what the
  vehicle verb would do right now. Nothing else about the round reaches it.
- **One button is CONTEXTUAL, and it is the whole reason a phone can drive.**
  Every other control on the layer is a key that has always been there, because
  a key is something a player presses to find out what it does — and glass has
  nothing to press until something is drawn under it. So `setUse` gives the
  vehicle verb a label and puts it on screen, and null takes it away again;
  `Game` decides, from the same `offerUse` that writes the HUD's prompt, so the
  sentence on the button and the sentence over the crosshair cannot disagree.
  Two rules come with it: taking the offer away also LETS GO of the button (a
  finger resting on `EXIT TANK` when the hull brews up must not be reported held
  when the next offer puts it back), and `releaseAll` hides it as well as
  clearing it, because here the class is not a look but the control's whole
  existence.
- **The buttons are `.frame`s**, the same chamfered hull the panels use, cut on
  the same two corners. Not decoration: `base.css` bans `border-radius` on
  gameplay chrome, and a set of round translucent buttons is precisely the "web
  card" that rule exists to keep off this HUD.
- **The one control that is not input is the pause button**, and it is a callback
  out (`onPause`) like every other screen's, guarded on the state in
  `wireScreens` like every other one. A phone has no Escape key, so without it a
  round cannot be left at all.
