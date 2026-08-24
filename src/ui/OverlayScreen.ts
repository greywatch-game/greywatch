/**
 * OverlayScreen.ts — The four full-screen cards that stop the game: the main
 * menu, the round-over result, the pause list, and the one that stands over a
 * map being built.
 * Owns: `#overlay` and everything written into it, the pause list's selection,
 * and the `.overlaid` class on `#hud` that hides the gameplay chrome behind a
 * card. A peer of DeployScreen and LoadoutScreen — Game wires its callbacks
 * (`onStart`, `onDifficulty`, `onOpenLoadout`, `onPauseAction`) and drives its
 * selection, and it knows nothing about game state beyond what it is handed.
 * Invariants: only one card is up at a time — each `show*` rewrites the whole
 * element — and `hide()` is the single way down from any of them.
 *
 * One class rather than four because the cards are one element, not four
 * screens that happen to overlap: they share the shell, the title block and,
 * between the menu and the round-over card, the Deploy button. What splitting
 * them would buy is four files that could never be shown together anyway, at
 * the cost of a base class or a duplicated stylesheet. A card that grows its
 * own state — a settings screen with rows to edit, a map picker — has earned a
 * file of its own; a card that is markup and a button has not, and the building
 * card is markup and not even that.
 *
 * Deliberately NOT here: the KEY-CAP TABLE. It hung under the menu's title and
 * under the pause list, drawn from one table by one loop, and it belongs to
 * `SettingsScreen` now — a card the player is on to make a decision should not
 * carry the longest block on the screen as reference material under it, and the
 * settings screen is one row of the menu and one item of the pause list away.
 *
 * Deliberately NOT here either: `setPaused`/`setEditing`. Those hide parts of
 * the HUD's own chrome and stay with the HUD, even though a pause is what
 * raises one of them.
 */
import "./overlay.css";
import { CONFIG } from "../config";
import { difficultyTiers } from "../entities/BotSkill";
import type { SightId } from "../entities/sights";
import type { PrimaryWeaponId } from "../entities/weapons";
import type { MapDef } from "../world/maps";
import { kitLabel, WEAPON_BLURBS } from "./LoadoutScreen";
import { mapShotUrl } from "./mapShots";
import { drawMapThumb } from "./MapThumb";

/**
 * What the pause menu can do, and the label for each. In screen order.
 *
 * `settings` sits above the two destructive items on purpose: it is the only
 * one you can pick and come back from, and putting it under "Quit to menu"
 * would file the harmless action below the one that ends the round.
 */
export type PauseAction = "resume" | "settings" | "restart" | "quit";
const PAUSE_ITEMS: readonly [PauseAction, string][] = [
  ["resume", "Resume"],
  ["settings", "Settings"],
  ["restart", "Restart round"],
  ["quit", "Quit to menu"],
];

/**
 * What the main menu's cursor can rest on, in screen order.
 *
 * The menu used to be four things reached by four different buttons — left and
 * right for the difficulty, `L`/Y for the kit, `O` for the settings, and a
 * confirm from anywhere for the round — which is a keyboard's idea of a menu
 * and leaves a pad player with no way at all to reach a row nobody thought to
 * give a face button. It is a LIST now: up and down move the cursor, A picks
 * what it is on, and the dedicated keys survive as accelerators rather than as
 * the only way in.
 */
type MenuItem =
  | "map"
  | "difficulty"
  | "loadout"
  | "settings"
  | "multiplayer"
  | "start";

/**
 * Everything the menu card draws itself from.
 *
 * An object rather than five positional arguments: two `readonly string[]` and
 * two `number` in a row is a signature where swapping the map's index with the
 * difficulty tier still typechecks and silently picks the wrong thing.
 */
export interface MenuState {
  /**
   * The maps themselves, not their names.
   *
   * The panel beside the list draws a thumbnail of the highlighted map out of
   * its layout and colours it out of its environment, so what this row needs
   * is the `MapDef` — and once it has that, the flag count and the extent the
   * card used to be handed separately are read off the same object rather than
   * being passed alongside it and trusted to agree.
   */
  maps: readonly MapDef[];
  selectedMap: number;
  difficulties: readonly string[];
  selected: number;
  /** The two slots, by id: the panel names them apart and quotes their table. */
  weapon: PrimaryWeaponId;
  sight: SightId;
}

/**
 * Small counts as words, because the tagline is prose: "take and hold five
 * points" is a sentence and "take and hold 5 points" is a stat line. Anything
 * past the ones a Conquest map plausibly carries falls back to the digits.
 */
const COUNT_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const spellCount = (n: number) => COUNT_WORDS[n] ?? String(n);
/**
 * `multiplayer` sits with the other two screen-openers rather than beside
 * Deploy, because that is what it IS — a button that leaves this card for
 * another one. Deploy stays alone at the bottom as the only row that ends the
 * menu in a round, and the rows above it are, in order, what that round will be
 * made of and then the two places you can go instead.
 */
const MENU_ITEMS: readonly MenuItem[] = [
  "map",
  "difficulty",
  "loadout",
  "settings",
  "multiplayer",
  "start",
];
/**
 * Where the cursor sits when the menu is raised. Deploy rather than the top
 * row, because it is the thing all but one visitor to this screen came for —
 * and because it keeps Enter/A meaning "start the round" the moment the title
 * appears, exactly as it did before there was a cursor at all.
 */
const MENU_DEFAULT = MENU_ITEMS.indexOf("start");

/**
 * The panel's three shapes, as three functions rather than three copies of the
 * same markup in five branches of `drawDetail`.
 *
 * A head (what kind of thing this is, and which one), a fact strip (a figure
 * over its caption, two or three across), and the whole block for the rows
 * whose panel is only a paragraph. Everything they take is this build's own
 * constants — a map's name, a tier's blurb, a weapon's table — so it is
 * interpolated; nothing a player or a server typed reaches this screen at all.
 */
function detailHead(eyebrow: string, title: string): string {
  return `<div class="ov-detail-head">
      <span class="ui-eyebrow">${eyebrow}</span><h3>${title}</h3>
    </div>`;
}

function facts(rows: readonly [string, string][]): string {
  return `<div class="ui-facts">${rows
    .map(([value, label]) => `<div><b>${value}</b><span>${label}</span></div>`)
    .join("")}</div>`;
}

function detailBlock(eyebrow: string, title: string, blurb: string): string {
  return `${detailHead(eyebrow, title)}<p class="ov-blurb">${blurb}</p>`;
}

export class OverlayScreen {
  private root: HTMLElement;
  /** Live only while the pause card is up — the buttons die with its markup. */
  private pauseButtons: HTMLElement[] = [];
  private pauseIndex = 0;
  /** Live only while the menu card is up, for the same reason. */
  private menuEls = new Map<MenuItem, HTMLElement>();
  private menuIndex = MENU_DEFAULT;
  /** The difficulty row's state, so `activateMenu` can step it. */
  private tierCount = 0;
  private tier = 0;
  /** The map row's state, same reason. */
  private mapCount = 0;
  private mapIndex = 0;
  /**
   * What the panel beside the list draws itself from, held because the panel
   * is redrawn on every cursor move while `showMenu` is called only when
   * something actually changed. Both are set from the `MenuState` and never
   * decided here — this screen still knows nothing about the game beyond what
   * it is handed.
   */
  private maps: readonly MapDef[] = [];
  private kit: { weapon: PrimaryWeaponId; sight: SightId } = {
    weapon: "rifle",
    sight: "holo",
  };
  /** The panel element, live only while the menu card is up. */
  private detailEl: HTMLElement | null = null;
  /**
   * The menu's BACKDROP: a photograph of the map that is chosen, under the
   * veil, cross-faded when the choice changes.
   *
   * It is a root of its OWN (`#menu-shot`, appended to `#hud` beside
   * `#overlay`) rather than markup inside the card, and both halves of that
   * are load-bearing. It has to survive `showMenu`, which rewrites the card
   * wholesale on every map step — a layer removed and re-inserted has no style
   * to interpolate FROM, so the cross-fade would jump-cut. And it has to sit
   * UNDER the veil, which is the card's own background: a child of `#overlay`
   * paints over its parent's background whatever its z-index, so a photograph
   * inside the card would put the picture on top of the scrim that makes the
   * type over it legible.
   *
   * What that buys is that the veil needs no second copy for the menu. It is
   * the same five layers every screen here draws, at `card-menu`'s own
   * density — the two custom properties `.ui-veil` already exposes for exactly
   * this question of how much of what is behind shows through.
   */
  private shotRoot: HTMLElement;
  /**
   * The two picture layers. One is showing and the other is where the next
   * one is prepared; a cross-fade swaps which is which. Two rather than one
   * because `background-image` cannot be transitioned.
   */
  private shotLayers: [HTMLElement, HTMLElement];
  private shotFront = 0;
  /**
   * What the front layer was last asked to show. `undefined` covers both "no
   * card has raised the backdrop yet" and "this map has no shot", which is why
   * a map without one fades the picture OUT rather than leaving the last map's
   * behind it.
   */
  private shotUrl: string | undefined;
  /**
   * Which card is up. The cursor is reset when the menu is RAISED and kept
   * across a redraw: `showMenu` is called again on every difficulty change and
   * on the way back from the kit and settings screens, and a cursor that
   * jumped back to Deploy each time would make the row you just left the one
   * place you cannot stay.
   */
  private card: "none" | "menu" | "roundover" | "pause" | "building" = "none";

  /** Wired by Game: the player picked a difficulty tier from the menu. */
  onDifficulty: (tier: number) => void = () => {};
  /** Wired by Game: the player picked a map from the menu. */
  onMap: (index: number) => void = () => {};
  /** Wired by Game: the player asked for the loadout screen. */
  onOpenLoadout: () => void = () => {};
  /** Wired by Game: the player asked for the settings screen. */
  onOpenSettings: () => void = () => {};
  /** Wired by Game: the player asked for the multiplayer lobby. */
  onOpenMultiplayer: () => void = () => {};
  /** Wired by Game: the player asked to start a round. */
  onStart: () => void = () => {};
  /** Wired by Game: the player picked something from the pause list. */
  onPauseAction: (action: PauseAction) => void = () => {};

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "overlay";
    this.root.className = "hidden";
    this.shotRoot = document.createElement("div");
    this.shotRoot.id = "menu-shot";
    this.shotLayers = [this.buildShotLayer(), this.buildShotLayer()];
    for (const layer of this.shotLayers) this.shotRoot.appendChild(layer);
    // The backdrop goes in first, so that DOM order agrees with the z-indices
    // that actually decide it (`#menu-shot` 9, `#overlay` 10) — nothing rests
    // on that, but a reader looking at the elements should not have to check.
    document.getElementById("hud")!.appendChild(this.shotRoot);
    // Appended like every other screen, and before the deploy map and the
    // minimap because Game builds this first. DOM order does not decide the
    // stacking here — `#overlay` carries a z-index of its own, since a pause
    // can be taken with either of those on screen and an overlay you can see a
    // map through is not an overlay.
    document.getElementById("hud")!.appendChild(this.root);
    // The one thing on this screen that a resize genuinely breaks. Everything
    // else here is CSS and re-lays itself; the map schematic is a canvas whose
    // backing store was sized to the box it had when it was drawn, so a window
    // dragged wider leaves it stretched. Guarded on the card, because the
    // panel only exists on one of the four.
    window.addEventListener("resize", () => {
      if (this.card === "menu") this.paintThumb();
    });
  }

  /**
   * The main menu: a rail of five decisions with the Deploy button under them,
   * and the panel beside it saying what the cursor is standing on.
   *
   * The kit itself is not edited here — it is two slots and a stat chart, which
   * is a screen rather than a strip of buttons under a title. What sits here is
   * the button that opens it and a reminder of what is currently in the
   * player's hands.
   *
   * The card is drawn in the shell (`.ui-screen` in `base.css`) and is ANCHORED
   * to the viewport rather than centred in it. It was a 600px column down the
   * middle of the window, which on a monitor is a quarter of the width in use
   * and nothing within 500px of an edge — a dialog box over a game rather than
   * the game's own front end. What that column's width bought was alignment,
   * and the rail keeps it a different way: every row states the same three
   * tracks, so the labels line up and every control begins on one edge.
   *
   * Each row is a BOX now rather than `display: contents`, because each one
   * carries a selection — a plate and an accent bar down its left side. The
   * label column is a percentage rather than `max-content`, and that is what
   * keeps the alignment: a content-sized track is measured per row, so five
   * rows would find five widths.
   *
   * `#overlay` is inside a `pointer-events: none` HUD and does not opt back in
   * (only `#deploy` does), so the individual CONTROLS ask for pointer events —
   * the tier buttons, the kit button and Deploy, never the rows around them.
   * The labels, the hints and the grid's own gaps stay inert, and a click that
   * lands on one of them now does NOTHING: the pointer's only way off this
   * screen is the Deploy button. It used to be every pixel of it, which meant
   * choosing a map or a difficulty deployed you the instant you chose one —
   * those two fire on mouse-UP, and the confirm reads the mouse-DOWN before it.
   */
  showMenu(opts: MenuState): void {
    const { maps, selectedMap, difficulties, selected } = opts;
    this.setOverlaid(true);
    // Raised anew, not redrawn — see `card`.
    if (this.card !== "menu") this.menuIndex = MENU_DEFAULT;
    this.card = "menu";
    this.kit = { weapon: opts.weapon, sight: opts.sight };
    this.maps = maps;
    this.tierCount = difficulties.length;
    this.tier = selected;
    this.mapCount = maps.length;
    this.mapIndex = selectedMap;
    const map = maps[selectedMap];
    this.setShot(map);
    const flags = map ? map.layout.controlPoints.length : 0;
    const tiers = difficulties
      .map(
        (name, i) =>
          `<button class="tier${i === selected ? " on" : ""}" data-tier="${i}">${name}</button>`,
      )
      .join("");
    const mapButtons = maps
      .map(
        (m, i) =>
          `<button class="tier${i === selectedMap ? " on" : ""}" data-map="${i}">${m.name}</button>`,
      )
      .join("");
    this.setCardClass("menu");
    this.root.innerHTML = `
      <div class="ui-head">
        <div class="ui-titles">
          <span class="ui-eyebrow">Cel-shaded conquest</span>
          <h1>HOLLOWMERE</h1>
          <p class="tagline">Take and hold ${spellCount(flags)} points against ${CONFIG.teams[1].name}</p>
        </div>
        <div class="ui-meta">
          <span>Deployment</span>
          <b>${CONFIG.bots.perTeam} v ${CONFIG.bots.perTeam}</b>
          <span>${CONFIG.teams[0].name}</span>
        </div>
      </div>
      <div class="ui-body">
        <div class="ui-rail">
          <div class="ov-row segmented" data-menu="map">
            <span class="label">Map</span>
            <div class="tiers">${mapButtons}</div>
            <span class="hint">&larr; &rarr;</span>
          </div>
          <div class="ov-row segmented" data-menu="difficulty">
            <span class="label">Enemy</span>
            <div class="tiers">${tiers}</div>
            <span class="hint">&larr; &rarr;</span>
          </div>
          <div class="ov-row kit" data-menu="loadout">
            <span class="label">Loadout</span>
            <button class="kit-open"><b>${kitLabel(opts.weapon, opts.sight)}</b><i>Change kit</i></button>
            <span class="hint">L / Y</span>
          </div>
          <div class="ov-row kit" data-menu="settings">
            <span class="label">Options</span>
            <button class="settings-open"><b>Settings</b><i>Controls &middot; display</i></button>
            <span class="hint">O</span>
          </div>
          <div class="ov-row kit" data-menu="multiplayer">
            <span class="label">Online</span>
            <button class="mp-open"><b>Multiplayer</b><i>Browse matches</i></button>
            <span class="hint">M</span>
          </div>
          <button class="ov-start" data-menu="start"><b>Deploy</b><i>Enter &middot; A &middot; Start</i></button>
        </div>
        <div class="ui-panel ui-optional ov-detail"></div>
      </div>
      <p class="ui-foot">
        <span><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd class="pad">Stick / D-pad</kbd> move</span>
        <span><kbd>&larr;</kbd><kbd>&rarr;</kbd> change</span>
        <span><kbd>Enter</kbd><kbd class="pad">A</kbd> select</span>
      </p>
    `;
    this.detailEl = this.root.querySelector(".ov-detail");
    this.root
      .querySelectorAll<HTMLElement>("button[data-tier]")
      .forEach((btn) => {
        btn.onclick = () => this.onDifficulty(Number(btn.dataset.tier));
      });
    this.root.querySelectorAll<HTMLElement>("button[data-map]").forEach((btn) => {
      btn.onclick = () => this.onMap(Number(btn.dataset.map));
    });
    // The cursor's row is collected from the markup rather than kept in step
    // by hand, so a row added above only has to name itself in `MENU_ITEMS`.
    this.menuEls.clear();
    this.root.querySelectorAll<HTMLElement>("[data-menu]").forEach((el) => {
      const item = el.dataset.menu as MenuItem;
      this.menuEls.set(item, el);
      // Hovering moves the cursor with it, so the highlighted row and the one
      // Enter is about to fire can never disagree — the rule the pause list,
      // the kit screen's slots and the settings rows all follow.
      el.onmouseenter = () => this.setMenuSelection(MENU_ITEMS.indexOf(item));
    });
    this.applyMenuSelection();
    // POINTERDOWN, not click — kept now that the confirm no longer counts the
    // mouse, because it is the edge these two have always changed state on and
    // the deploy screen's twins still do it for a live reason. Every button on
    // this card that leaves the screen it is on agrees on the down edge; the
    // ones that only step a row (map, difficulty) are ordinary clicks.
    const kitBtn = this.root.querySelector<HTMLElement>("button.kit-open");
    if (kitBtn) kitBtn.onpointerdown = () => this.onOpenLoadout();
    const setBtn = this.root.querySelector<HTMLElement>("button.settings-open");
    if (setBtn) setBtn.onpointerdown = () => this.onOpenSettings();
    const mpBtn = this.root.querySelector<HTMLElement>("button.mp-open");
    if (mpBtn) mpBtn.onpointerdown = () => this.onOpenMultiplayer();
    this.bindStart();
  }

  /**
   * The panel beside the list, and the reason the menu is a two-column screen
   * rather than a column down the middle of one.
   *
   * A front end for a game with five decisions on it is a short list and a
   * great deal of leftover window. The leftover is spent here, on whatever the
   * cursor is standing on: which map, drawn and described; which enemy, and
   * what that tier is like to fight; what is in your hands and what it does.
   * That is the whole justification for the width — a wide screen that puts
   * the same six rows in the middle of more emptiness has not used the space,
   * it has just left more of it.
   *
   * It is REDRAWN on every cursor move and the rows are not: the rows carry
   * the selection as a class on elements that already exist (see
   * `applyMenuSelection`), because moving down a list must not restart the
   * title's animation or drop the hover under the mouse. The panel has neither
   * a listener nor a transition on it, so rewriting it costs a layout of one
   * box and nothing that can be seen going wrong.
   *
   * `start` gets the DEPLOYMENT BRIEF rather than nothing, and that is where
   * the cursor opens: the map, the enemy and the kit, which between them are
   * the whole of what pressing the button under it is about.
   */
  private drawDetail(): void {
    const el = this.detailEl;
    if (!el) return;
    const item = MENU_ITEMS[this.menuIndex];
    const map = this.maps[this.mapIndex];
    switch (item) {
      case "map":
        el.innerHTML = map ? this.mapDetail(map) : "";
        break;
      case "difficulty":
        el.innerHTML = this.tierDetail();
        break;
      case "loadout":
        el.innerHTML = this.kitDetail();
        break;
      case "settings":
        el.innerHTML = detailBlock(
          "Options",
          "Settings",
          "Look speed for mouse, stick and thumb; how much of the screen the " +
            "renderer is given; and the full control map for all three.",
        );
        break;
      case "multiplayer":
        el.innerHTML = detailBlock(
          "Online",
          "Multiplayer",
          `Browse what every region is running, or start a round of your own. ` +
            `Sixteen slots either way — every seat nobody is sitting in is a bot, ` +
            `and it stands up again when they leave.`,
        );
        break;
      case "start":
        el.innerHTML = this.briefDetail(map);
        break;
    }
    this.paintThumb();
  }

  /** The map row's panel: the schematic, the line, and the three facts. */
  private mapDetail(map: MapDef): string {
    return `
      ${detailHead("Map", map.name)}
      <div class="ov-thumb"><canvas></canvas></div>
      <p class="ov-blurb">${map.blurb}</p>
      ${this.mapFacts(map)}
    `;
  }

  /**
   * What is countable about a map, read off the map rather than written down
   * beside it: how many flags, how big the square is, and how far you can
   * actually see across it — which on this game's maps is the single biggest
   * difference between two of them, and is `fogEnd` against the map's extent
   * rather than a weather note somebody has to remember to update.
   */
  private mapFacts(map: MapDef): string {
    const size = map.layout.size ?? CONFIG.map.size;
    const fog = map.environment.fogEnd;
    return facts([
      [String(map.layout.controlPoints.length), "Control points"],
      [`${size} m`, "Across"],
      [fog >= size ? "Clear" : `${Math.round(fog)} m`, "Visibility"],
    ]);
  }

  /**
   * The enemy row's panel: a meter, the tier's line, and the reaction time.
   *
   * The meter's rungs are placed at each tier's own `centre`, not at equal
   * steps, so the gap between Veteran and Elite reads as the small one it is
   * and the gap below Recruit reads as the room that is left. Both numbers are
   * `CONFIG.bots.skill`'s — the tier and the wind-up it actually gets — so
   * this cannot describe a difficulty the bots are not being given.
   */
  private tierDetail(): string {
    const tiers = difficultyTiers();
    const t = tiers[this.tier];
    if (!t) return "";
    const react = CONFIG.bots.skill.reactionTime;
    const wind = react.rookie + (react.ace - react.rookie) * t.centre;
    const rungs = tiers
      .map(
        (r, i) =>
          `<i class="${i <= this.tier ? "on" : ""}" style="left:${(r.centre * 100).toFixed(1)}%"></i>`,
      )
      .join("");
    return `
      ${detailHead("Enemy skill", t.name)}
      <div class="ov-meter"><span style="width:${(t.centre * 100).toFixed(1)}%"></span>${rungs}</div>
      <p class="ov-blurb">${t.blurb}</p>
      ${facts([
        [`${wind.toFixed(2)} s`, "Reaction"],
        [`${CONFIG.bots.perTeam}`, "Per side"],
        [`${Math.round(t.centre * 100)}%`, "Skill band"],
      ])}
    `;
  }

  /** The loadout row's panel: the two slots, named apart and quoted. */
  private kitDetail(): string {
    const w = CONFIG.weapons[this.kit.weapon];
    const s = CONFIG.sights[this.kit.sight];
    return `
      ${detailHead("Loadout", w.name)}
      <p class="ov-blurb">${WEAPON_BLURBS[this.kit.weapon]}</p>
      ${facts([
        [w.damageFar === w.damage ? `${w.damage}` : `${w.damage}–${w.damageFar}`, "Damage"],
        [`${w.magSize}`, "Magazine"],
        [`${w.range} m`, "Range"],
      ])}
      <div class="ov-slot">
        <span class="ui-eyebrow">Optic</span>
        <b>${s.name}</b>
        <i>${s.magnification.toFixed(1)}&times; magnification</i>
      </div>
    `;
  }

  /**
   * The brief: what the Deploy button under the cursor is about to spend.
   *
   * Three lines and the map's own schematic, which is the summary a player
   * arriving at this screen and pressing A immediately never otherwise gets to
   * see — and the one place the three separate decisions above are shown
   * having been made together.
   */
  private briefDetail(map: MapDef | undefined): string {
    const tier = difficultyTiers()[this.tier];
    return `
      ${detailHead("Ready", "Deployment brief")}
      <div class="ov-thumb"><canvas></canvas></div>
      <div class="ov-brief">
        <div><span>Map</span><b>${map ? map.name : "&mdash;"}</b></div>
        <div><span>Enemy</span><b>${tier ? tier.name : "&mdash;"}</b></div>
        <div><span>Kit</span><b>${kitLabel(this.kit.weapon, this.kit.sight)}</b></div>
      </div>
    `;
  }

  /**
   * Paints the map schematic, if the panel that is up has one in it.
   *
   * Separate from the markup because a canvas is not markup: it has to be
   * drawn AFTER the element is in the document and has been laid out, since
   * `drawMapThumb` sizes its backing store from the box it was given. Reading
   * that box here forces the layout the assignment above deferred, which is
   * the one synchronous reflow this screen pays and is why it is not on a
   * frame callback — a thumbnail that arrives a frame after the row it belongs
   * to reads as the panel flickering.
   */
  private paintThumb(): void {
    const canvas = this.detailEl?.querySelector("canvas");
    const map = this.maps[this.mapIndex];
    if (canvas && map) drawMapThumb(canvas, map);
  }

  /** One picture layer of the backdrop. Empty until a map is chosen. */
  private buildShotLayer(): HTMLElement {
    const el = document.createElement("div");
    el.className = "ov-shot";
    return el;
  }

  /**
   * Puts the chosen map's photograph up, cross-fading from whatever was there.
   *
   * Called from `showMenu` rather than from the cursor, because the backdrop
   * follows the map that has been CHOSEN and not the row the cursor happens to
   * be resting on — the menu is redrawn on every map step, so this is called
   * exactly when the answer changes.
   *
   * It waits for the image to DECODE before swapping. A fade into a layer the
   * browser has not finished decoding is a fade into a blank rectangle and
   * then a pop, which on a cold boot is every first visit to this screen; the
   * cost of waiting is that the very first backdrop arrives a frame or two
   * after the card it is behind, which is the harmless half of the trade.
   *
   * The `shotUrl` guard is what makes stepping quickly along the map row safe:
   * whichever pick is the latest owns the swap, and a decode that comes back
   * after a later one has already been asked for is dropped rather than
   * fighting it for the front layer.
   */
  private setShot(map: MapDef | undefined): void {
    // Raised by the fact of being called: the menu card is the only thing that
    // calls this, and every other card calls `clearShot`.
    this.shotRoot.classList.add("on");
    const url = map ? mapShotUrl(map.id) : undefined;
    if (url === this.shotUrl) return;
    this.shotUrl = url;
    // A map with no shot of its own takes the picture away rather than
    // leaving the last one up, which would be a caption's worth of lie.
    if (!url) {
      this.shotLayers[this.shotFront].classList.remove("on");
      return;
    }
    const img = new Image();
    img.src = url;
    const raise = () => {
      if (this.shotUrl !== url) return;
      const back = this.shotLayers[1 - this.shotFront];
      back.style.backgroundImage = `url("${url}")`;
      back.classList.add("on");
      this.shotLayers[this.shotFront].classList.remove("on");
      this.shotFront = 1 - this.shotFront;
    };
    // A rejection is a build missing its own asset, and there is nothing to
    // fall back TO but the veil the picture is already over — so the last
    // backdrop stays and the screen is the one it was before shots existed.
    img.decode().then(raise, () => {});
  }

  /**
   * Takes the backdrop down — the container, not the layers, so coming back to
   * the menu on the same map brings the same picture back without re-decoding
   * or re-fading it.
   *
   * Every card but the menu calls this, including the pause: what a pause
   * stands over is a live round, and a photograph of a map behind the round
   * you are playing on it is two of the same place at once.
   */
  private clearShot(): void {
    this.shotRoot.classList.remove("on");
  }

  /**
   * The one button that starts the round, shared by the menu and the round-over
   * card, and the ONLY thing on either that a pointer can deploy with. It began
   * as a redundant target beside a click-anywhere confirm — an instruction in
   * prose is not a target, and a pad player reading "click, press Enter, or
   * press Start" has to work out which of those they own — and is now carrying
   * the mouse and the finger by itself, which is what lets the rows above it
   * be picked from without also ending the screen they are on.
   *
   * POINTERDOWN, the same edge every button here that leaves the screen uses.
   */
  private bindStart(): void {
    const btn = this.root.querySelector<HTMLElement>("button.ov-start");
    if (btn) btn.onpointerdown = () => this.onStart();
  }

  /** Steps the menu cursor, wrapping at both ends. No-op off the menu card. */
  moveMenuSelection(delta: number): void {
    if (this.menuEls.size === 0) return;
    const n = MENU_ITEMS.length;
    this.setMenuSelection((this.menuIndex + delta + n) % n);
  }

  /**
   * Left/right on the cursor's row. Only the two segmented rows — the map and
   * the difficulty — have anything to step; on a row that is a button this is
   * deliberately nothing, because a horizontal nudge that fired a screen would
   * make the cursor's own left and right edges feel like traps.
   *
   * It CLAMPS where `activateMenu` wraps: left and right are a slider along a
   * row of four tiers, and a slider that jumps from Ace back to Green at the
   * end is one you have to watch rather than feel.
   */
  stepMenuItem(delta: number): void {
    if (this.menuEls.size === 0) return;
    if (MENU_ITEMS[this.menuIndex] === "difficulty") {
      this.onDifficulty(this.tier + delta);
    } else if (MENU_ITEMS[this.menuIndex] === "map") {
      this.onMap(this.mapIndex + delta);
    }
  }

  /**
   * Fires the cursor's row — Enter / gamepad A.
   *
   * The difficulty row cycles rather than doing nothing: a confirm that
   * answers nothing is the thing this screen was rebuilt to remove, and with
   * four tiers on screen and the current one lit, a press that advances to the
   * next says what it did. It WRAPS, unlike left/right, so the button always
   * changes something wherever the row happens to be resting.
   */
  activateMenu(): void {
    if (this.menuEls.size === 0) return;
    switch (MENU_ITEMS[this.menuIndex]) {
      case "map":
        if (this.mapCount > 0) this.onMap((this.mapIndex + 1) % this.mapCount);
        break;
      case "difficulty":
        if (this.tierCount > 0) this.onDifficulty((this.tier + 1) % this.tierCount);
        break;
      case "loadout":
        this.onOpenLoadout();
        break;
      case "settings":
        this.onOpenSettings();
        break;
      case "multiplayer":
        this.onOpenMultiplayer();
        break;
      case "start":
        this.onStart();
        break;
    }
  }

  private setMenuSelection(i: number): void {
    if (i === this.menuIndex) return;
    this.menuIndex = i;
    this.applyMenuSelection();
  }

  /**
   * Paints the cursor. A class on rows that already exist rather than a
   * redraw, so moving down the menu does not restart the title's animation or
   * drop the hover state under the mouse — the same rule the pause list keeps.
   */
  private applyMenuSelection(): void {
    MENU_ITEMS.forEach((item, i) => {
      this.menuEls.get(item)?.classList.toggle("sel", i === this.menuIndex);
    });
    // The panel IS redrawn, and only the panel: it carries no listener, no
    // transition and no hover state, so there is nothing on it a rewrite can
    // interrupt — which is exactly what the rows above cannot say.
    this.drawDetail();
  }

  /**
   * The round-over card: who holds the map, and what it cost both sides.
   *
   * The result is the SCREEN rather than a line under a title. Two blocks
   * facing each other across a bar, each in its own side's colour, with the
   * reinforcements each has left — which is the number the round was actually
   * decided by, and was a 24 px pair in a strip 600 px wide before this.
   */
  showRoundOver(
    winnerName: string,
    playerWon: boolean,
    tickets0: number,
    tickets1: number,
    mapName: string,
  ): void {
    this.setCardClass("roundover");
    this.setOverlaid(true);
    this.card = "roundover";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    // The bar is the two counts against each other rather than against the
    // ticket pool they started from: a round that ends 142-0 and one that ends
    // 12-0 are not the same round, and the pool is the same number on both
    // sides so the share IS the margin.
    const total = Math.max(1, tickets0 + tickets1);
    this.root.innerHTML = `
      <div class="ui-head">
        <div class="ui-titles">
          <span class="ui-eyebrow">Round over &middot; ${mapName}</span>
          <h1 class="${playerWon ? "win" : "dead"}">${playerWon ? "VICTORY" : "DEFEAT"}</h1>
        </div>
        <div class="ui-meta">
          <span>Holding the map</span>
          <b>${winnerName}</b>
        </div>
      </div>
      <div class="ui-body solo">
        <div class="ov-outcome">
          <div class="ov-result frame">
            <span class="lbl">Reinforcements remaining</span>
            <div class="ov-sides">
              <div class="side mine">
                <span>${CONFIG.teams[0].name}</span><b>${tickets0}</b>
              </div>
              <div class="ov-split">
                <i class="mine" style="flex:${tickets0 / total}"></i>
                <i class="theirs" style="flex:${tickets1 / total}"></i>
              </div>
              <div class="side theirs">
                <span>${CONFIG.teams[1].name}</span><b>${tickets1}</b>
              </div>
            </div>
          </div>
          <button class="ov-start"><b>Another round</b><i>Enter &middot; A &middot; Start</i></button>
        </div>
      </div>
      <p class="ui-foot">
        <span><kbd>Enter</kbd><kbd class="pad">A</kbd> deploy again</span>
      </p>
    `;
    this.bindStart();
  }

  /**
   * The card that stands over a map being built.
   *
   * It exists because building one is ~0.7 s of merges, an occlusion bake and
   * a nav grid on a single frame, and until there was something to put up, the
   * card the player had just confirmed simply froze where it stood and the
   * deploy screen appeared out of it. A hang and a load look identical; the
   * only thing that separates them is whether the game said which it was.
   *
   * `setOverlaid` for the same reason the menu calls it — what is under this
   * is either last round's HUD or nothing at all.
   *
   * No button, no cursor, no callbacks: this is the one card the player cannot
   * act on, and it takes itself down (`Game.buildRound` does) rather than
   * waiting to be dismissed.
   *
   * The bar is indeterminate and has to be — the work it covers is one
   * synchronous call, so there is no progress to read even in principle — and
   * it is the one thing on any of these cards that must keep moving with the
   * main thread stopped dead. See `.ov-bar i` in `overlay.css`: that is a
   * constraint on which CSS properties may animate it, not a style choice.
   */
  showBuilding(mapName: string): void {
    this.setCardClass("building");
    this.setOverlaid(true);
    this.card = "building";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    // Centred and deliberately bare. Everything else in this file grew a
    // second column while this card did not, and the reason is the freeze it
    // covers: whatever is on it has to be PAINTED before the main thread stops,
    // so a panel with a canvas in it would be a schematic drawn on the frame
    // the player was already waiting through. A name, a word and a bar.
    this.root.innerHTML = `
      <div class="ov-build">
        <span class="ui-eyebrow">Building</span>
        <h1 class="building-title">${mapName}</h1>
        <p class="prompt">Stand by</p>
        <div class="ov-bar"><i></i></div>
      </div>
    `;
  }

  /**
   * The pause menu: a short action list and nothing else.
   *
   * It deliberately does NOT call `setOverlaid`. The menu and the round-over
   * card hide the gameplay chrome because what is under them is last round's
   * and no longer true; under a pause everything on screen is this round's and
   * frozen exactly as it stood, so the tickets, the flags and your own vitals
   * are worth reading. `#hud.paused` — which the HUD raises, not this — takes
   * away only the things that would be lying.
   *
   * The action list is the one part of the overlay that takes pointer events,
   * the same carve-out the difficulty row gets. Selection is a class on a
   * button that already exists rather than a re-render, so arrowing down the
   * list does not restart the prompt's animation or drop the hover state.
   */
  showPause(): void {
    this.setCardClass("pause");
    this.card = "pause";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    const items = PAUSE_ITEMS.map(
      ([action, label]) =>
        `<button class="pact" data-action="${action}">${label}</button>`,
    ).join("");
    // Anchored to the LEFT and scrimmed from that side only, which is the one
    // place in this file a card deliberately does not take the screen. The
    // round under a pause is this round, frozen where it stood: the flags
    // along the top, your own vitals, the body you were about to shoot. A
    // full-bleed veil over that is a card hiding the thing it is a pause IN,
    // and `setOverlaid` is not called here for exactly the same reason.
    this.root.innerHTML = `
      <div class="ov-pause">
        <span class="ui-eyebrow">Round held</span>
        <h1 class="pause-title">PAUSED</h1>
        <p class="tagline">Nothing moves until you resume</p>
        <div class="pause-actions">${items}</div>
        <p class="prompt">Esc &middot; Start &middot; B to resume</p>
      </div>
    `;
    this.pauseButtons = [];
    this.root
      .querySelectorAll<HTMLElement>("button.pact")
      .forEach((btn, i) => {
        btn.onclick = () => this.onPauseAction(btn.dataset.action as PauseAction);
        // Hovering moves the keyboard selection with it, so the highlighted
        // item and the one a click is about to fire can never disagree.
        btn.onmouseenter = () => this.setPauseSelection(i);
        this.pauseButtons.push(btn);
      });
    this.setPauseSelection(0);
  }

  /** Steps the pause selection, wrapping at both ends. */
  movePauseSelection(delta: number): void {
    const n = this.pauseButtons.length;
    if (n === 0) return;
    this.setPauseSelection((this.pauseIndex + delta + n) % n);
  }

  /** Fires the selected pause item — Enter / gamepad A. */
  activatePause(): void {
    const btn = this.pauseButtons[this.pauseIndex];
    if (btn) this.onPauseAction(btn.dataset.action as PauseAction);
  }

  private setPauseSelection(i: number): void {
    this.pauseIndex = i;
    this.pauseButtons.forEach((b, k) => b.classList.toggle("on", k === i));
  }

  /**
   * Which card is up, as a class on the root — and what BACKDROP it gets.
   *
   * Three of the four are full-bleed screens over a scene that is either last
   * round's or nothing at all, and they take the shell's frame and its veil.
   * The pause is the exception and has to be: it is a lid over a live round
   * that the player is coming back to, so it is anchored to one side and
   * scrimmed from that side only. Setting `className` outright rather than
   * toggling is what stops the previous card's modifier surviving into the
   * next one — every one of these rewrites the markup underneath it anyway.
   */
  private setCardClass(
    card: "menu" | "roundover" | "building" | "pause",
  ): void {
    this.root.className =
      card === "pause" ? "card-pause" : `ui-screen ui-veil card-${card}`;
  }

  /** Takes whichever card is up back down. The single way off all three. */
  hide(): void {
    this.root.className = "hidden";
    this.setOverlaid(false);
    this.clearShot();
    this.detailEl = null;
    // The buttons live in the card's markup, so they die with it.
    this.pauseButtons = [];
    this.pauseIndex = 0;
    this.menuEls.clear();
    this.card = "none";
  }

  /**
   * Hides the gameplay chrome behind a full-screen card. The menu and the
   * round-over card sit over a live 3D scene, and the ticket gauge, flag strip,
   * killfeed and vitals underneath them are last round's — readable enough
   * through the scrim to look like the HUD is still running when it is not.
   * Same mechanism as `HUD.setEditing`, and for the same reason: the HUD keeps
   * writing to those nodes, so the hiding has to be in CSS.
   *
   * Reaching for `#hud` from here is the pattern LoadoutScreen's `.kitting`
   * already sets: the class belongs to whoever decides it is raised, and every
   * screen in this directory is a child of that element anyway.
   *
   * The deploy screen deliberately does NOT do this — you pick a spawn while
   * the round continues, and the tickets and flags are exactly what you are
   * deciding against.
   */
  private setOverlaid(on: boolean): void {
    document.getElementById("hud")!.classList.toggle("overlaid", on);
  }
}
