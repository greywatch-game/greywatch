/**
 * SettingsScreen.ts — The settings screen: a list of choices over a scrim, split
 * into pages, one of which is the key-cap table naming every control.
 * Owns #settings and its own page and row selection; owns no setting, and
 * applies nothing — every change leaves through `onChange` and comes back as a
 * `setValues` from Game, so the screen can never disagree with what is stored.
 * Invariants: the rows are DATA (`PAGES`), never markup — this screen exists to
 * grow, and a hardcoded row is a row the keyboard navigation does not know
 * about. Every row is one CHOICE over a list of options, whatever it is drawn
 * as: `style` picks the button group or the slider and changes nothing below
 * the markup (see `ControlRow`), and the page selector is a row of that same
 * shape so that switching page needs no key the screen did not already read.
 * Above #loadout's z-index, because it is reachable from the pause lid and has
 * to cover everything the pause card sits over.
 */
import "./settings.css";
import { CONFIG } from "../config";
import type { Settings } from "../core/settings";

/**
 * One line on the screen: a labelled CHOICE bound to one field of `Settings`.
 *
 * **A toggle is a two-option choice, which is why there is only one control
 * type here rather than two.** The markup was already an N-button group with
 * Off and On in it, so an enumeration needed no second renderer, no second
 * key handler and no second hit-testing path — only a longer list.
 *
 * **`style` is where a longer list stops fitting, and it is a rendering choice
 * over the SAME options.** The control column is fixed — three rungs is ~60 px a
 * button and sixteen is 10 px, narrower than one character of a letterspaced
 * 10 px face — so a row whose options run past a handful draws as a slider
 * instead: a track the whole list is laid along, a thumb at the current rung and
 * the value beside it.
 *
 * **The slider is positioned by INDEX, not by value, and that is what keeps it
 * a choice over `options` rather than a second kind of setting.** The thumb
 * travels one option per equal share of the track, so what the store holds is
 * always a member of the same table the arrow keys step through, the same table
 * a codec in [`settings.ts`](../core/settings.ts) validates against — a drag
 * cannot land on a value a keypress could not reach, and nothing downstream
 * learns that the row looks different. It also means a ladder with deliberate
 * spacing keeps it: `CONFIG.camera.lookScales` is geometric, so an inch of drag
 * is the same RATIO of look speed wherever on the track it is taken.
 *
 * `ControlRow` is generic over the key so each row's options are typed against
 * that key's own value; `AnyControl` distributes it into a union, which is what
 * stops `renderScale` being given `true`. The pairing is enforced HERE, in the
 * table, because it cannot be at the callback: `onChange` has to be one
 * function over every key.
 */
interface ControlRow<K extends keyof Settings> {
  key: K;
  label: string;
  hint: string;
  options: readonly { value: Settings[K]; label: string }[];
  /** How the options are drawn. Absent is the button group. */
  style?: "slider";
}

type AnyControl = { [K in keyof Settings]: ControlRow<K> }[keyof Settings];

/**
 * One binding, as the key-cap table draws it: what it does, the pad's button,
 * and the keyboard's. Reference material and nothing else — this screen shows
 * the bindings, it does not own them, and nothing here is editable yet.
 */
type Binding = readonly [action: string, pad: string, keys: string];

/**
 * The player's controls. They were on the MENU and on the pause card, drawn
 * from one table by one loop — which is where they had to be while the settings
 * screen was two toggles nobody could reach with a pad. Now that it is a screen
 * a cursor lands on from both places, a reference table belongs in it rather
 * than under the title of the screen you start a round from: the menu is five
 * decisions and a Deploy button, and eleven rows of key caps under them is the
 * longest block on the card and the one nobody reads twice.
 */
const BINDINGS: readonly Binding[] = [
  ["Move", "Left stick", "W A S D"],
  ["Look", "Right stick", "Mouse"],
  ["Aim", "LT", "RMB"],
  ["Fire", "RT", "LMB"],
  ["Jump", "A", "Space"],
  ["Reload", "X", "R"],
  // Three keys, because they are two different asks: the wheel swaps to the
  // other weapon and the numbers name one outright. Y is the kit screen's
  // button in a menu and this one in a round; the two states never overlap, so
  // the table can name it here without qualification.
  ["Weapon", "Y", "Wheel 1 2"],
  ["Grenade", "RB", "G"],
  ["Sprint", "L3", "Shift"],
  // Two keys because they behave differently — Ctrl is held, C latches, and
  // on the pad B latches too. The table's grammar is one chip per key and it
  // has nowhere to say which is which; the pair reads as "either", which is
  // true, and one press of each tells the rest.
  ["Crouch", "B", "Ctrl C"],
  ["Pause", "Start", "Esc"],
];

/**
 * A page of the screen, and the unit this list GROUPS by.
 *
 * It replaced a `heading` row, and for a reason that is about height rather
 * than about tidiness: NOTHING in this HUD scrolls, so a list that grows past
 * the panel does not get a scrollbar, it gets a foot the player cannot see.
 * A heading buys an inch of separation and spends the same height as a row; a
 * page buys the whole rest of the list back. The rule is the mechanical one —
 * a page that outgrows the panel splits into another page, exactly as a section
 * would have split into another heading.
 *
 * `bindings` is the one thing on this screen that is not a choice: reference
 * material drawn under the page's rows, skipped by the cursor because there is
 * nothing on it to pick.
 */
interface Page {
  label: string;
  rows: readonly AnyControl[];
  /** The key-cap table beside the rows, on the page that carries one. */
  bindings?: readonly Binding[];
  /**
   * What the page's panel says about the MACHINE, under the row's own line.
   *
   * A function rather than a table of strings because every one of these is
   * measured at the moment it is drawn — the window's size, the pixel ratio —
   * and a settings screen that reports the size the window was when the bundle
   * loaded is worse than one that reports nothing. It is also what keeps the
   * Display page's panel from being a heading and one sentence in a column the
   * height of the screen: the Controls page has a key table to fill it and
   * this is the other page's answer.
   */
  facts?: () => readonly [string, string][];
}

/** Off/On, the shape four of the rows share. */
const OFF_ON = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
] as const;

/**
 * The look-speed ladder, straight off the config's list — the same rule the
 * render scale follows, so the screen cannot offer a rung the store would
 * refuse to remember. Two decimals on every rung, including 1, so the numbers
 * hold one column width as they step rather than jumping about under the
 * cursor.
 */
const LOOK_SCALES = CONFIG.camera.lookScales.map((v) => ({
  value: v,
  label: `${v.toFixed(2)}&times;`,
}));

/**
 * The pages, in tab order. Controls first, and that is about where the cursor
 * and the pointer both arrive: `show()` opens on the first page, the pause
 * list's Settings item is the one place a player mid-round goes looking for a
 * key they have forgotten, and look speed is the setting anyone goes hunting
 * for on the first evening — a resolution is something you change once when the
 * frame rate tells you to.
 */
const PAGES: readonly Page[] = [
  {
    label: "Controls",
    rows: [
      {
        key: "mouseSensitivity",
        label: "Mouse look",
        hint: "Mouse look speed",
        options: LOOK_SCALES,
        style: "slider",
      },
      {
        key: "stickSensitivity",
        label: "Stick look",
        hint: "Gamepad look speed",
        options: LOOK_SCALES,
        style: "slider",
      },
      {
        key: "touchSensitivity",
        label: "Touch look",
        hint: "How far a drag turns the view",
        options: LOOK_SCALES,
        style: "slider",
      },
    ],
    bindings: BINDINGS,
  },
  {
    label: "Display",
    rows: [
      {
        key: "renderScale",
        label: "Render scale",
        hint: "Share of the display's own pixels the scene is drawn at",
        // Straight off the config's ladder, so the screen cannot offer a rung
        // the store would refuse to remember.
        options: CONFIG.graphics.renderScales.map((v) => ({
          value: v,
          label: `${Math.round(v * 100)}%`,
        })),
      },
      {
        key: "fpsCounter",
        label: "FPS counter",
        hint: "Rate, frame time and 1% low",
        options: OFF_ON,
      },
      {
        key: "motionBlur",
        label: "Motion blur",
        hint: "Smears the view on a fast turn",
        options: OFF_ON,
      },
      {
        key: "horrorGrade",
        label: "Horror filter",
        hint: "Vignette, grain, and the red damage flash",
        options: OFF_ON,
      },
      {
        key: "profiler",
        label: "Frame profiler",
        // What it actually does, in the width a hint has: it records
        // CONTINUOUSLY and the capture reaches backwards, which is the one
        // thing a player has to know to use it — press the button AFTER the
        // hitch, not before.
        hint: "Records the last few thousand frames. KEEP copies a capture; SAVE writes the full one. F3 on a keyboard",
        options: OFF_ON,
      },
    ],
    // What the ladder above actually comes to on this machine. The scene's
    // backing store is the display's pixels times the ratio times the scale,
    // and Babylon floors it — the same arithmetic `hintFor` does for the row.
    facts: () => {
      const dpr = window.devicePixelRatio || 1;
      return [
        [`${window.innerWidth}\u00d7${window.innerHeight}`, "Window"],
        [dpr.toFixed(2).replace(/\.?0+$/, "") + "\u00d7", "Pixel ratio"],
        [
          `${Math.floor(window.innerWidth * dpr)}\u00d7${Math.floor(
            window.innerHeight * dpr,
          )}`,
          "Native",
        ],
      ];
    },
  },
];

/**
 * Row 0 is the page selector on every page, and the settings rows run from 1.
 *
 * That offset is the whole of the tab mechanism, and it is deliberately not a
 * key of its own. A dedicated tab button (Q/E, a bumper) is a control a pad
 * player has to be told about, and the screen already reads exactly what a page
 * selector needs: up and down reach the row, left and right step it, Enter
 * wraps it. It is a choice over a list of options like every other row here —
 * the only thing that makes it different is that what it changes is on this
 * screen rather than in the store, which is why it is not in `Settings` and not
 * in a `Page`'s rows.
 */
const SECTION_ROW = 0;

export class SettingsScreen {
  private root: HTMLElement;
  private body: HTMLElement;
  private values: Settings;
  /**
   * The column beside the list: what the cursor's row is FOR, and — on the
   * page that has one — the key-cap table.
   *
   * The hint used to be a third column on every row, which is a sentence
   * of prose in a cell as wide as a control, set at 10px and clipped when
   * the panel narrowed. One row's hint at a time, given a column of its own,
   * is both more of it and less of it on screen: the row you are standing on
   * gets a heading and a readable line, and the four you are not stop
   * competing with their own controls for width.
   */
  private side!: HTMLElement;
  /** The head's right-hand slot — which page the list is showing. */
  private pageEl!: HTMLElement;
  /** Which page is shown. Indexes `PAGES`. */
  private page = 0;
  /** Where the cursor is: 0 is the page selector, 1.. are the page's rows. */
  private row = SECTION_ROW;
  /**
   * The slider drag in progress: which control row it is on, and the track's
   * box as it stood when the pointer went down. Null when nothing is held.
   * See `beginDrag` for why the geometry is captured rather than re-read.
   */
  private drag: {
    row: number;
    left: number;
    width: number;
    thumb: number;
  } | null = null;

  /**
   * Wired by Game. Reports a change; does not apply or redraw it.
   *
   * One function over every key, so its value type is the union of every
   * field's — the key/value pairing is guaranteed by `PAGES` instead, where each
   * row's options are typed against its own key.
   */
  onChange: (key: keyof Settings, value: Settings[keyof Settings]) => void =
    () => {};
  onClose: () => void = () => {};

  constructor(initial: Settings) {
    this.values = { ...initial };
    this.root = document.createElement("div");
    this.root.id = "settings";
    // The shell's frame and its backdrop, carried permanently: this screen has
    // one card rather than four, so nothing here has to swap them the way
    // `OverlayScreen.setCardClass` does. `.hidden` is `!important` and wins
    // over the display the frame sets.
    this.root.className = "ui-screen ui-veil ui-solid hidden";
    this.root.innerHTML = `
      <div class="ui-head">
        <div class="ui-titles">
          <span class="ui-eyebrow">Options</span>
          <h2>Settings</h2>
        </div>
        <div class="ui-meta">
          <span>Applied as you choose</span>
          <b class="se-page"></b>
        </div>
      </div>
      <div class="ui-body">
        <div class="se-body"></div>
        <div class="ui-panel ui-optional se-side"></div>
      </div>
      <p class="ui-foot">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd class="pad">Stick</kbd> row</span>
        <span><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd>Enter</kbd><kbd class="pad">A</kbd> change</span>
        <button class="ui-back"><kbd>Esc</kbd><kbd class="pad">B</kbd> Back</button>
      </p>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    this.body = this.root.querySelector(".se-body")!;
    this.side = this.root.querySelector(".se-side")!;
    this.pageEl = this.root.querySelector(".se-page")!;
    // The pointer's way off this screen, in the footer every lid screen ends
    // with (`.ui-foot` / `.ui-back` in base.css) — same place, same chips,
    // same weight on all three, which is the point of it being shared.
    //
    // `click` is safe on a button INSIDE a screen that is already up: the
    // pointerdown rule the menu's kit button documents is about buttons that
    // race the overlay's own mouse-down confirm on the way in.
    this.root.querySelector<HTMLElement>("button.ui-back")!.onclick = () =>
      this.onClose();
    this.draw();
  }

  /**
   * The stored settings, pushed by Game. This is the only way the screen
   * learns a value changed — including changes it asked for itself, which is
   * what keeps a rejected or clamped setting from showing as applied.
   */
  setValues(values: Settings): void {
    this.values = { ...values };
    this.draw();
  }

  show(): void {
    // Always open on the first page and its first row, for the reason the kit
    // screen documents: a screen that remembers a cursor from three sessions
    // ago is one you have to read before you can use it. The page is part of
    // that — a screen that opens on Display because that is where you were last
    // week hides the controls table from the player who came looking for it.
    this.page = 0;
    this.row = SECTION_ROW;
    this.root.classList.remove("hidden");
    this.draw();
  }

  hide(): void {
    // A drag held on the window would otherwise outlive the screen: the pointer
    // that opened a pause and came back up over the round would still be moving
    // a slider nobody can see. Escape closes this screen with a button down as
    // easily as with one up.
    this.endDrag();
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** The rows of whichever page is up — what the cursor steps through. */
  private get rows(): readonly AnyControl[] {
    return PAGES[this.page].rows;
  }

  /** The control at a cursor position, or undefined on the page selector. */
  private controlAt(row: number): AnyControl | undefined {
    return this.rows[row - 1];
  }

  /** Steps the highlighted row, wrapping at both ends — the menu's up/down. */
  moveRow(delta: number): void {
    // The page selector is one of them, which is what puts it in reach of a
    // pad without a button of its own.
    const n = this.rows.length + 1;
    this.row = (this.row + delta + n) % n;
    this.draw();
  }

  /**
   * Steps the highlighted row's value — or, on row 0, the page.
   *
   * **Left/right clamp; Enter wraps.** They used to be the same move because a
   * boolean has only one other value to reach, and with a three-rung ladder on
   * the screen they stop being: left on the lowest rung has to stay put, or a
   * player stepping down a resolution list lands back at the top and reads it
   * as the setting having refused. Enter is the opposite case — it is one key
   * being asked to reach every value, so it has to come round. The page
   * selector follows the same rule for the same reason, which is most of why it
   * is drawn as a row rather than as a strip of tabs with a key of its own.
   */
  stepRow(delta: number, wrap: boolean): void {
    if (this.row === SECTION_ROW) {
      this.setPage(step(this.page, delta, PAGES.length, wrap));
      return;
    }
    const row = this.controlAt(this.row);
    if (!row) return;
    const options = row.options as readonly { value: unknown }[];
    const at = options.findIndex((o) => o.value === this.values[row.key]);
    const from = at < 0 ? 0 : at;
    const next = step(from, delta, options.length, wrap);
    if (next === from) return;
    this.onChange(row.key, options[next].value as Settings[keyof Settings]);
  }

  /**
   * Shows a page. The cursor comes back to the selector rather than being
   * clamped into the new list: row 3 of Display is not row 3 of anything else,
   * and the row the player is standing on is the one they just used.
   */
  private setPage(next: number): void {
    if (next === this.page) return;
    this.page = next;
    this.row = SECTION_ROW;
    this.draw();
  }

  /**
   * The row's hint, with what the chosen value actually WORKS OUT TO spliced
   * onto the end of it.
   *
   * "75%" on its own says nothing a player can act on — what they want to know
   * is the number of pixels it lands on, and that depends on their window and
   * their panel, so it cannot be written into the table. A bare "1.25x" is the
   * same problem one step worse, since it is a multiplier over a number the
   * screen never shows: what a player is comparing against the shooter they
   * came from is a turn per unit of hand movement, so that is what the hint
   * resolves to. Both are computed rather than stored, because both depend on
   * something the table cannot know.
   */
  private hintFor(row: AnyControl): string {
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
    const c = CONFIG.camera;
    switch (row.key) {
      case "renderScale": {
        // Rounded down the same way Babylon rounds the backing store, so the
        // two agree.
        const dpr = window.devicePixelRatio || 1;
        const scale = this.values.renderScale;
        const w = Math.floor(window.innerWidth * dpr * scale);
        const h = Math.floor(window.innerHeight * dpr * scale);
        return `${row.hint} &mdash; ${w}&times;${h}`;
      }
      // Per 1000 px rather than per pixel: the rate itself is a fraction of a
      // degree, and the number a player recognises is the sweep.
      case "mouseSensitivity":
        return `${row.hint} &mdash; ${deg(
          c.sensX * 1000 * this.values.mouseSensitivity,
        )}&deg; per 1000 px`;
      // At full deflection, which is the only deflection a rate can be quoted
      // at — everything short of it is the stick curve's business.
      case "stickSensitivity":
        return `${row.hint} &mdash; ${deg(
          c.stickSensX * this.values.stickSensitivity,
        )}&deg;/s at full stick`;
      default:
        return row.hint;
    }
  }

  /**
   * The control cell's markup: a button per option, or the slider a long ladder
   * is laid along.
   *
   * The slider carries its position as `--t`, a 0..1 fraction of the OPTION
   * INDEX, and the stylesheet turns that into a thumb offset. That split is the
   * point: this file may not restate the thumb's size, so the one calculation
   * that needs it (`t` -> pixels, and back again on a drag) is written once in
   * CSS and measured off the DOM in `beginDrag`, rather than kept as a number
   * in two places that must agree or the thumb sits where the value is not.
   */
  private controlMarkup(row: AnyControl, index: number): string {
    const options = row.options as readonly { value: unknown; label: string }[];
    const current = this.values[row.key];
    const at = options.findIndex((o) => o.value === current);
    if (row.style === "slider") {
      const from = at < 0 ? 0 : at;
      const t = options.length > 1 ? from / (options.length - 1) : 0;
      return (
        `<div class="se-choice slider">` +
        `<div class="se-slider" data-row="${index}" style="--t:${t}">` +
        `<div class="se-track"></div><div class="se-fill"></div>` +
        `<div class="se-thumb"></div>` +
        `</div>` +
        `<span class="se-value">${options[from].label}</span>` +
        `</div>`
      );
    }
    const buttons = options
      .map(
        (o, n) =>
          `<button class="se-opt${o.value === current ? " on" : ""}" ` +
          `data-row="${index}" data-opt="${n}">${o.label}</button>`,
      )
      .join("");
    return `<div class="se-choice">${buttons}</div>`;
  }

  /**
   * The page selector, drawn as the button group every short option list on
   * this screen is drawn as — same class, same highlight, same hover rule, so
   * it needs no second renderer and no second hit-testing path.
   */
  private sectionMarkup(): string {
    const tabs = PAGES.map(
      (p, i) =>
        `<button class="se-opt${i === this.page ? " on" : ""}" ` +
        `data-page="${i}">${p.label}</button>`,
    ).join("");
    return `
      <div class="se-row se-tabs${this.row === SECTION_ROW ? " active" : ""}"
           data-row="${SECTION_ROW}">
        <span class="se-label">Section</span>
        <div class="se-choice">${tabs}</div>
        <span class="se-hint">Which group of settings this list shows</span>
      </div>`;
  }

  /**
   * The panel's head: what the row under the cursor is, and what it does.
   *
   * The page selector is row 0 and is answered here like any other row, which
   * is the same argument that made it a row in the first place — it is a
   * choice over a list, it takes the same keys, and a screen with a second
   * kind of thing on it needs a second explanation of how to use it.
   */
  private sideMarkup(page: Page): string {
    const row = this.controlAt(this.row);
    const label = row ? row.label : "Section";
    const hint = row
      ? this.hintFor(row)
      : "Which group of settings this list shows.";
    const facts = page.facts?.() ?? [];
    return `
      <div class="se-side-head">
        <span class="ui-eyebrow">${page.label}</span>
        <h3>${label}</h3>
      </div>
      <p class="se-side-hint">${hint}</p>
      ${
        facts.length
          ? `<div class="ui-facts">${facts
              .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`)
              .join("")}</div>`
          : ""
      }`;
  }

  /**
   * The key-cap table. Reference and nothing else: no `data-row`, so the cursor
   * steps straight past it — it is not a row, it is what the Controls page is
   * about, which is why it is in the panel beside the list rather than under
   * it. Eleven rows under a list is the longest block on the screen and the
   * thing that decided its height; beside one, it costs the list nothing.
   */
  private bindingsMarkup(bindings: readonly Binding[]): string {
    const rows = bindings
      .map(
        ([action, pad, keys]) => `
        <div class="se-bind">
          <span class="se-bind-act">${action}</span>
          <span class="se-bind-keys">${keys
            .split(" ")
            .map((k) => `<kbd>${k}</kbd>`)
            .join("")}</span>
          <span class="se-bind-pad"><kbd class="pad">${pad}</kbd></span>
        </div>`,
      )
      .join("");
    return `
      <div class="se-binds">
        <div class="se-bind-head">
          <span>Control</span><span>Keyboard &amp; mouse</span><span>Gamepad</span>
        </div>
        ${rows}
      </div>`;
  }

  /**
   * Takes the press on a slider and holds the drag open on the WINDOW.
   *
   * The listeners cannot go on the element and the geometry cannot be re-read
   * per move, both for the same reason: `draw` rebuilds `innerHTML` wholesale,
   * so the element under the finger is destroyed and replaced the first time
   * the value crosses a rung. Anything bound to it — a listener, a pointer
   * capture — goes with it, and the drag dies one rung in. Window listeners
   * outlive the redraw, and the track's box is measured ONCE here: the row's
   * height and the grid's columns do not depend on the value, so the box a
   * press starts in is the box the whole drag happens in.
   */
  private beginDrag(el: HTMLElement, event: PointerEvent): void {
    const box = el.getBoundingClientRect();
    const thumb = el.querySelector<HTMLElement>(".se-thumb");
    this.drag = {
      row: Number(el.dataset.row),
      left: box.left,
      width: box.width,
      // The stylesheet's number, measured rather than restated. A thumb is
      // centred on its value, so half of it is unreachable travel at each end.
      thumb: thumb ? thumb.getBoundingClientRect().width : 0,
    };
    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.endDrag);
    window.addEventListener("pointercancel", this.endDrag);
    // A press is also a row selection, which matters on a touchscreen and on a
    // first click into the panel — there is no hover to have moved it already.
    if (this.row !== this.drag.row) {
      this.row = this.drag.row;
      this.draw();
    }
    // Stops the drag selecting the labels either side of it.
    event.preventDefault();
    this.dragTo(event.clientX);
  }

  /** Where on the ladder a pointer at `clientX` is, and the pick it makes. */
  private dragTo(clientX: number): void {
    const d = this.drag;
    if (!d) return;
    // The page cannot change under a live drag — nothing that switches it is
    // reachable while a slider is held — so the row index still means what it
    // did at the press.
    const row = this.controlAt(d.row);
    if (!row) return;
    const options = row.options as readonly { value: unknown }[];
    const travel = d.width - d.thumb;
    const t = travel > 0 ? (clientX - d.left - d.thumb / 2) / travel : 0;
    // Round, not floor: every rung gets the half-share of track either side of
    // it, so the thumb goes where it was dropped rather than one rung short.
    const at = Math.round(Math.max(0, Math.min(1, t)) * (options.length - 1));
    const option = options[at];
    // Guarded here as well as in `Game.setSetting`, because this fires per
    // pointer event and the round trip through the store is a localStorage
    // write: a drag should cost one write per rung crossed, not one per pixel.
    if (option && option.value !== this.values[row.key]) {
      this.onChange(row.key, option.value as Settings[keyof Settings]);
    }
  }

  private onDragMove = (event: PointerEvent): void => {
    this.dragTo(event.clientX);
  };

  /** Ends a drag from any of the four things that can end one. */
  private endDrag = (): void => {
    if (!this.drag) return;
    this.drag = null;
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.endDrag);
    window.removeEventListener("pointercancel", this.endDrag);
  };

  /**
   * Rebuilds the list rather than patching it — it is redrawn only on a pick,
   * a row move or a page change, and the alternative is three places that have
   * to agree on which row carries the highlight.
   */
  private draw(): void {
    const page = PAGES[this.page];
    const rows = page.rows
      .map((r, n) => {
        const i = n + 1;
        return `
        <div class="se-row${i === this.row ? " active" : ""}" data-row="${i}">
          <span class="se-label">${r.label}</span>
          ${this.controlMarkup(r, i)}
          <span class="se-hint">${this.hintFor(r)}</span>
        </div>`;
      })
      .join("");
    this.body.innerHTML = this.sectionMarkup() + rows;
    // The panel is rebuilt with the list rather than separately: every path
    // that redraws the list has moved the cursor, changed the page or changed
    // a value, and all three are things the panel states.
    this.pageEl.textContent = page.label;
    this.side.innerHTML =
      this.sideMarkup(page) +
      (page.bindings ? this.bindingsMarkup(page.bindings) : "");

    // The tabs carry a page index and the option buttons carry a row and an
    // option index — never a key or a value. A value has to survive a round
    // trip through a dataset string, and `false` and `0.5` do not come back as
    // themselves; the table is the only place that knows what an option means.
    this.body.querySelectorAll<HTMLElement>("button[data-page]").forEach((btn) => {
      btn.onclick = () => this.setPage(Number(btn.dataset.page));
    });
    this.body
      .querySelectorAll<HTMLElement>("button.se-opt[data-opt]")
      .forEach((btn) => {
        btn.onclick = () => {
          const row = this.controlAt(Number(btn.dataset.row));
          const options = row?.options as
            | readonly { value: unknown }[]
            | undefined;
          const opt = options?.[Number(btn.dataset.opt)];
          if (row && opt) {
            this.onChange(row.key, opt.value as Settings[keyof Settings]);
          }
        };
      });
    // Pointerdown, not click: a slider has to answer while the button is still
    // held, and `beginDrag` takes the press as a pick in its own right, so a
    // tap on the track is a click and a hold is a drag through one path.
    this.body.querySelectorAll<HTMLElement>(".se-slider").forEach((el) => {
      el.onpointerdown = (event) => this.beginDrag(el, event);
    });
    // Hovering a row moves the keyboard selection with it, so the highlighted
    // row and the one the arrows are about to step can never disagree — the
    // rule the pause list and the kit screen's slots both follow.
    this.body.querySelectorAll<HTMLElement>(".se-row").forEach((el) => {
      el.onmouseenter = () => {
        const next = Number(el.dataset.row);
        // Never while a slider is held: the redraw that a drag causes lands a
        // fresh row under a pointer that has not moved between rows at all, and
        // taking the selection from it would let a drag started on one slider
        // walk the highlight onto another.
        if (next !== this.row && !this.drag) {
          this.row = next;
          this.draw();
        }
      };
    });
  }
}

/** One step along a list of `n`: clamped for the arrows, wrapped for Enter. */
function step(from: number, delta: number, n: number, wrap: boolean): number {
  if (n <= 0) return 0;
  return wrap
    ? (from + delta + n) % n
    : Math.max(0, Math.min(n - 1, from + delta));
}
