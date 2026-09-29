---
name: ui-screen
description: Design, redesign or fix an interface screen under src/ui/ so it reads like a game's front end rather than a web page and works with a pad, a mouse and keyboard, and a finger on every viewport from a landscape phone to a 32:9 monitor — the procedure, the front-end vocabulary the main menu and the kit screen share, the checklist of traps, and scripts that photograph a screen at every viewport and audit it for dead controls, small targets and clipped text. Use whenever the task is "redesign / rework / make prettier / make work on phones / fix the layout of / add" a menu, a lid screen, a card or any other screen; not for the in-round HUD chrome (hud.css), which has its own ladder.
---

# Designing an interface screen

The main menu (`c2c58eb`), the kit screen (`5e61fbc`) and the settings screen
were each redesigned from a form into a front end by the procedure below, and
those commits are the worked examples — read their messages before starting,
and read the sources as the reference implementations
(`OverlayScreen.showMenu`/`buildMenu`/`patchMenu` + `overlay.css`'s menu
block; `LoadoutScreen.ts` + `loadout.css`; `SettingsScreen.ts` +
`settings.css`, the one to copy for a LIST that belongs in the front end).

Read before touching anything:
- `docs/ui.md` — the contract for everything under `src/ui/`: the front end,
  the main menu, the kit screen, getting into a round (the list model, the
  pointer's one way into a round, the bumpers). This skill does not restate it;
  it points at it.
- CLAUDE.md's "The interface is five screens and the chrome" section, and
  `docs/states.md` if the screen is a new lid or a new state.
- the screen's own contract header, and the `Game` methods that open, feed
  and close it (`grep -n "<Screen>\." src/core/Game.ts`).

Then load **[craft.md](craft.md)** — the design stance, the shared vocabulary,
and the traps. Always.

## The procedure

### 1. Photograph it as it stands

```bash
node .claude/skills/ui-screen/scripts/shoot.mjs --out <scratchpad>/shots --tag before \
  --screen <menu|kit|settings|lobby|deploy|kit-deploy|pause|building> [--pad]
node .claude/skills/ui-screen/scripts/audit.mjs --screen <same>
```

`shoot.mjs` takes nine viewports (`--views all`): three landscape phones, two
tablets, a laptop, 1080p, an ultrawide, and an upright phone as the fallback
check. `--pad` adds a picture with the controller's prompts; `--steps` walks
the cursor and photographs each state (see the script's header). A screen not
in the list is one row in `scripts/lib.mjs`'s `SCREENS`. The scripts need a
GPU and boot their own dev server — read VERIFYING.md for this machine first.
Write to the scratchpad, never the repo.

Also photograph the MAIN MENU (`--screen menu --views 844x390,1920x1080`)
before any change to `base.css` or the shared prompt/unit block: it is the
screen most likely to be broken by accident, and the before pair is what
proves it was not.

Say in one line what the screen reads as now ("a web form: a strip of
buttons, three columns of framed lists and a chart"). That sentence is the
commit's second sentence and the thing the work fixes.

### 2. Decide what the screen IS before where anything goes

A front end is organised by what each thing is, not by what fits where. Name:
- **the title** — the one thing the screen is ABOUT (a map, a weapon, a
  match), set large;
- **the list** — what the cursor walks, in the order the decisions depend on
  each other;
- **the page** — the thing the bumpers turn from anywhere (the menu's map,
  the kit's weapon), if the screen has one;
- **what is READ rather than pressed** — that is the intel plate, and it is
  the first thing a small viewport drops;
- **the way out** — a fixed place, never a row in a list.

Then read craft.md's "Which frame": there is one frame now, the front end,
and the round-over card was the last screen to leave the shell for it.

### 3. Lay it out as named areas, then write the templates

Every block is a `grid-area`; the viewports are TEMPLATES over the same
markup, never a second copy of it. Write WIDE first, then the three others in
craft.md's order, and design the LANDSCAPE PHONE as a layout of its own — the
game asks for landscape everywhere it can, so that is the phone layout — while
the upright phone only has to not break.

### 4. Build once, patch after

Write the markup in the constructor (or on a RAISE) and patch it on every
change: classes and text, and a block replaced only when replacing it is how
its animation replays. Keep a `shown` record of what is on screen and compare
against it. The patch model is what makes the entrance, the title wipe, the
rail's deal and the bars' slide possible at all — see craft.md.

### 5. Wire the input in `Game`, not in the screen

Up/down, left/right, confirm, back and the bumpers are `InputManager`'s
`menu*Pressed` edges, read in the screen's `update…` branch in `Game`; the
screen exposes verbs (`moveSlot`, `cycle`, `stepWeapon`) and callbacks, and
reads no input itself. Push the device every frame once
`input.anyDeviceUsed` (`setInputDevice`, a class compare). The pointer is
handled by the screen's own listeners on its own controls.

### 6. Audit, drive and photograph again

```bash
node .claude/skills/ui-screen/scripts/audit.mjs --screen <s>
node .claude/skills/ui-screen/scripts/shoot.mjs --out <scratchpad>/shots --tag after --screen <s> --pad \
  --steps <steps.json>
```

`audit.mjs` fails on a DEAD control (the pointer cannot reach it) or one OFF
the glass, and lists CLIPPED text and SMALL touch targets for judgement. Look
at EVERY picture, every template, both devices. Then drive the interactions
with a `--steps` file that clicks (`document.querySelector(…).click()` — not
Playwright's `click()`, which the canvas intercepts; VERIFYING.md) and returns
the game state it changed, and assert on what comes back: the pick applied,
the cursor moved, the screen closed, the state is right after Back.

### 7. Docs, gates, commit

- `docs/ui.md` — the screen's section says what it is and why, argued; the
  front-end paragraph at the top stays true.
- CLAUDE.md's interface section — only what someone NOT editing this screen
  could break (per-section cap: see CLAUDE.md's own head).
- `FILES.md` — a line per new file; the screen's line rewritten.
- `npm run typecheck`, `npm run build`, the audit clean of DEAD/OFF on all
  views, the main menu's pictures unchanged.
- Commit in the repo's style (`git log -3`): the first sentence says what the
  screen IS now, the second what it read as before, then the layout, the input
  model, the templates, what moved into shared files, and what was verified
  and what was not ("Not tried on a physical pad or phone").
