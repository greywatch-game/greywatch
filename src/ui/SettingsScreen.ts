/**
 * SettingsScreen.ts — The settings screen: a title screen for the PAGE of
 * settings the player is on, laid out the way the main menu and the kit screen
 * are.
 * Owns: #settings, its page and row cursor, the slider drag, and the
 * #hud.setting flag that takes every other screen off the glass while it is up.
 * Owns no setting and applies nothing — every change leaves through `onChange`
 * and comes back as a `setValues` from Game, so the screen can never disagree
 * with what is stored.
 * Invariants: the rows are DATA (`PAGES`), never markup — this screen exists to
 * grow, and a hardcoded row is a row the keyboard navigation does not know
 * about. Every row is one CHOICE over a list of options, whatever it is drawn
 * as. Built on a raise and PATCHED after: nothing already on screen is
 * rewritten unless what it says has changed.
 *
 * **IT IS A FRONT END, NOT A FORM.** It read as one: a heading, a strip of four
 * tabs, two sliders floating in the middle of a black page beside a key table,
 * and a hint line naming three devices. Now the PAGE's name is the title, set
 * large with its number hollow behind it; the pages are a strip of tabs the
 * bumpers turn from anywhere, the menu's reel in another guise; the rows are a
 * column of plates under it wearing the menu's sight brackets for a cursor; an
 * INTEL plate on the right says what the cursor's row does and what it comes to
 * on this machine; Back is the system corner; the prompts are drawn on their
 * controls for the device in hand (`prompts.ts`).
 *
 * **It stands over the SCENE now, not over a black veil.** The screens it can
 * be raised over — the menu, the deploy map, the pause card — are DOM, and the
 * one thing behind all three is the world (or, over the menu, the map's
 * photograph). So it takes them off the glass while it is up (`#hud.setting`,
 * the kit screen's `.kitting` rule for the kit screen's reason) and lays a
 * scrim shaped like its own layout over what is left: a render scale, a shadow
 * tier or the paper grain chosen from a pause is SEEN changing behind the plate
 * that chose it.
 *
 * **Two axes and a page, the menu's own grammar.** Up and down walk the rows —
 * the tab strip is row 0, so a pad reaches every page through the list alone —
 * left and right step the row's value, and the bumpers turn the PAGE from
 * wherever the cursor is.
 *
 * Above #loadout's z-index, because it is reachable from the pause lid and has
 * to cover everything the pause card sits over.
 */
import "./settings.css";
import { CONFIG } from "../config";
import { GRASS_QUALITIES, SHADOW_QUALITIES, type Settings } from "../core/settings";
import type { GyroStatus } from "../core/GyroInput";
import { glyph, guessDevice, type InputDevice } from "./prompts";

/**
 * The gyro row's sentence, per sensor state, and the word its plate has room
 * for. Empty where the row's own hint is the whole story (off).
 */
const GYRO_NOTES: Record<GyroStatus, { line: string; word: string }> = {
  off: { line: "", word: "" },
  unsupported: {
    line: "This browser has no motion sensor access (it needs HTTPS).",
    word: "No sensor access",
  },
  permission: { line: "Tap anywhere to allow motion access.", word: "Tap to allow" },
  denied: {
    line: "Motion access was refused; allow it in the browser's settings and reload.",
    word: "Access refused",
  },
  waiting: { line: "Waiting for the gyroscope.", word: "Waiting" },
  absent: { line: "No gyroscope is reporting on this device.", word: "No gyroscope" },
  live: { line: "The gyroscope is live.", word: "Live" },
};

/**
 * One line on the screen: a labelled CHOICE bound to one field of `Settings`.
 *
 * **A toggle is a two-option choice, which is why there is only one control
 * type here rather than two.** Off/On, a three-rung resolution ladder and a
 * five-tier shadow list go through one renderer, one key handler and one
 * hit-testing path — only a longer list.
 *
 * **`style` is where a list stops being a STEPPER and becomes a track, and it
 * is a rendering choice over the SAME options.** A short list is drawn as the
 * console idiom — the chosen value between two chevrons, with a pip per
 * option under it saying where on the list it is. Sixteen pips under a word
 * are a ruler nobody reads, so a row whose options run past a handful asks for
 * `slider`: a track the whole list is laid along, a thumb at the current rung
 * and the value beside it.
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
  /** How the options are drawn. Absent is the stepper. */
  style?: "slider";
}

type AnyControl = { [K in keyof Settings]: ControlRow<K> }[keyof Settings];

/**
 * One binding, as the reference table draws it: what it does, the pad's
 * button, and the keyboard's keys (space-separated, one cap each). Reference
 * material and nothing else — this screen shows the bindings, it does not own
 * them, and nothing here is editable yet.
 */
type Binding = readonly [action: string, pad: string, keys: string];

/**
 * The player's controls. They were on the MENU and on the pause card, drawn
 * from one table by one loop — which is where they had to be while the settings
 * screen was two toggles nobody could reach with a pad. Now that it is a screen
 * a cursor lands on from both places, a reference table belongs in it rather
 * than under the title of the screen you start a round from.
 */
const BINDINGS: readonly Binding[] = [
  ["Move", "Left stick", "W A S D"],
  ["Look", "Right stick", "Mouse"],
  ["Aim", "LT", "RMB"],
  ["Fire", "RT", "LMB"],
  ["Jump", "A", "Space"],
  ["Reload", "X", "R"],
  // X twice, and the table can say it plainly for the reason the Y row can:
  // the two never come up at once. A seat in reach is what makes X this verb
  // and the absence of one is what makes it the reload, and the HUD names the
  // button the moment the first is true — so the pair of rows reads as "X, and
  // the prompt will tell you which". Only ever true on a map with vehicles;
  // the row stays, because a reference table that changed per map would be one
  // a player could not learn from.
  ["Enter / exit", "X", "E"],
  // Three keys, because they are two different asks: the wheel swaps to the
  // other weapon and the numbers name one outright. Y is the kit screen's
  // button in a menu and this one in a round; the two states never overlap, so
  // the table can name it here without qualification.
  ["Weapon", "Y", "Wheel 1 2"],
  ["Grenade", "RB", "G"],
  // Both halves are Battlefield 6's own defaults. The d-pad's south is the
  // one direction with nothing on it in a round — the north is the vehicle
  // verb — and it steps a menu everywhere else, which is the same double duty
  // the north already does.
  ["Fire mode", "D-pad ↓", "B"],
  ["Sprint", "L3", "Shift"],
  // Two keys because they behave differently — Ctrl is held, C latches, and
  // on the pad B latches too. The table's grammar is one cap per key and it
  // has nowhere to say which is which; the pair reads as "either", which is
  // true, and one press of each tells the rest.
  ["Crouch", "B", "Ctrl C"],
  ["Pause", "Start", "Esc"],
];

/**
 * A page of the screen, and the unit this list GROUPS by.
 *
 * It replaced a `heading` row, and for a reason that is about height rather
 * than about tidiness: a list that grows past its column does not get a
 * scrollbar anyone looks for, it gets a row nobody sees. A heading buys an inch
 * of separation and spends the same height as a row; a page buys the whole
 * rest of the list back. The rule is the mechanical one — a page that outgrows
 * the column on a landscape phone splits into another page, exactly as a
 * section would have split into another heading.
 */
interface Page {
  label: string;
  /** Line icon on the page's tab, in the kit screen's drawing. */
  icon: string;
  /** What the page is FOR, said once — the intel on the tab strip. */
  blurb: string;
  rows: readonly AnyControl[];
  /**
   * The reference table under the page's rows, on the page that carries one.
   * Not a choice: the cursor steps straight past it.
   */
  bindings?: readonly Binding[];
  /**
   * What the page says about the MACHINE, as the title's figure strip.
   *
   * A function rather than a table of strings because every one of these is
   * measured at the moment it is drawn — the window's size, the pixel ratio —
   * and a settings screen that reports the size the window was when the bundle
   * loaded is worse than one that reports nothing.
   */
  facts?: () => readonly [string, string][];
}

/** Off/On, the shape five of the rows share. */
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
 * Line icons in the menu's own drawing: a 24-unit box, a square-capped
 * stroke, no fill. Each tab leads with one, and on a phone held upright —
 * where the tabs are too narrow for a name — the icon is what is left.
 */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${d}</svg>`;
const ICONS = {
  input: svg(
    `<path d="M6.5 7.5h11a4 4 0 0 1 4 4.2l-.6 5.2a2.2 2.2 0 0 1-3.9 1.2L15 15.5H9l-2 2.6a2.2 2.2 0 0 1-3.9-1.2l-.6-5.2a4 4 0 0 1 4-4.2z"/><path d="M7.5 10v3.4M5.8 11.7h3.4M15.5 11h.1M17.5 13h.1"/>`,
  ),
  touch: svg(`<path d="M7 2.8h10v18.4H7z"/><path d="M10.5 18h3"/>`),
  display: svg(`<path d="M3 4.5h18v12H3z"/><path d="M8.5 20.5h7M12 16.5v4"/>`),
  detail: svg(`<circle cx="16" cy="7.5" r="3"/><path d="M2.5 20.5l6.5-9 5 6.2 2.8-3.2 4.7 6z"/>`),
  back: svg(`<path d="M15 5l-7 7 7 7"/>`),
};

/**
 * The pages, in tab order. Input first, and that is about where the cursor
 * and the pointer both arrive: `show()` opens on the first page, the pause
 * list's Settings item is the one place a player mid-round goes looking for a
 * key they have forgotten, and look speed is the setting anyone goes hunting
 * for on the first evening — a resolution is something you change once when the
 * frame rate tells you to.
 */
const PAGES: readonly Page[] = [
  {
    label: "Input",
    icon: ICONS.input,
    blurb:
      "How far the view turns for a mouse and a stick, and every control on both. The table under the list is drawn for whichever device is in your hands.",
    rows: [
      {
        key: "mouseSensitivity",
        label: "Mouse look",
        hint: "How far the view turns for a sweep of the mouse. The ladder is geometric, so every step is the same share faster or slower.",
        options: LOOK_SCALES,
        style: "slider",
      },
      {
        key: "stickSensitivity",
        label: "Stick look",
        hint: "How fast the right stick turns the view with the stick held over. Everything short of full deflection is the stick curve's business.",
        options: LOOK_SCALES,
        style: "slider",
      },
    ],
    bindings: BINDINGS,
  },
  // A page of its own, by this table's own rule: the five rows a phone player
  // wants would have put the Input page's table under the edge of a landscape
  // phone. It is also the page a phone player is looking for, and the key
  // table is nothing to them. Every hint says what the choice DOES, because
  // "Fixed", "Aim on fire" and "While aiming" are names borrowed from other
  // games.
  {
    label: "Touch",
    icon: ICONS.touch,
    blurb:
      "The controls a phone or a tablet plays with: how a drag turns the view, where the stick sits, and whether turning the device aims.",
    rows: [
      {
        key: "touchSensitivity",
        label: "Touch look",
        hint: "How far a drag across the glass turns the view.",
        options: LOOK_SCALES,
        style: "slider",
      },
      {
        key: "touchStick",
        label: "Touch stick",
        hint: "Floating: the stick appears wherever your thumb lands. Fixed: it stays in the corner and moves you from its centre.",
        options: [
          { value: "floating", label: "Floating" },
          { value: "fixed", label: "Fixed" },
        ],
      },
      {
        key: "touchAutoAds",
        label: "Aim on fire",
        hint: "Holding FIRE raises the sight first, and the first round waits for it. On foot only.",
        options: OFF_ON,
      },
      {
        key: "touchGyro",
        label: "Gyro aim",
        hint: "Turning the phone turns the view. Aiming: only while a sight is up.",
        options: [
          { value: "off", label: "Off" },
          { value: "aiming", label: "Aiming" },
          { value: "always", label: "Always" },
        ],
      },
      {
        key: "gyroSensitivity",
        label: "Gyro speed",
        hint: "How far a turn of the phone turns the view.",
        options: LOOK_SCALES,
        style: "slider",
      },
    ],
  },
  {
    label: "Display",
    icon: ICONS.display,
    blurb:
      "How many pixels the world is drawn with, and what is laid over it. The figures under the title are this window's, measured as you look at them.",
    rows: [
      {
        key: "renderScale",
        label: "Render scale",
        hint: "The share of the display's own pixels the scene is drawn at. The interface is always drawn at full resolution.",
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
        hint: "Frame rate, frame time and the 1% low, in the top corner.",
        options: OFF_ON,
      },
      {
        key: "motionBlur",
        label: "Motion blur",
        hint: "Smears the view on a fast turn.",
        options: OFF_ON,
      },
      {
        key: "paperGrain",
        label: "Paper grain",
        hint: "The paper the world is drawn on, the vignette, and the red flash when you are hit.",
        options: OFF_ON,
      },
      {
        key: "profiler",
        label: "Profiler",
        // What it actually does, in the width a hint has: it records
        // CONTINUOUSLY and the capture reaches backwards, which is the one
        // thing a player has to know to use it — press the button AFTER the
        // hitch, not before.
        hint: "Records the last few thousand frames all the time, so press after a hitch: KEEP copies a capture and SAVE writes the full one. F3 on a keyboard.",
        options: OFF_ON,
      },
    ],
    // What the ladder above actually comes to on this machine. The scene's
    // backing store is the display's pixels times the ratio times the scale,
    // and Babylon floors it — the same arithmetic `figureFor` does for the row.
    facts: () => {
      const dpr = window.devicePixelRatio || 1;
      return [
        [`${window.innerWidth}&times;${window.innerHeight}`, "Window"],
        [dpr.toFixed(2).replace(/\.?0+$/, "") + "&times;", "Pixel ratio"],
        [
          `${Math.floor(window.innerWidth * dpr)}&times;${Math.floor(window.innerHeight * dpr)}`,
          "Native",
        ],
      ];
    },
  },
  {
    // Split off Display when the shadows row made it nine, which ran under the
    // footer at a phone's 832x384 — this list's own rule for a page that
    // outgrows its column. The four are the ones a slow device turns down,
    // which is why grass is here beside the light rather than on a page of its
    // own.
    label: "Detail",
    icon: ICONS.detail,
    blurb:
      "The four things a slow device turns down first. Each is drawn behind this screen as you change it, so what you are trading is in front of you.",
    rows: [
      {
        key: "volumetrics",
        label: "Light shafts",
        hint: "Moonlight scattered by the air, marched through the shadows.",
        // Straight off the config's ladder with `off` in front, so the screen
        // cannot offer a rung the store would refuse to remember. `off` is a
        // real option and not a zeroed rung — it detaches the pass.
        options: [
          { value: "off", label: "Off" } as const,
          ...(
            Object.keys(CONFIG.graphics.volumetrics.rungs) as (keyof typeof CONFIG.graphics.volumetrics.rungs)[]
          ).map((k) => ({
            value: k,
            label: k.charAt(0).toUpperCase() + k.slice(1),
          })),
        ],
      },
      {
        key: "gi",
        label: "Bounce light",
        hint: "Light off walls and ground, sky shade in alleys, and lamps that stop at walls.",
        // Off the config's tier table with `off` in front, for the shafts'
        // reason. `off` is the flat ambient the cel shader always had.
        options: [
          { value: "off", label: "Off" } as const,
          ...(Object.keys(CONFIG.gi.tiers) as (keyof typeof CONFIG.gi.tiers)[]).map(
            (k) => ({
              value: k,
              label: k.charAt(0).toUpperCase() + k.slice(1),
            }),
          ),
        ],
      },
      {
        key: "shadows",
        label: "Shadows",
        hint: "The moon's shadows, the bodies' shadows, and the lamps that cast them.",
        // Off the config's tier table, which already names `off` as a rung —
        // what off means is stated per map there rather than here.
        options: SHADOW_QUALITIES.map((k) => ({
          value: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
        })),
      },
      {
        key: "grass",
        label: "Grass",
        hint: "How thick the grass grows around you and how far it reaches.",
        options: GRASS_QUALITIES.map((k) => ({
          value: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
        })),
      },
    ],
  },
];

/**
 * Row 0 is the page's TAB STRIP on every page, and the settings rows run from
 * 1.
 *
 * That offset is what keeps the pages reachable through the list alone. The
 * bumpers turn the page from anywhere, and they are drawn on the strip's two
 * ends for the device in hand — but a bumper is an ACCELERATOR (the menu's
 * rule: none is the only way in), and a pad player who never thinks to press
 * one still walks up onto the strip and steps it with left and right, exactly
 * as every other row here is stepped. It is not in `Settings` and not in a
 * page's rows because what it changes is on this screen rather than in the
 * store.
 */
const SECTION_ROW = 0;

/** A 1-based index as two digits: the title's numeral and its counter. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** The options of a row, typed loosely enough to walk. */
const optionsOf = (row: AnyControl) =>
  row.options as readonly { value: unknown; label: string }[];

/** What `draw` last put on screen, so it can patch rather than rewrite. */
interface Shown {
  page: number;
  row: number;
  /** One key per row's value, so a pick patches only the row it moved. */
  values: string;
}

export class SettingsScreen {
  private root: HTMLElement;
  private heroEl: HTMLElement;
  private tabsRow: HTMLElement;
  private tabs: HTMLElement[] = [];
  private prevEl: HTMLElement;
  private nextEl: HTMLElement;
  /** The page's rows and, on the page that has one, its reference table. */
  private listEl: HTMLElement;
  /** The cursor row's sentence, where the intel plate has no room. */
  private sayEl: HTMLElement;
  private intelEl: HTMLElement;
  private values: Settings;
  /** What the gyro is doing. See `setGyroStatus`. */
  private gyroStatus: GyroStatus = "off";
  /** Which device's prompts the screen draws — see `setInputDevice`. */
  private device: InputDevice = guessDevice();
  /** Which page is shown. Indexes `PAGES`. */
  private page = 0;
  /** Where the cursor is: 0 is the tab strip, 1.. are the page's rows. */
  private row = SECTION_ROW;
  private shown: Shown | null = null;
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
    this.root.className = `hidden dev-${this.device}`;
    // Every block is a named grid AREA, which is what lets a phone's layout be
    // a change of template in the stylesheet rather than a second copy of this
    // markup — the menu's rule, and the kit screen's.
    const tabs = PAGES.map(
      (p, i) =>
        `<button class="se-tab" data-page="${i}">${p.icon}<b>${p.label}</b></button>`,
    ).join("");
    this.root.innerHTML = `
      <div class="se-top">
        <div class="se-brand">
          <span class="se-kicker">Greywatch</span>
          <span class="se-word">Settings</span>
        </div>
        <button class="se-back">${ICONS.back}<b>Back</b>${glyph("Esc", "B")}</button>
      </div>
      <div class="se-hero"></div>
      <div class="se-tabsrow" data-row="${SECTION_ROW}">
        <button class="se-nav prev" data-step="-1" aria-label="Previous page">${glyph("Q", "LB")}</button>
        <div class="se-tabs">${tabs}</div>
        <button class="se-nav next" data-step="1" aria-label="Next page">${glyph("E", "RB")}</button>
      </div>
      <div class="se-list"></div>
      <p class="se-say"></p>
      <aside class="se-intel"></aside>
      <div class="se-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Move</span>
        <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Change</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Navigate</span>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.heroEl = q(".se-hero");
    this.tabsRow = q(".se-tabsrow");
    this.tabs = Array.from(this.root.querySelectorAll<HTMLElement>(".se-tab"));
    this.prevEl = q(".se-nav.prev");
    this.nextEl = q(".se-nav.next");
    this.listEl = q(".se-list");
    this.sayEl = q(".se-say");
    this.intelEl = q(".se-intel");
    // The pointer's way off this screen, in the system corner where the menu
    // keeps its own and the kit screen its Back. `click` is safe on a button
    // INSIDE a screen that is already up: the pointerdown rule the menu's
    // buttons follow is about buttons that race a confirm on the way in.
    q(".se-back").onclick = () => this.onClose();
    this.tabs.forEach((t) => {
      t.onclick = () => this.setPage(Number(t.dataset.page), true);
    });
    for (const nav of [this.prevEl, this.nextEl]) {
      nav.onclick = () => this.stepPage(Number(nav.dataset.step));
    }
    // Hovering the strip puts the cursor on it, as hovering a row does — see
    // `bindRows` for why that is right on this screen and not on the kit's.
    this.tabsRow.onmouseenter = () => this.hoverRow(SECTION_ROW);
    // The Display page's title figures are this WINDOW's, so a resize while
    // the screen is up owes them a rewrite rather than a stale number.
    window.addEventListener("resize", () => {
      if (this.visible) this.writeFacts();
    });
  }

  /**
   * The stored settings, pushed by Game. This is the only way the screen
   * learns a value changed — including changes it asked for itself, which is
   * what keeps a rejected or clamped setting from showing as applied.
   */
  setValues(values: Settings): void {
    this.values = { ...values };
    if (this.visible) this.draw();
  }

  /**
   * What the motion sensor is actually doing, pushed by `Game`. Drawn on the
   * gyro row, because "On" over a sensor that is not there, or that iOS is
   * still waiting to be allowed, is a setting that looks broken with nothing
   * on screen to say why.
   */
  setGyroStatus(status: GyroStatus): void {
    if (status === this.gyroStatus) return;
    this.gyroStatus = status;
    if (this.visible) this.draw(true);
  }

  /**
   * Which device's prompts to draw. A class on the root, compared before it
   * is written, so `Game` can push it every frame; every prompt on the screen
   * — and the reference table, which names that device's controls and no
   * other's — turns over on that one write.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    for (const d of ["kbm", "pad", "touch"] as const) {
      this.root.classList.toggle(`dev-${d}`, d === device);
    }
  }

  show(): void {
    // Always open on the first page and its tab strip, for the reason the kit
    // screen documents: a screen that remembers a cursor from three sessions
    // ago is one you have to read before you can use it. The page is part of
    // that — a screen that opens on Display because that is where you were last
    // week hides the controls table from the player who came looking for it.
    this.page = 0;
    this.row = SECTION_ROW;
    this.root.classList.remove("hidden");
    // The ENTRANCE, replayed on every raise and never on a patch — the menu's
    // `.enter`. Taking the class off and reading a layout property is what
    // restarts animations that already ran on the last open.
    this.root.classList.remove("enter");
    void this.root.offsetWidth;
    this.root.classList.add("enter");
    // The screens this one covers are DOM, and what it is laid over is the
    // scene; the CSS carries the rule, this is the flag it reads.
    document.getElementById("hud")!.classList.add("setting");
    // A raise is drawn from nothing, so the title arrives with the entrance
    // rather than wiping in as though the page had just been turned.
    this.shown = null;
    this.draw();
  }

  hide(): void {
    // A drag held on the window would otherwise outlive the screen: the pointer
    // that opened a pause and came back up over the round would still be moving
    // a slider nobody can see. Escape closes this screen with a button down as
    // easily as with one up.
    this.endDrag();
    this.root.classList.add("hidden");
    this.root.classList.remove("enter");
    document.getElementById("hud")!.classList.remove("setting");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** The rows of whichever page is up — what the cursor steps through. */
  private get rows(): readonly AnyControl[] {
    return PAGES[this.page].rows;
  }

  /** The control at a cursor position, or undefined on the tab strip. */
  private controlAt(row: number): AnyControl | undefined {
    return this.rows[row - 1];
  }

  /** Steps the highlighted row, wrapping at both ends — the screen's up/down. */
  moveRow(delta: number): void {
    // The tab strip is one of them, which is what puts every page in reach of
    // a pad without a button of its own.
    const n = this.rows.length + 1;
    this.row = (this.row + delta + n) % n;
    this.draw();
  }

  /**
   * Turns the PAGE wherever the cursor is — the bumpers, this screen's page as
   * the map is the menu's and the weapon the kit's. Clamped, as left and right
   * on the strip are, because it is the same choice reached by another key and
   * the two must not disagree about what happens at the end of it.
   */
  stepPage(delta: number): void {
    this.setPage(step(this.page, delta, PAGES.length, false), this.row === SECTION_ROW);
  }

  /**
   * Steps the highlighted row's value — or, on row 0, the page.
   *
   * **Left/right clamp; Enter wraps.** They used to be the same move because a
   * boolean has only one other value to reach, and with a ladder on the screen
   * they stop being: left on the lowest rung has to stay put, or a player
   * stepping down a resolution list lands back at the top and reads it as the
   * setting having refused. Enter is the opposite case — it is one key being
   * asked to reach every value, so it has to come round. The tab strip follows
   * the same rule for the same reason.
   */
  stepRow(delta: number, wrap: boolean): void {
    if (this.row === SECTION_ROW) {
      this.setPage(step(this.page, delta, PAGES.length, wrap), true);
      return;
    }
    this.stepControl(this.row, delta, wrap);
  }

  private stepControl(index: number, delta: number, wrap: boolean): void {
    const row = this.controlAt(index);
    if (!row) return;
    const options = optionsOf(row);
    const from = this.indexOf(row);
    const next = step(from, delta, options.length, wrap);
    if (next === from) return;
    this.onChange(row.key, options[next].value as Settings[keyof Settings]);
  }

  /** The chosen option's index in a row's list; 0 for a value it does not hold. */
  private indexOf(row: AnyControl): number {
    const at = optionsOf(row).findIndex((o) => o.value === this.values[row.key]);
    return at < 0 ? 0 : at;
  }

  /**
   * Shows a page. From the strip the cursor stays on the strip; from a row it
   * goes to the TOP of the new page's list rather than being carried across:
   * row 3 of Display is not row 3 of anything else, and the first row is the
   * one a player turning pages with the bumpers is looking at next.
   */
  private setPage(next: number, onStrip: boolean): void {
    if (next === this.page) return;
    this.page = next;
    this.row = onStrip ? SECTION_ROW : 1;
    this.draw();
  }

  /**
   * What a row's chosen value WORKS OUT TO, where the table cannot say it.
   *
   * "75%" on its own says nothing a player can act on — what they want to know
   * is the number of pixels it lands on, and that depends on their window and
   * their panel, so it cannot be written into the table. A bare "1.25x" is the
   * same problem one step worse, since it is a multiplier over a number the
   * screen never shows: what a player is comparing against the shooter they
   * came from is a turn per unit of hand movement, so that is what it resolves
   * to. `v` and `c` are the intel's figure and caption; `line` is the phrase
   * the row's own plate carries, which is what survives a viewport with no
   * room for the intel.
   */
  private figureFor(row: AnyControl): { v: string; c: string; line: string } | null {
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
    const c = CONFIG.camera;
    switch (row.key) {
      case "renderScale": {
        // Rounded down the same way Babylon rounds the backing store, so the
        // two agree.
        const dpr = window.devicePixelRatio || 1;
        const scale = this.values.renderScale;
        const size = `${Math.floor(window.innerWidth * dpr * scale)}&times;${Math.floor(
          window.innerHeight * dpr * scale,
        )}`;
        return { v: size, c: "Drawn at", line: `Drawn at ${size}` };
      }
      // Per 1000 px rather than per pixel: the rate itself is a fraction of a
      // degree, and the number a player recognises is the sweep.
      case "mouseSensitivity": {
        const v = `${deg(c.sensX * 1000 * this.values.mouseSensitivity)}&deg;`;
        return { v, c: "Per 1000 px", line: `${v} per 1000 px` };
      }
      // At full deflection, which is the only deflection a rate can be quoted
      // at — everything short of it is the stick curve's business.
      case "stickSensitivity": {
        const v = `${deg(c.stickSensX * this.values.stickSensitivity)}&deg;/s`;
        return { v, c: "At full stick", line: `${v} at full stick` };
      }
      // A quarter turn of the phone, because that is the gesture: nobody turns
      // a phone a whole circle, and 90 in is a number a wrist can picture.
      case "gyroSensitivity": {
        const v = `${Math.round(90 * CONFIG.touch.gyro.gain * this.values.gyroSensitivity)}&deg;`;
        return { v, c: "Per 90&deg; turn", line: `${v} per 90&deg; turn` };
      }
      // What the SENSOR is doing, not what the setting says. See `setGyroStatus`.
      case "touchGyro": {
        const note = GYRO_NOTES[this.gyroStatus];
        return note.word ? { v: note.word, c: "Sensor", line: `Sensor: ${note.word}` } : null;
      }
      default:
        return null;
    }
  }

  /** The row's sentence, with what the sensor is doing on the end of the gyro's. */
  private hintFor(row: AnyControl): string {
    if (row.key !== "touchGyro") return row.hint;
    const note = GYRO_NOTES[this.gyroStatus].line;
    return note ? `${row.hint} ${note}` : row.hint;
  }

  /**
   * One row: a plate carrying the setting's name, what it comes to on this
   * machine, and its control — the stepper or the track.
   *
   * The plate sits in a WRAPPER that is not clipped, because the cursor is a
   * pair of sight brackets on the wrapper's corners (the menu's mark) and the
   * plate is cut by a `clip-path` that would take them off with its corner.
   *
   * The slider carries its position as `--t`, a 0..1 fraction of the OPTION
   * INDEX, and the stylesheet turns that into a thumb offset. That split is the
   * point: this file may not restate the thumb's size, so the one calculation
   * that needs it (`t` -> pixels, and back again on a drag) is written once in
   * CSS and measured off the DOM in `beginDrag`, rather than kept as a number
   * in two places that must agree or the thumb sits where the value is not.
   */
  private rowMarkup(row: AnyControl, index: number): string {
    const options = optionsOf(row);
    let ctl: string;
    if (row.style === "slider") {
      ctl = `
        <div class="se-slide">
          <div class="se-slider" data-row="${index}">
            <div class="se-track"></div><div class="se-fill"></div><div class="se-thumb"></div>
          </div>
          <b class="se-value"></b>
        </div>`;
    } else {
      ctl = `
        <div class="se-step">
          <button class="se-arr prev" data-d="-1" aria-label="Previous ${row.label}"></button>
          <button class="se-val" aria-label="${row.label}">
            <b></b><i>${"<s></s>".repeat(options.length)}</i>
          </button>
          <button class="se-arr next" data-d="1" aria-label="Next ${row.label}"></button>
        </div>`;
    }
    return `
      <div class="se-rowwrap" data-row="${index}" style="--i:${index}">
        <div class="se-row">
          <span class="se-label">${row.label}</span>
          <i class="se-note"></i>
          ${ctl}
        </div>
      </div>`;
  }

  /**
   * The reference table: every control, for the device in hand and no other.
   *
   * Both halves are in the markup and the root's `dev-*` class picks one, as
   * every prompt on this screen does — so a pad player reads their own buttons
   * drawn as the buttons (the green A, the bumper tab) rather than a column of
   * pad names beside a column of keys they are not holding. Under a finger
   * there is nothing to name: the controls are drawn on the glass and name
   * themselves, and the table says so instead.
   *
   * It carries no `data-row`, so the cursor steps straight past it — it is
   * not a choice, it is what the Input page is ABOUT.
   */
  private bindingsMarkup(bindings: readonly Binding[]): string {
    const rows = bindings
      .map(
        ([action, pad, keys]) => `
        <div class="se-bind">
          <span>${action}</span>
          <span class="se-caps">${keys
            .split(" ")
            .map((k) => glyph(k, null))
            .join("")}${glyph(null, pad)}</span>
        </div>`,
      )
      .join("");
    return `
      <div class="se-ref">
        <div class="se-ref-cap">
          <span>Controls</span>
          <b data-dev="kbm">Keyboard &amp; mouse</b>
          <b data-dev="pad">Gamepad</b>
        </div>
        <div class="se-binds">${rows}</div>
        <p class="se-ref-touch">On glass the controls are drawn on the screen, and each one names itself.</p>
      </div>`;
  }

  /**
   * Brings the screen up to date by PATCHING it. Each block is touched only
   * when what it says has changed, and that is not tidiness: the title's
   * wipe, the rows' deal and the thumb's slide are animations on elements
   * that have to survive the redraw to run at all — and a slider rebuilt
   * under a held pointer is a drag that dies one rung in.
   */
  private draw(force = false): void {
    const was = this.shown;
    const values = this.rows.map((r) => String(this.values[r.key])).join("|");
    const pageMoved = !was || was.page !== this.page;
    if (pageMoved) {
      this.writeHero(was !== null);
      this.buildList(was !== null);
    }
    if (pageMoved || force || was.values !== values) this.patchValues();
    if (pageMoved || force || was.row !== this.row || was.values !== values) {
      this.patchCursor();
      this.writeIntel();
    }
    this.shown = { page: this.page, row: this.row, values };
  }

  /**
   * The title: the page's number hollow and enormous behind, an eyebrow
   * counting the pages, the page's NAME, and a strip of figures under it.
   * Rewritten only when the page turns, because replacing it is how `.swap`
   * replays the wipe.
   */
  private writeHero(swap: boolean): void {
    const p = PAGES[this.page];
    this.heroEl.innerHTML = `
      <div class="se-hero-in${swap ? " swap" : ""}">
        <span class="se-index" aria-hidden="true">${twoDigits(this.page + 1)}</span>
        <span class="se-mode">Page ${twoDigits(this.page + 1)} / ${twoDigits(PAGES.length)}</span>
        <h2 class="se-title">${p.label}</h2>
        <div class="se-facts"></div>
      </div>`;
    this.writeFacts();
    this.tabs.forEach((t, i) => t.classList.toggle("on", i === this.page));
    // The ends of the strip say when they have run out of pages, since the
    // bumpers clamp — an arrow that looks live and does nothing is worse than
    // one that says it has run out of row.
    this.prevEl.classList.toggle("off", this.page <= 0);
    this.nextEl.classList.toggle("off", this.page >= PAGES.length - 1);
  }

  /**
   * The title's figure strip: what the page measures about this machine, or
   * the one thing every page is true of. Always one line, so turning a page
   * never moves the list under the title.
   */
  private writeFacts(): void {
    const el = this.heroEl.querySelector<HTMLElement>(".se-facts");
    if (!el) return;
    const facts = PAGES[this.page].facts?.() ?? [];
    el.innerHTML = facts.length
      ? facts.map(([v, l]) => `<span><b>${v}</b><i>${l}</i></span>`).join("")
      : `<span class="se-applied"><i>Every change is applied as you make it</i></span>`;
  }

  /**
   * The page's rows from nothing — on a page turn, where they are different
   * rows and there is nothing to patch. `deal` is the entrance they make,
   * staggered by index; it is left off the first draw of a raise, where the
   * whole screen is already arriving.
   */
  private buildList(deal: boolean): void {
    const p = PAGES[this.page];
    this.listEl.className = `se-list${deal ? " deal" : ""}`;
    this.listEl.innerHTML =
      p.rows.map((r, n) => this.rowMarkup(r, n + 1)).join("") +
      (p.bindings ? this.bindingsMarkup(p.bindings) : "");
    this.listEl.scrollTop = 0;
    this.bindRows();
  }

  /**
   * Hangs the pointer on a freshly built list. Once per BUILD, because a patch
   * keeps every element and therefore every handler.
   *
   * The row indices are carried and never a key or a value: a value has to
   * survive a round trip through a dataset string, and `false` and `0.5` do not
   * come back as themselves; the table is the only place that knows what an
   * option means.
   */
  private bindRows(): void {
    this.listEl.querySelectorAll<HTMLElement>(".se-rowwrap").forEach((wrap) => {
      const index = Number(wrap.dataset.row);
      wrap.querySelectorAll<HTMLElement>("button.se-arr").forEach((btn) => {
        btn.onclick = () => {
          this.takeCursor(index);
          this.stepControl(index, Number(btn.dataset.d), false);
        };
      });
      // The value itself is Enter under a pointer: one step on, and round.
      const val = wrap.querySelector<HTMLElement>("button.se-val");
      if (val) {
        val.onclick = () => {
          this.takeCursor(index);
          this.stepControl(index, 1, true);
        };
      }
      // Pointerdown, not click: a slider has to answer while the button is
      // still held, and `beginDrag` takes the press as a pick in its own right,
      // so a tap on the track is a click and a hold is a drag through one path.
      const slider = wrap.querySelector<HTMLElement>(".se-slider");
      if (slider) slider.onpointerdown = (event) => this.beginDrag(slider, event);
      // Hovering a row moves the cursor with it, so the highlighted row and
      // the one the arrows are about to step can never disagree — the rule the
      // menu and the pause list follow. The kit screen CLICKS its slots open
      // instead because its rail is somewhere else and the mouse crosses other
      // slots to reach it; here every row carries its own control, so the
      // row under the pointer is always the one it is about to use.
      wrap.onmouseenter = () => this.hoverRow(index);
    });
  }

  /** Hover moves the cursor — never while a slider is held. */
  private hoverRow(index: number): void {
    // The drag lives on the window, so the pointer can wander over another
    // row mid-drag; taking the selection from it would walk the highlight onto
    // a row the drag is not changing.
    if (this.drag || index === this.row) return;
    this.row = index;
    this.draw();
  }

  /** A press on a row's control is also a selection — there is no hover on glass. */
  private takeCursor(index: number): void {
    if (index === this.row) return;
    this.row = index;
    this.draw();
  }

  /** Writes every row's value, note, pips, thumb and arrows from `values`. */
  private patchValues(): void {
    this.listEl.querySelectorAll<HTMLElement>(".se-rowwrap").forEach((wrap) => {
      const row = this.controlAt(Number(wrap.dataset.row));
      if (!row) return;
      const options = optionsOf(row);
      const at = this.indexOf(row);
      const fig = this.figureFor(row);
      const note = wrap.querySelector<HTMLElement>(".se-note")!;
      const line = fig ? fig.line : "";
      if (note.innerHTML !== line) note.innerHTML = line;
      wrap.classList.toggle("noted", !!fig);
      if (row.style === "slider") {
        const t = options.length > 1 ? at / (options.length - 1) : 0;
        wrap.querySelector<HTMLElement>(".se-slider")!.style.setProperty("--t", String(t));
        wrap.querySelector<HTMLElement>(".se-value")!.innerHTML = options[at].label;
        return;
      }
      wrap.querySelector<HTMLElement>(".se-val > b")!.innerHTML = options[at].label;
      wrap.querySelectorAll("s").forEach((s, k) => s.classList.toggle("lit", k === at));
      // Left and right CLAMP, so an arrow at the end of its list is drawn
      // spent — the reel's arrows, for the reel's reason.
      wrap.querySelector(".se-arr.prev")!.classList.toggle("off", at <= 0);
      wrap.querySelector(".se-arr.next")!.classList.toggle("off", at >= options.length - 1);
    });
  }

  /** Puts the cursor's brackets on its row and keeps that row on the glass. */
  private patchCursor(): void {
    this.tabsRow.classList.toggle("sel", this.row === SECTION_ROW);
    let lit: HTMLElement | null = null;
    this.listEl.querySelectorAll<HTMLElement>(".se-rowwrap").forEach((wrap) => {
      const on = Number(wrap.dataset.row) === this.row;
      wrap.classList.toggle("sel", on);
      if (on) lit = wrap;
    });
    // The list scrolls only where a viewport has no other way to hold it (a
    // pad on a landscape phone, with the reference table under the rows), and
    // a cursor that walked off its bottom edge would be a row nobody can see.
    (lit as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
    if (this.row === SECTION_ROW) this.listEl.scrollTop = 0;
  }

  /**
   * The intel plate — what the cursor's row IS, described — and the one-line
   * version of it that stands in where a viewport has no room for the plate.
   *
   * On the strip it is the PAGE: what the page is for and every row on it with
   * its value, so a player turning pages reads what each holds without walking
   * down into it. On a row it is the row: its value large, what that comes to
   * on this machine, the whole list of options with the chosen one lit (the
   * stepper shows one at a time), and the sentence. It carries no listener and
   * no hover state, so a rewrite on every cursor move costs one box.
   */
  private writeIntel(): void {
    const p = PAGES[this.page];
    const row = this.controlAt(this.row);
    let head: string;
    let body: string;
    let say: string;
    if (!row) {
      head = `<span class="se-eyebrow-s">Page ${twoDigits(this.page + 1)} &middot; ${p.rows.length} settings</span><h3>${p.label}</h3>`;
      const list = p.rows
        .map(
          (r) =>
            `<div class="se-sum"><span>${r.label}</span><b>${optionsOf(r)[this.indexOf(r)].label}</b></div>`,
        )
        .join("");
      body = `<p class="se-blurb">${p.blurb}</p><div class="se-sums">${list}</div>`;
      say = p.blurb;
    } else {
      const options = optionsOf(row);
      const at = this.indexOf(row);
      const fig = this.figureFor(row);
      head = `<span class="se-eyebrow-s">${p.label}</span><h3>${row.label}</h3>`;
      const facts =
        `<span><b>${options[at].label}</b><i>Set to</i></span>` +
        (fig ? `<span><b>${fig.v}</b><i>${fig.c}</i></span>` : "");
      // A ladder of sixteen is the track's job and not a table's: the ends
      // are what is worth saying about it.
      const ladder =
        row.style === "slider"
          ? `<div class="se-range"><span>${options[0].label}</span><u><s style="width:${(
              (at / Math.max(1, options.length - 1)) *
              100
            ).toFixed(1)}%"></s></u><span>${options[options.length - 1].label}</span></div>`
          : `<div class="se-ladder">${options
              .map((o, k) => `<span${k === at ? ` class="on"` : ""}>${o.label}</span>`)
              .join("")}</div>`;
      const hint = this.hintFor(row);
      body = `<div class="se-ifacts">${facts}</div>${ladder}<p class="se-blurb">${hint}</p>`;
      say = hint;
    }
    this.intelEl.innerHTML = `
      <div class="se-intel-in">
        <div class="se-intel-head">${head}</div>
        ${body}
      </div>`;
    this.sayEl.innerHTML = say;
  }

  /**
   * Takes the press on a slider and holds the drag open on the WINDOW.
   *
   * On the window rather than as a capture on the track, so a drag that runs
   * off the track, over another row or off the edge of the screen keeps
   * moving the thumb it started on. The track's box is measured ONCE here: a
   * row's height and the grid's columns do not depend on the value, so the
   * box a press starts in is the box the whole drag happens in, and the patch
   * that moves the thumb leaves the element — and the drag — alone.
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
    // first click into the list — there is no hover to have moved it already.
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
    // The page cannot change under a live drag — the bumpers and the strip
    // both need a second input the drag's own pointer is busy with — so the
    // row index still means what it did at the press.
    const row = this.controlAt(d.row);
    if (!row) return;
    const options = optionsOf(row);
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
}

/** One step along a list of `n`: clamped for the arrows, wrapped for Enter. */
function step(from: number, delta: number, n: number, wrap: boolean): number {
  if (n <= 0) return 0;
  return wrap
    ? (from + delta + n) % n
    : Math.max(0, Math.min(n - 1, from + delta));
}
