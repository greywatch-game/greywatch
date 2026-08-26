# The state machine: steps, lids, and what still moves under one

What each game state IS, which of them are screens laid over another, and what a
frame owes when there is one up — offline, where a lid genuinely holds the world,
and in a netplay round, where it holds nothing at all. Split out of
[`CLAUDE.md`](../CLAUDE.md), which keeps the summary; this file is the contract
for `src/core/ScreenStack.ts` and for `Game`'s `tick`, `pause`/`resume` and every
`open*`/`close*` next to them.

## The machine does not exist until TWO awaits have resolved

**`menu` is not the first thing that happens on the page, and the boot screen is
what covers the stretch before it.** `main.ts` awaits two things before it
constructs `Game` at all — the WebGPU device (an adapter, then `initAsync`) and
the Havok WASM — and both are REQUIRED, so a failure of either is a sentence on
the boot screen rather than a state anything below has to be written for. There
is no `booting` state and there must not be one: the states in this file are
states of a `Game` that exists, and everything before the constructor returns is
`index.html`'s markup and `main.ts`'s three failure branches.

**What that buys is the property ~40 smoke scripts rest on**: because both
awaits are `main.ts`'s, the constructor stays SYNCHRONOUS, so `window.__celshock`
is non-null with every pool built the moment it returns and the machine is in
`menu` on the same tick. A `static async create()` would have moved the awaits
inside and taken that away. `VERIFYING.md` says how to wait for it from a script
— two awaits, not one, and neither of them is a frame count.

## The cycle

`Game`'s state machine is `menu -> loading -> deploy -> playing -> dying ->
deploy`, with `roundover` when a side runs out of tickets. The 3D scene renders
in **every** state, which is what lets the deploy screen and the menu sit over a
live view.

**`loading` is the map being built, and the split that creates it is the whole
feature.** Building one is the better part of a second of synchronous work —
merges, the occlusion bake, the nav grid — and a browser paints between TASKS,
never inside one, so a `startRound` that built the map where it stood froze the
card the player had just confirmed for the entire build and then jumped to the
deploy screen. Nothing was slow that is not slow now; what was missing was any
sign the game had heard the button. So `Game.startRound` raises the building
card and hands the work to `Game.buildRound` **two** `requestAnimationFrame`s
later, and the count is load-bearing: a frame runs its animation callbacks and
*then* paints, so a single rAF booked from ordinary task code fires before the
card has ever been on the glass and the freeze happens under the old screen
exactly as before. One is enough from inside the render loop, which is where
the real callers are — the second is what stops that being a property of the
call site. It is a **STEP, not a lid**: nothing may simulate there (`tick` has
a deliberately empty arm) because there is no map yet, and `startRound` guards
on it so a second build can never be queued over a pending one.

**`dying` is the death cam and is a STEP, not a lid** — `updateWorld` runs in full
underneath it. **`loadout`, `settings`, `lobby` and `paused` are lids**: a screen
laid over a state, which taking it off puts back rather than moving the game on.
The loadout screen covers `menu` or `deploy`; a pause covers `playing`, `dying` or
`deploy`, so a pause taken while waiting out a respawn returns to the deploy map
rather than dropping the player into the world.

## The table, and why it is a table

**Which is which, and what each one owes, is DECLARED — in `SCREENS` in
[`src/core/ScreenStack.ts`](../src/core/ScreenStack.ts), one row per state, and
the row is not optional.** The table is a `Record<GameState, ScreenSpec>`, so a
new screen does not compile until it has answered all four questions, and
`Game.tick` asks the table rather than trusting each screen to volunteer:

| field | the question | answered `true` by |
| --- | --- | --- |
| `covers` | which states may this be raised over? (`null` makes it a step) | the four lids |
| `holdsWorld` | offline, is the world under this genuinely stopped? | `paused` |
| `roundBehind` | online, does the authority's fight carry on behind this with nothing else stepping it? | the lids, and `deploy` |
| `inRound` | is the player in a round here — is the scoreboard owed? | `deploy`, `playing`, `dying` |

This replaced three `-From` fields on `Game`, a two-deep chain of `if`s that
peeled them, and four screens that each had to REMEMBER to step the half of a
netplay frame a lid does not stop — a rule that was enforced by a comment saying
the next screen owed the same call the day it was written. **The reason to keep
it a table is that it fails loudly.** A fifth screen is a compile error until it
answers, and its answers sit next to four that are already right, which is a
different kind of review than reading a paragraph and hoping.

`Game` holds one `ScreenStack` and has exactly three moves — `go` a step,
`raiseLid`, `lowerLid` — and **nothing in the codebase assigns a game state**:
`Game.state` is a getter over the stack. The fifty-odd places that ASK what state
the game is in are unchanged by any of this; it is only the answering that is
funnelled.

**A step transition takes down whatever lids were up, and that is `go`'s job
rather than the caller's.** The three transitions that leave a round — the menu, a
round starting, F2 into the editor — each used to write out the same list of
screens to put away, and the copies had already drifted: F2 from the lobby left
the match list hanging over the editor's own panel. The other twelve wrote none
of it, which was invisible offline (nothing moves the state while a lid is up
when the player is the only thing deciding) and broken online, where the wire
decides: a `died` landing under the settings screen overwrote `settings` with
`deploy` and stranded the screen on top — visible, uncloseable, with the deploy
screen live and taking input underneath it. `ScreenStack.go` hands back what was
up and **`Game.takeDown` — exhaustive over `LidState`, enforced with a `never` —
is the single place that knows what putting one away means.**

## Pausing, and the netplay inversion

Pausing is just `tick` not calling `updateGameplay` — everything else still
renders, so the round reads as held rather than gone — plus two things that would
leak past it: `Sfx.setSuspended` stops the audio clock (the tail of the last shot
is still there on return, and the voice counter stays honest because nothing ends
while the clock is stopped), and the HUD is ticked with `dt = 0` so the killfeed
and toasts freeze with the world instead of fading off a frozen screen.

**Both of those invert under a NETPLAY lid, because there the game is not
held.** The authority never heard the key, so every lid declares `roundBehind`
and `Game.updateRoundBehind` — called once from `tick`, before the switch, for
whatever is on screen — steps the netplay frame and the gauges as the deploy
screen draws them, plus the reinforcement clock when the deploy screen is what
the stack is over, since that clock is the round's and the server runs it down
regardless. The HUD keeps its real `dt` (kills arrive while the card is up), and
the audio clock is left running: a suspended context would not play the wire's
`hit`/`damage`/`explode` cues *or* let them end, and the whole pause-worth of
them would sound on the resume. **The question is never which screen is up, but
whether what is under it is moving** — `holdsWorld` and `roundBehind` in the
table are that question asked once per screen, `Game.worldHeld` adds the one
thing the table cannot know (is there a session at all), and a new screen over a
round cannot fail to answer.

It is called before the switch rather than after it because `dt` is time that has
already passed, and the screen that was up while it passed is the one the frame
belongs to. The states that are IN the fight answer `false` — `updateWorld` steps
that same frame already, and a second answer here would step it twice.

## The pointer lock

**Losing the pointer lock is the trigger, and it has to be.** Escape belongs to
the browser — it is the UA's gesture for dropping the lock and the keydown behind
it is not reliably delivered — so `Game` pauses on the *transition* out of the
lock, which also covers alt-tab and any focus loss. A player who never took the
lock (a pad player) has none to lose, hence the transition test rather than a bare
"not locked". `Escape` and gamepad Start are the second trigger, through
`input.pausePressed`; Start also raises `confirmPressed` (it is the menus' deploy
button), so the paused branch handles pause first and breaks. Gamepad **B** resumes
(`menuBackPressed`). The list is confirmed with `menuConfirmPressed` — Enter and
pad A but *not* the mouse — because a click on the empty half of a pause screen is
not a menu choice.

**Re-taking the lock on resume is deferred, retried, and never pauses on its own
failure** — the one key that ends a pause is the one key the browser reads as
"drop the lock", so asking for it back in the same breath loses three ways.
Chrome refuses outright for about a second after an Escape-exit; a lock granted
while Escape is still down is taken away again by the key's auto-repeat; and
that revocation arrives as a `pointerlockchange` the pause trigger would read as
a player leaving, putting the menu back up a split second after it was
dismissed. So `resume` only *marks* the lock as owed, `updatePendingLock` waits
for the key to come up and then asks on an interval until the lock lands or the
window runs out, and a loss inside `CONFIG.input.lockGrace` of taking it is read
as a refusal rather than a departure. If the browser holds out, the round is
still running with the CLICK hint up and the next click gets it.

## What the pause card is on screen

`#hud.paused` is deliberately **not** `.overlaid`: the menu and round-over card
hide the gauges because what is under them is last round's, while under a pause the
tickets, flags and vitals are current and frozen with the scene. It hides what
would be lying — crosshair, hitmarker, damage arcs, mouse hint. It is also the one
overlay taking pointer events across its whole area, because the deploy screen
underneath takes them too and a click through the backdrop would land on its map or
Deploy button.
