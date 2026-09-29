/**
 * OverlayScreen.ts — The four full-screen cards that stop the game: the main
 * menu, the round-over result, the pause list, and the one that stands over a
 * map being built.
 * Owns: `#overlay` and everything written into it, the menu's and the pause
 * list's selection, `#menu-shot` (the photograph the menu stands on), and the
 * `.overlaid` class on `#hud` that hides the gameplay chrome behind a card. A
 * peer of DeployScreen and LoadoutScreen — Game wires its callbacks
 * (`onStart`, `onDifficulty`, `onMap`, `onOpenLoadout`, `onPauseAction`,
 * `onVote`) and drives its selection, and it knows nothing about game state
 * beyond what it is handed.
 * Invariants: only one card is up at a time and `hide()` is the single way down
 * from any of them. The menu is BUILT when it is raised and PATCHED on every
 * later `showMenu` — the other three are rewritten whole by each `show*`.
 *
 * One class rather than four because the cards are one element, not four
 * screens that happen to overlap: they share the element, the veil and,
 * between the menu and the round-over card, the Deploy verb. What splitting
 * them would buy is four files that could never be shown together anyway, at
 * the cost of a base class or a duplicated stylesheet. A card that grows its
 * own state — a settings screen with rows to edit, a map picker — has earned a
 * file of its own; a card that is markup and a button has not, and the building
 * card is markup and not even that.
 *
 * **The round-over card's map BALLOT is the near miss, and it stays for a
 * reason worth stating.** It is a row of buttons and a cursor, which is the
 * pause list's shape and is already what this file holds; what it is NOT is a
 * picker that owns a value. The tally, this player's own vote and the window
 * all belong to the authority and arrive whole (`setVote`), so nothing here
 * decides anything — take that away and it would be a screen, and it would go.
 *
 * Deliberately NOT here: the KEY-CAP TABLE. It belongs to `SettingsScreen` —
 * a card the player is on to make a decision should not carry the longest
 * block on the screen as reference material, and the settings screen is one
 * press of the menu's cursor and one item of the pause list away.
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
import { perTeamOf } from "../world/layout";
import {
  collisionOf,
  heightsOf,
  loadCollision,
  loadHeights,
  type MapDef,
} from "../world/maps";
import { WEAPON_BLURBS } from "./LoadoutScreen";
import { mapShotUrl, shotThumbUrl } from "./mapShots";
import { drawMapThumb } from "./MapThumb";
import { glyph, guessDevice, type InputDevice } from "./prompts";

/**
 * What the pause menu can do, and the label for each. In screen order.
 *
 * `settings` sits above the two destructive items on purpose: it is the only
 * one you can pick and come back from, and putting it under "Quit to menu"
 * would file the harmless action below the one that ends the round.
 */
export type PauseAction = "resume" | "settings" | "restart" | "quit";
/**
 * The pause card's rows, and the one of them that is not always offered.
 *
 * `solo` is the third field: "Restart round" is a thing only the side running
 * the simulation may do, and in a match that is not this one. Left in, it read
 * as a way out of a round that was going badly and was instead a client tearing
 * its own world down under an authority that had not heard the key — the same
 * act the round-over card used to offer, arriving through a second door. Quit
 * to menu is the honest version of what that button was reaching for, and it is
 * on this list in both rounds.
 */
const PAUSE_ITEMS: readonly [PauseAction, string, boolean][] = [
  ["resume", "Resume", false],
  ["settings", "Settings", false],
  ["restart", "Restart round", true],
  ["quit", "Quit to menu", false],
];

/**
 * What the main menu's cursor can rest on.
 *
 * The menu is a LIST a pad steps through — up and down move, left and right
 * change the row the cursor is on, A fires it — and every dedicated key
 * (`L`/Y, `O`, `M`, the bumpers) is an accelerator rather than the only way
 * in, which is what lets a pad reach every row on this screen.
 */
type MenuItem =
  | "multiplayer"
  | "settings"
  | "map"
  | "difficulty"
  | "loadout"
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
   * The maps themselves, not their names: the reel draws each one's
   * photograph, the hero reads the flag count and the extent off the chosen
   * one, and the intel panel paints its schematic out of its layout — all off
   * the same object, so none of it can disagree.
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
 * The ballot for the next map, as the round-over card draws it.
 *
 * A view and not the wire's own `MapVoteMessage`, which is why the maps are
 * NAMED here: naming a map id is `MAPS`' job and this screen has no business
 * importing a protocol module to be handed one. `Game` resolves the ids and
 * counts the clock down; everything below draws what it is given.
 */
export interface VoteView {
  /** The candidates, in ballot order — the display name of each. */
  maps: readonly string[];
  /** Votes per candidate, indexed alike. */
  tally: readonly number[];
  /** Which candidate this player has voted for, or -1. */
  choice: number;
  /** Whole seconds left in the window, for the card's own countdown. */
  seconds: number;
}

/**
 * Everything the round-over card draws itself from.
 *
 * An object rather than seven positional arguments, which is `MenuState`'s
 * reason with one more number in the row: two ticket counts side by side is a
 * signature where swapping them still typechecks and quietly reports the round
 * backwards, and the two booleans behind them are worse.
 */
export interface RoundOverState {
  /** The side holding the map, already named through `teamLook`. */
  winnerName: string;
  playerWon: boolean;
  /** The two counts in the VIEWER's order — see the method's own note. */
  ticketsMine: number;
  ticketsTheirs: number;
  mapName: string;
  /** Whether this client is the one deciding what happens next. */
  solo: boolean;
  /**
   * The ballot, or null for a round whose next map nobody is being asked
   * about — offline (where `solo` answers instead) and against a server that
   * runs no vote.
   */
  vote: VoteView | null;
}

/**
 * The cursor's order, and it is a RING: up from the map reel is the system bar
 * along the top of the screen, and down from Deploy wraps back up to it.
 *
 * That is what makes a single list honest on a screen that is not one column.
 * Everything the round is made of is a column down the left — the map, the
 * enemy, the kit and the button that spends them, in the order they are read —
 * and the two places you can go INSTEAD of a round are a system bar in the top
 * corner, where every console front end keeps them. Stepping up off the top of
 * the column lands on that bar, which is where it is on the glass, and left and
 * right walk along it (`stepMenuItem`).
 */
const MENU_ITEMS: readonly MenuItem[] = [
  "multiplayer",
  "settings",
  "map",
  "difficulty",
  "loadout",
  "start",
];
/**
 * Where the cursor sits when the menu is raised. Deploy, because it is the
 * thing all but one visitor to this screen came for — and because it keeps
 * Enter/A meaning "start the round" the moment the title appears.
 */
const MENU_DEFAULT = MENU_ITEMS.indexOf("start");

/**
 * The map reel's two card shapes, as multiples of the card's HEIGHT: a slim
 * slice of photograph for every map that is not chosen and a full 16:9 frame
 * for the one that is.
 *
 * Written here and handed to the stylesheet as custom properties on the reel,
 * because the script needs them too: centring the chosen card in a reel that
 * scrolls has to know where that card will END UP, and while its width is
 * still transitioning the only place that answer exists is these two numbers.
 */
const CARD_SLIM = 0.78;
const CARD_WIDE = 16 / 9;

/**
 * The project's source, linked from the system bar. A link rather than a row
 * in `MENU_ITEMS`: it leaves the game rather than choosing anything in it, so
 * the cursor never lands on it and Enter can never open a tab by accident.
 */
const SOURCE_URL = "https://github.com/greywatch-game/greywatch";
/** GitHub's mark, inline so the menu stays asset-free; filled from `currentColor`. */
const GITHUB_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
/**
 * The system bar's two marks — a mast for Online, a cog for Settings — drawn
 * inline from `currentColor` for `GITHUB_MARK`'s reason. Strokes rather than
 * fills, at the weight of the type beside them, and square-capped: this
 * interface is cut corners, and a round-capped icon is the one soft thing on it.
 */
const ICON_ONLINE = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M12 11v10M8 21h8"/><circle cx="12" cy="9" r="2"/><path d="M7.8 13.2a6 6 0 0 1 0-8.4M16.2 4.8a6 6 0 0 1 0 8.4M4.9 16.1a10 10 0 0 1 0-14.2M19.1 1.9a10 10 0 0 1 0 14.2"/></svg>`;
const ICON_SETTINGS = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>`;

/** A 1-based index as two digits: the reel's counter and the hero's numeral. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

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

/** The references the patch path writes through, held from the build. */
interface MenuRefs {
  hero: HTMLElement;
  reel: HTMLElement;
  cards: HTMLElement[];
  count: HTMLElement;
  prev: HTMLElement;
  next: HTMLElement;
  tiers: HTMLElement[];
  tierName: HTMLElement;
  kitWeapon: HTMLElement;
  kitSight: HTMLElement;
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
   * The map the HERO is currently showing, which is what decides whether a
   * patch replays the hero's swap — a redraw for a difficulty change or a
   * return from the kit screen must not re-announce the same map.
   */
  private heroMap = -1;
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
  /** The menu's patchable parts, live only while the menu card is up. */
  private refs: MenuRefs | null = null;
  /**
   * Which device's prompts the menu draws. Guessed from the POINTER until a
   * device has actually been used — a phone's first frame has touched
   * nothing, and prompting it for Enter would be the one wrong answer — and
   * then whatever `Game` says is in hand.
   */
  private device: InputDevice = guessDevice();
  /**
   * The building card's progress bar, live only while that card is up. Held
   * rather than re-queried because it is written on a frame the main thread is
   * otherwise spending on the bake — see `setBuildProgress`.
   */
  private buildBar: HTMLElement | null = null;
  /**
   * The menu's BACKDROP: a photograph of the map that is chosen, under the
   * card, cross-faded when the choice changes.
   *
   * It is a root of its OWN (`#menu-shot`, appended to `#hud` beside
   * `#overlay`) rather than markup inside the card, and both halves of that
   * are load-bearing. It has to survive the card being rewritten — the round
   * -over card and a fresh raise both rewrite it, and a layer removed and
   * re-inserted has no style to interpolate FROM, so the cross-fade would
   * jump-cut. And it has to sit UNDER the scrim, which is the card's own
   * background: a child of `#overlay` paints over its parent's background
   * whatever its z-index, so a photograph inside the card would put the
   * picture on top of the gradients that make the type over it legible.
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
   * Which card is up. The menu is BUILT when it is raised and PATCHED while it
   * is up: `showMenu` is called again on every map step, every difficulty
   * change and on the way back from the kit, settings and lobby screens, and a
   * cursor that jumped back to Deploy each time would make the row you just
   * left the one place you cannot stay.
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
  /** Wired by Game: the player voted for a candidate, by ballot index. */
  onVote: (index: number) => void = () => {};

  /**
   * The block under the result plate that says what happens next — the ballot,
   * or the wait line that stands in for one. Null on every other card and on a
   * round-over card this client is deciding for itself.
   *
   * Held because the ballot can arrive AFTER the card is raised: an older
   * server sends none at all, and a client that joined mid-window is welcomed
   * before it is handed one. Redrawing this block is how a late ballot lands,
   * and it is the block rather than the card so the result above it does not
   * flicker under the player.
   */
  private nextRoot: HTMLElement | null = null;
  /** The candidate buttons, in ballot order, or empty when there is no ballot. */
  private voteEls: HTMLElement[] = [];
  /** The countdown's own element, written by `setVoteClock` alone. */
  private voteClockEl: HTMLElement | null = null;
  /** The footer line, which says how to vote while there is a vote to cast. */
  private voteFootEl: HTMLElement | null = null;
  /**
   * Which candidate the CURSOR is on — and never which one has been voted for.
   *
   * The two are separate on purpose and are drawn as separate things (`.sel`
   * against `.on`), the same split the menu's cursor and the difficulty row's
   * value already make: a vote is a value this client has stated to the
   * authority and had confirmed back, and the cursor is where the player's
   * hand is resting. Merging them would make arrowing along the row cast four
   * votes.
   */
  private voteIndex = 0;

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
    // The two things on this screen a resize genuinely breaks. Everything else
    // is CSS and re-lays itself; the schematic is a canvas whose backing store
    // was sized to the box it had when it was drawn, and the reel's scroll was
    // centred on a width it no longer has. Guarded on the card, because both
    // only exist on one of the four.
    window.addEventListener("resize", () => {
      if (this.card !== "menu") return;
      this.paintThumb();
      this.centreReel(false);
    });
  }

  /**
   * The main menu — a title screen rather than a form.
   *
   * **The MAP is the hero, because it is the one thing on this screen that
   * says what the game looks like.** The photograph of the chosen map fills the
   * window (`#menu-shot`), the scrim over it is dark only where there is type,
   * and the map's NAME is the largest thing on the card, set over the picture
   * like a title card rather than in a control. The wordmark is a lockup in the
   * corner: a player looking at this screen has already found the game.
   *
   * **Everything the round is made of is ONE column, read top to bottom**:
   * the map reel, the enemy, the kit, and Deploy under them — the order the
   * decisions are made in, ending on the button that spends them. The two
   * places you can go instead (Online, Settings) are a system bar in the
   * opposite corner, which is where every console front end keeps them, and
   * the cursor's ring walks off the top of the column onto it (`MENU_ITEMS`).
   * The right-hand side is an INTEL panel on whatever the cursor rests on —
   * the map's plan, the enemy tier, the kit — shown where a viewport has room
   * for a third thing and dropped where it does not, since nothing on it is a
   * control.
   *
   * **The maps are a REEL of photographs, not a stepper and not a strip of
   * words.** A strip of names gave seven maps an equal share of one column
   * and every one read as `HOLLO…`; a stepper named one map and hid the rest.
   * A photograph needs no label to be told apart, so every map is on screen at
   * once as a slim slice of its own picture and the chosen one opens to a full
   * frame — how many there are, which this is, and what each looks like, in a
   * row that fits a phone. The bumpers turn it from anywhere (LB/RB, Q/E),
   * left and right turn it while the cursor is on it, a click or a tap picks a
   * card, and on glass it scrolls under the thumb.
   *
   * **Every prompt is drawn ON its control, for the device in hand** — a key
   * cap, a pad's face button, or nothing under a finger (`glyph`,
   * `setInputDevice`). A line of hints naming three devices at once made every
   * player work out which of them was theirs.
   *
   * **It is BUILT on a raise and PATCHED after**, which is what lets a map
   * change ANIMATE: the chosen card opens, the hero slides the new name in and
   * the photograph cross-fades, on elements that were already there. Written
   * wholesale on every press as it used to be, each of those would have been
   * a jump cut. Only the intel panel is still rewritten, on every cursor move;
   * it carries no listener and no hover state, so a rewrite costs one box.
   *
   * `#overlay` is inside a `pointer-events: none` HUD and does not opt back in,
   * so the CONTROLS ask for pointer events and the rest of the card stays
   * inert: a click on the art, a caption or a gap does nothing, and **the
   * pointer's only way into a round is the Deploy button**. It used to be
   * every pixel of the card, which deployed the player the instant they chose
   * a map — the picks fire on mouse-UP and the confirm read the mouse-DOWN
   * before it.
   */
  showMenu(opts: MenuState): void {
    const { maps, selectedMap, difficulties, selected } = opts;
    this.setOverlaid(true);
    this.kit = { weapon: opts.weapon, sight: opts.sight };
    this.maps = maps;
    this.tierCount = difficulties.length;
    this.tier = selected;
    this.mapCount = maps.length;
    this.mapIndex = selectedMap;
    this.setShot(maps[selectedMap]);
    // A patch for a card that is already up with the same shape of rows; a
    // build for anything else. The row COUNTS are the shape — the maps can
    // differ between a dev build and a release, never inside one session.
    if (
      this.card === "menu" &&
      this.refs &&
      this.refs.cards.length === maps.length &&
      this.refs.tiers.length === difficulties.length
    ) {
      this.patchMenu(opts);
    } else {
      this.buildMenu(opts);
    }
    this.applyMenuSelection();
  }

  /**
   * Writes the menu card from nothing. Called when it is RAISED — from any
   * other card, or from nothing at all — and never while it is up.
   *
   * The cursor resets here and nowhere else, and so does the entrance: the
   * `.enter` class has to be on the root before the markup is written, because
   * what animates are elements that do not exist yet. At boot `Game` shows the
   * menu and then enters the `menu` state, both inside one task; the second
   * call is a PATCH, so the entrance the first one started runs on.
   */
  private buildMenu(opts: MenuState): void {
    const { maps, selectedMap, difficulties, selected } = opts;
    this.menuIndex = MENU_DEFAULT;
    this.card = "menu";
    this.setCardClass("menu", true);
    const tiers = difficulties
      .map(
        (name, i) =>
          // The PIPS are a tier's rank drawn as a count, so the row reads as a
          // ladder at a glance and the words only have to be read once.
          `<button class="mm-tier${i === selected ? " on" : ""}" data-tier="${i}">
            <b>${name}</b><i>${"<s></s>".repeat(difficulties.length)}</i>
          </button>`,
      )
      .join("");
    const cards = maps
      .map(
        (m, i) =>
          `<button class="mm-card${i === selectedMap ? " on" : ""}" data-map="${i}" title="${m.name}">
            <span class="mm-card-n">${twoDigits(i + 1)}</span>
            <span class="mm-card-name">${m.name}</span>
          </button>`,
      )
      .join("");
    const weapon = CONFIG.weapons[opts.weapon];
    const sight = CONFIG.sights[opts.sight];
    this.root.innerHTML = `
      <div class="mm-top">
        <div class="mm-brand">
          <span class="mm-kicker">Cel-shaded conquest</span>
          <span class="mm-word">GREYWATCH</span>
        </div>
        <div class="mm-sys">
          <button class="mm-sysbtn" data-menu="multiplayer">${ICON_ONLINE}<b>Online</b>${glyph("M", null)}</button>
          <button class="mm-sysbtn" data-menu="settings">${ICON_SETTINGS}<b>Settings</b>${glyph("O", null)}</button>
          <a class="mm-source" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer"
             title="Source on GitHub" aria-label="Source on GitHub">${GITHUB_MARK}</a>
        </div>
      </div>
      <div class="mm-hero"></div>
      <div class="mm-row mm-maps" data-menu="map">
        <div class="mm-cap"><span>Map</span><b class="mm-count"></b></div>
        <div class="mm-strip">
          <button class="mm-nav prev" data-step="-1" aria-label="Previous map">${glyph("Q", "LB")}</button>
          <div class="mm-reel" style="--slim:${CARD_SLIM};--wide:${CARD_WIDE}">${cards}</div>
          <button class="mm-nav next" data-step="1" aria-label="Next map">${glyph("E", "RB")}</button>
        </div>
      </div>
      <div class="mm-row mm-enemy" data-menu="difficulty">
        <div class="mm-cap"><span>Enemy</span><b class="mm-tier-now"></b></div>
        <div class="mm-tiers">${tiers}</div>
      </div>
      <div class="mm-row mm-kitrow" data-menu="loadout">
        <button class="mm-kit">
          <span class="mm-kit-cap">Loadout</span>
          <b class="mm-kit-w">${weapon.name}</b>
          <i class="mm-kit-s">${sight.name}</i>
          ${glyph("L", "Y")}
        </button>
      </div>
      <div class="mm-row mm-go" data-menu="start">
        <button class="mm-deploy">
          <span class="mm-deploy-t"><b>Deploy</b><i>Conquest &middot; vs bots</i></span>
          ${glyph("Enter", "A")}
        </button>
      </div>
      <aside class="mm-intel"></aside>
      <div class="mm-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Move</span>
        <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Change</span>
        <span data-dev="kbm"><kbd>Q</kbd><kbd>E</kbd> Map</span>
        <span data-dev="kbm"><kbd>Enter</kbd> Select</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Navigate</span>
        <span data-dev="pad"><kbd class="pd">LB</kbd><kbd class="pd">RB</kbd> Map</span>
        <span data-dev="pad"><kbd class="pd face-a">A</kbd> Select</span>
      </div>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.refs = {
      hero: q(".mm-hero"),
      reel: q(".mm-reel"),
      cards: Array.from(this.root.querySelectorAll<HTMLElement>(".mm-card")),
      count: q(".mm-count"),
      prev: q(".mm-nav.prev"),
      next: q(".mm-nav.next"),
      tiers: Array.from(this.root.querySelectorAll<HTMLElement>(".mm-tier")),
      tierName: q(".mm-tier-now"),
      kitWeapon: q(".mm-kit-w"),
      kitSight: q(".mm-kit-s"),
    };
    this.detailEl = q(".mm-intel");
    this.heroMap = -1;
    this.bindMenu();
    this.fillReel(maps);
    this.patchMenu(opts);
  }

  /**
   * Writes a changed `MenuState` over the card that is already up — the
   * values, never the structure. Classes on elements that exist, text on
   * elements that exist, and the hero, which is the one block that is
   * REPLACED, because replacing it is how its swap animation replays.
   */
  private patchMenu(opts: MenuState): void {
    const refs = this.refs;
    if (!refs) return;
    const { maps, selectedMap, selected } = opts;
    refs.cards.forEach((c, i) => c.classList.toggle("on", i === selectedMap));
    refs.count.textContent = `${twoDigits(selectedMap + 1)} / ${twoDigits(maps.length)}`;
    // `Game.setMap` CLAMPS, so an arrow at either end answers nothing — and
    // an arrow that looks live and does nothing is worse than one that says
    // it has run out of row.
    refs.prev.classList.toggle("off", selectedMap <= 0);
    refs.next.classList.toggle("off", selectedMap >= maps.length - 1);
    refs.tiers.forEach((t, i) => {
      t.classList.toggle("on", i === selected);
      // A tier's pips are lit up to its OWN rank, so the row is a ladder;
      // the chosen tier is the one filled, not the one with the most pips.
      t.querySelectorAll("s").forEach((s, k) => s.classList.toggle("lit", k <= i));
    });
    refs.tierName.textContent = opts.difficulties[selected] ?? "";
    refs.kitWeapon.textContent = CONFIG.weapons[opts.weapon].name;
    refs.kitSight.textContent = CONFIG.sights[opts.sight].name;
    if (this.heroMap !== selectedMap) {
      const swap = this.heroMap >= 0;
      this.heroMap = selectedMap;
      refs.hero.innerHTML = this.heroMarkup(maps[selectedMap], selectedMap, swap);
      this.centreReel(swap);
    }
  }

  /**
   * The hero: the chosen map's name, set as the title of the screen, over the
   * mode, a line about the place and the three figures that tell two maps
   * apart. `swap` is a map CHANGE rather than a raise — it slides the new name
   * in, where a raise leaves the arrival to the card's own entrance.
   */
  private heroMarkup(map: MapDef | undefined, index: number, swap: boolean): string {
    if (!map) return "";
    const size = map.layout.size ?? CONFIG.map.size;
    const fog = map.environment.fogEnd;
    // How many a side is the MAP's (`MapLayout.perTeam`): a card that drew
    // CONFIG's default would promise 8 v 8 on the maps that field 24.
    const per = perTeamOf(map.layout);
    return `
      <div class="mm-hero-in${swap ? " swap" : ""}">
        <span class="mm-index" aria-hidden="true">${twoDigits(index + 1)}</span>
        <span class="mm-mode">Conquest &middot; ${per} v ${per} &middot; ${CONFIG.teams[0].name} vs ${CONFIG.teams[1].name}</span>
        <h1 class="mm-title">${map.name}</h1>
        <p class="mm-blurb">${map.blurb}</p>
        <div class="mm-facts">
          <span><b>${map.layout.controlPoints.length}</b> points</span>
          <span><b>${size} m</b> across</span>
          <span><b>${fog >= size ? "Clear" : `${Math.round(fog)} m`}</b> visibility</span>
        </div>
      </div>`;
  }

  /**
   * Hangs the pointer on the controls. Once per BUILD, because a patch keeps
   * every element and therefore every handler.
   *
   * Two edges, and which one is the rule rather than taste: a control that
   * only CHANGES a value on this card (a map card, a reel arrow, a tier) is an
   * ordinary click on the way up, and one that LEAVES the card (the kit, the
   * system bar, Deploy) goes on pointer-DOWN, the edge every button in the
   * interface that leaves a screen uses.
   */
  private bindMenu(): void {
    const refs = this.refs;
    if (!refs) return;
    refs.cards.forEach((c) => {
      c.onclick = () => this.onMap(Number(c.dataset.map));
    });
    for (const nav of [refs.prev, refs.next]) {
      nav.onclick = () => this.stepMap(Number(nav.dataset.step));
    }
    refs.tiers.forEach((t) => {
      t.onclick = () => this.onDifficulty(Number(t.dataset.tier));
    });
    const leave: [string, () => void][] = [
      ["button.mm-kit", () => this.onOpenLoadout()],
      ['button[data-menu="settings"]', () => this.onOpenSettings()],
      ['button[data-menu="multiplayer"]', () => this.onOpenMultiplayer()],
      ["button.mm-deploy", () => this.onStart()],
    ];
    for (const [sel, fire] of leave) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (el) el.onpointerdown = fire;
    }
    // The cursor's rows are collected from the markup rather than kept in
    // step by hand, so a row added only has to name itself in `MENU_ITEMS`.
    this.menuEls.clear();
    this.root.querySelectorAll<HTMLElement>("[data-menu]").forEach((el) => {
      const item = el.dataset.menu as MenuItem;
      this.menuEls.set(item, el);
      // Hovering moves the cursor with it, so the highlighted row and the one
      // Enter is about to fire can never disagree — the rule the pause list,
      // the kit screen's slots and the settings rows all follow.
      el.onmouseenter = () => this.setMenuSelection(MENU_ITEMS.indexOf(item));
    });
  }

  /**
   * Puts each map's photograph on its card, as each thumbnail arrives.
   *
   * The downscale is `shotThumbUrl`'s and is made once a session, so after
   * the first raise this answers on a resolved promise. A card whose map has
   * no photograph keeps its plate, which is the drawing of a map nobody has
   * photographed yet rather than a broken card.
   */
  private fillReel(maps: readonly MapDef[]): void {
    const refs = this.refs;
    if (!refs) return;
    maps.forEach((m, i) => {
      void shotThumbUrl(m.id)?.then((url) => {
        const card = this.refs?.cards[i];
        if (card) card.style.backgroundImage = `url("${url}")`;
      });
    });
  }

  /**
   * Scrolls the reel so the chosen card is in the middle of it — which on a
   * viewport wide enough for the whole reel is no scroll at all.
   *
   * The target is computed from where the cards will END UP rather than
   * measured, because the chosen card is still opening (and the last one
   * still closing) when this runs: a measurement taken now centres the reel
   * on a width that is about to change. The card's HEIGHT does not
   * transition, and `CARD_SLIM`/`CARD_WIDE` turn it into both widths.
   */
  private centreReel(smooth: boolean): void {
    const refs = this.refs;
    const card = refs?.cards[this.mapIndex];
    if (!refs || !card) return;
    const reel = refs.reel;
    const h = card.offsetHeight;
    const gap = parseFloat(getComputedStyle(reel).columnGap) || 0;
    const left = this.mapIndex * (h * CARD_SLIM + gap);
    const target = left + (h * CARD_WIDE) / 2 - reel.clientWidth / 2;
    reel.scrollTo({ left: Math.max(0, target), behavior: smooth ? "smooth" : "auto" });
  }

  /**
   * The panel beside the column — the INTEL on whatever the cursor rests on.
   *
   * A front end for a game with five decisions on it is a short column and a
   * great deal of leftover window, and the window is mostly the photograph,
   * which is the point of it. What is left is spent here: the map's PLAN (the
   * one thing the photograph cannot tell you — where the flags are), what an
   * enemy tier is like to fight, what the kit in your hands does. It is not a
   * control, which is why it is the thing a viewport without room for it
   * drops; the hero carries the map's own figures either way.
   *
   * It is REDRAWN on every cursor move and nothing else on the card is: it
   * has neither a listener nor a transition on it, so a rewrite costs a
   * layout of one box and nothing that can be seen going wrong.
   */
  private drawDetail(): void {
    const el = this.detailEl;
    if (!el) return;
    const item = MENU_ITEMS[this.menuIndex];
    const map = this.maps[this.mapIndex];
    let html = "";
    switch (item) {
      case "map":
      case "start":
        html = map ? this.mapDetail(map) : "";
        break;
      case "difficulty":
        html = this.tierDetail();
        break;
      case "loadout":
        html = this.kitDetail();
        break;
      case "settings":
        html = detailBlock(
          "Options",
          "Settings",
          "Look speed for mouse, stick and thumb; how much of the screen the " +
            "renderer is given; the mix; and the full control map for all three.",
        );
        break;
      case "multiplayer":
        html = detailBlock(
          "Online",
          "Multiplayer",
          `Browse what every region is running, or start a match of your own. ` +
            `Every seat nobody is sitting in is a bot, and it stands up again ` +
            `when they leave.`,
        );
        break;
    }
    el.innerHTML = `<div class="mm-intel-in">${html}</div>`;
    this.paintThumb();
  }

  /**
   * The map's intel: its PLAN, with the five flags and both sides' deploy
   * points on it, and a key to the two marks that are not self-evident.
   * Offered on the map row and on Deploy, which is the panel a player who
   * presses A the moment the title appears is looking at.
   */
  private mapDetail(map: MapDef): string {
    const mine = CONFIG.teams[0];
    const theirs = CONFIG.teams[1];
    return `
      ${detailHead("Tactical map", map.name)}
      <div class="ov-thumb"><canvas></canvas></div>
      <div class="mm-legend">
        <span><i class="dia" style="--c:${mine.color}"></i>${mine.name}</span>
        <span><i class="dia" style="--c:${theirs.color}"></i>${theirs.name}</span>
        <span><i class="hex"></i>Control point</span>
      </div>
    `;
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
        [`${this.perSide()}`, "Per side"],
        [`${Math.round(t.centre * 100)}%`, "Skill band"],
      ])}
    `;
  }

  /**
   * How many bodies a side the CHOSEN map fields. It belongs to the map
   * rather than to the tier — a rookie squad and an ace squad are the same
   * twenty-four bodies on Sarab and the same eight on Hollowmere.
   */
  private perSide(): number {
    const map = this.maps[this.mapIndex];
    return map ? perTeamOf(map.layout) : CONFIG.bots.perTeam;
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
   * Paints the map schematic, if the panel that is up has one in it.
   *
   * Separate from the markup because a canvas is not markup: it has to be
   * drawn AFTER the element is in the document and has been laid out, since
   * `drawMapThumb` sizes its backing store from the box it was given — and a
   * panel the viewport has dropped has no box, which `drawMapThumb` answers
   * by drawing nothing. The resize handler paints it again if it comes back.
   *
   * **The paint is synchronous and NEITHER of the map's two bulk halves may be
   * here yet, which is why this can run three times for one row.** The
   * heightfield and the collider bake are chunks of their own
   * (`MapDef.heights`, `MapDef.collision`), so the first paint draws whatever
   * has already landed, which on a cold boot is neither, and each arrival
   * books another. What the player sees is a bare square, then the ground it
   * is cut in, then the town on it; see `MapThumb.ts` for why that order is
   * the honest one.
   *
   * The map is re-tested inside every callback because the cursor moves
   * faster than a fetch: a floor arriving for the map the player has already
   * stepped off must not repaint the one they are looking at now.
   */
  private paintThumb(): void {
    const canvas = this.detailEl?.querySelector("canvas");
    const map = this.maps[this.mapIndex];
    if (!canvas || !map) return;
    const floor = heightsOf(map);
    const bake = collisionOf(map);
    drawMapThumb(canvas, map, floor ?? null, bake ?? null);
    // A schematic is not worth a broken menu, so both rejections are
    // swallowed: the round start asks for the same two chunks and reports the
    // failure where it can be acted on.
    const again = () => {
      if (this.maps[this.mapIndex] === map) this.paintThumb();
    };
    if (floor === undefined) void loadHeights(map).then(again).catch(() => {});
    if (bake === undefined) void loadCollision(map).then(again).catch(() => {});
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
   * be resting on — so this is called exactly when the answer changes.
   *
   * It waits for the image to DECODE before swapping. A fade into a layer the
   * browser has not finished decoding is a fade into a blank rectangle and
   * then a pop, which on a cold boot is every first visit to this screen; the
   * cost of waiting is that the very first backdrop arrives a frame or two
   * after the card it is behind, which is the harmless half of the trade.
   *
   * The `shotUrl` guard is what makes stepping quickly along the reel safe:
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
    // fall back TO but the scrim the picture is already under — so the last
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
   * The round-over card's Deploy button, and the ONLY thing on that card a
   * pointer can start a round with. The menu's own is bound in `bindMenu`,
   * with the card's other controls.
   *
   * POINTERDOWN, the same edge every button here that leaves the screen uses.
   */
  private bindStart(): void {
    const btn = this.root.querySelector<HTMLElement>("button.ov-start");
    if (btn) btn.onpointerdown = () => this.onStart();
  }

  /**
   * Which device's prompts to draw. A class on the card, compared before it
   * is written, so `Game` can push it every frame; every prompt on the card
   * turns over on that one write because the stylesheet picks the label.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    if (this.card !== "menu") return;
    for (const d of ["kbm", "pad", "touch"] as const) {
      this.root.classList.toggle(`dev-${d}`, d === device);
    }
  }

  /** Steps the menu cursor around its ring. No-op off the menu card. */
  moveMenuSelection(delta: number): void {
    if (this.menuEls.size === 0) return;
    const n = MENU_ITEMS.length;
    this.setMenuSelection((this.menuIndex + delta + n) % n);
  }

  /**
   * Turns the map reel, from wherever the cursor is — the bumpers, Q/E, and
   * the reel's own arrows. `Game.setMap` clamps, so a step off either end is
   * no step. No-op off the menu card.
   */
  stepMap(delta: number): void {
    if (this.menuEls.size === 0) return;
    this.onMap(this.mapIndex + delta);
  }

  /**
   * Left/right on the cursor's row. The two rows with a VALUE step it — the
   * map and the enemy, both clamped, because a slider that jumps from Elite
   * back to Recruit at the end is one you have to watch rather than feel. The
   * system bar is a ROW of two, so left and right walk along it. On the kit
   * and Deploy this is nothing: a horizontal nudge that fired a screen would
   * make the cursor's own edges feel like traps.
   */
  stepMenuItem(delta: number): void {
    if (this.menuEls.size === 0) return;
    switch (MENU_ITEMS[this.menuIndex]) {
      case "difficulty":
        this.onDifficulty(this.tier + delta);
        break;
      case "map":
        this.onMap(this.mapIndex + delta);
        break;
      case "multiplayer":
        if (delta > 0) this.setMenuSelection(MENU_ITEMS.indexOf("settings"));
        break;
      case "settings":
        if (delta < 0) this.setMenuSelection(MENU_ITEMS.indexOf("multiplayer"));
        break;
    }
  }

  /**
   * Fires the cursor's row — Enter / gamepad A.
   *
   * The two value rows CYCLE rather than doing nothing: a confirm that answers
   * nothing is the thing this screen was rebuilt to remove, and with the
   * choice lit, a press that advances to the next says what it did. It WRAPS,
   * unlike left/right, so the button always changes something.
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
   * redraw, so moving down the menu does not restart an animation or drop the
   * hover state under the mouse — the same rule the pause list keeps.
   */
  private applyMenuSelection(): void {
    MENU_ITEMS.forEach((item, i) => {
      this.menuEls.get(item)?.classList.toggle("sel", i === this.menuIndex);
    });
    this.drawDetail();
  }

  /**
   * The round-over card: who holds the map, and what it cost both sides.
   *
   * The result is the SCREEN rather than a line under a title. Two blocks
   * facing each other across a bar, each in its own side's colour, with the
   * reinforcements each has left — which is the number the round was actually
   * decided by, and was a 24 px pair in a strip 600 px wide before this.
   *
   * The two ticket counts arrive in the VIEWER's order — the player's own side
   * first — because the two slots on this card are `mine` and `theirs`, and
   * every player's own side is the amber `CONFIG.teams[0]` whichever slot the
   * authority seated them in. That is why the two names below are indexed
   * literally rather than through `teamLook`: they are the presentation pair,
   * not a team. See `core/teamView.ts`.
   *
   * `state.solo` is "this client is the one deciding what happens next", which
   * offline is always and in a match is never.
   *
   * **A round-over card in a MATCH does not offer to start a round**, and the
   * difference is a button that must not be there rather than one that is
   * dimmed — the same call the HUD's loader row makes for a hull with no gun.
   * The authority owns the rotation: it holds the result up for
   * `ROUND_OVER_MS`, builds the next map and says so with a `roundstart`, and a
   * client that started its own round here would tear the world down under a
   * match that is still running and then offer a deploy screen for a round
   * nobody else is in.
   *
   * **What stands in that button's place is the next MAP, which in a match is
   * the players' even though the round is not.** `state.vote` is the ballot
   * the authority is collecting over that same pause — see `drawNext` — and a
   * match with none (an older server, or a card raised before the first
   * `mapvote` landed) gets the wait line this card carried before there was a
   * vote, which is still exactly what is happening on it.
   */
  showRoundOver(state: RoundOverState): void {
    const { winnerName, playerWon, ticketsMine, ticketsTheirs, mapName } = state;
    this.setCardClass("roundover");
    this.setOverlaid(true);
    this.card = "roundover";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    this.buildBar = null;
    this.clearVote();
    // The bar is the two counts against each other rather than against the
    // ticket pool they started from: a round that ends 142-0 and one that ends
    // 12-0 are not the same round, and the pool is the same number on both
    // sides so the share IS the margin.
    const total = Math.max(1, ticketsMine + ticketsTheirs);
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
                <span>${CONFIG.teams[0].name}</span><b>${ticketsMine}</b>
              </div>
              <div class="ov-split">
                <i class="mine" style="flex:${ticketsMine / total}"></i>
                <i class="theirs" style="flex:${ticketsTheirs / total}"></i>
              </div>
              <div class="side theirs">
                <span>${CONFIG.teams[1].name}</span><b>${ticketsTheirs}</b>
              </div>
            </div>
          </div>
          ${
            state.solo
              ? `<button class="ov-start"><b>Another round</b><i>Enter &middot; A &middot; Start</i></button>`
              : `<div class="ov-next"></div>`
          }
        </div>
      </div>
      <p class="ui-foot">
        <span>${
          state.solo ? `<kbd>Enter</kbd><kbd class="pad">A</kbd> deploy again` : ""
        }</span>
      </p>
    `;
    // A no-op when the button is not there, which is the netplay card: the
    // handler is bound to markup rather than to the screen, so a card without
    // one simply has nothing to bind.
    this.bindStart();
    this.voteFootEl = this.root.querySelector(".ui-foot span");
    this.nextRoot = this.root.querySelector(".ov-next");
    this.drawNext(state.solo ? null : state.vote);
  }

  /**
   * What happens next, drawn into the block the card left for it: the ballot,
   * or the line that stands in for one.
   *
   * Also the FOOTER, because the two say one thing between them - a card
   * offering a vote whose foot reads "the next round starts on its own" is
   * telling the player not to bother with the control above it. Both are
   * rewritten together for that reason and never separately.
   */
  private drawNext(vote: VoteView | null): void {
    // The netplay card only: the offline one says "deploy again" and has no
    // second thing it could be saying.
    if (this.voteFootEl && this.nextRoot) this.voteFootEl.innerHTML = this.footFor(vote);
    const root = this.nextRoot;
    if (!root) return;
    this.voteEls = [];
    this.voteClockEl = null;
    root.innerHTML = "";
    if (!vote) {
      root.className = "ov-next";
      const wait = document.createElement("p");
      wait.className = "ov-wait";
      wait.textContent = "Next map \u00b7 the server is choosing";
      root.appendChild(wait);
      return;
    }
    root.className = "ov-next ov-vote";
    const head = document.createElement("div");
    head.className = "vote-head";
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = "Vote for the next map";
    const clock = document.createElement("b");
    clock.className = "vote-clock";
    head.append(lbl, clock);
    this.voteClockEl = clock;
    // A ROW OF PICKS IS A GRID OF EQUAL SHARES - see `docs/ui.md`. The row is
    // the same equal shares at every width, and the stylesheet turns it into a
    // column on a viewport too narrow for three rather than letting the
    // longest map name decide where it breaks.
    const row = document.createElement("div");
    row.className = "vote-row";
    vote.maps.forEach((name, i) => {
      const cand = document.createElement("button");
      cand.className = "cand";
      // Built rather than written as markup, and the map NAME is why: a
      // candidate this build has no row for is drawn as the id the authority
      // sent, which is a string chosen by whatever is on the far end of the
      // socket. `textContent` is the same answer `cleanName` deliberately
      // leaves to the renderer for the other string this client did not choose.
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = name;
      const bar = document.createElement("i");
      bar.className = "bar";
      bar.appendChild(document.createElement("b"));
      const ct = document.createElement("span");
      ct.className = "ct";
      cand.append(nm, bar, ct);
      // The pointer votes and moves the cursor with it, so a player who clicks
      // and then reaches for the keyboard carries on from where they clicked
      // rather than from wherever the cursor was left.
      cand.addEventListener("click", () => {
        this.voteIndex = i;
        this.applyVoteSelection();
        this.onVote(i);
      });
      row.appendChild(cand);
      this.voteEls.push(cand);
    });
    root.append(head, row);
    this.voteIndex = Math.min(Math.max(this.voteIndex, 0), vote.maps.length - 1);
    this.paintVote(vote);
  }

  /**
   * The foot's one line under a netplay card, which is a different sentence
   * with a ballot on it and without one.
   *
   * A constant either way, which is what makes writing it as MARKUP safe: the
   * key caps are the same `<kbd>` the rest of this screen sets, and nothing
   * interpolated reaches it. The one string on this card that a SERVER chose
   * is a map name, and that goes in through `textContent` next door.
   */
  private footFor(vote: VoteView | null): string {
    return vote
      ? `<kbd>&larr;</kbd><kbd>&rarr;</kbd> choose &middot; <kbd>Enter</kbd><kbd class="pad">A</kbd> vote &middot; most votes takes it`
      : "You keep your slot &mdash; the next round starts on its own";
  }

  /**
   * A new tally from the authority.
   *
   * Redraws the whole block only when the BALLOT itself is different from what
   * is on screen - a late first one, or a client that was welcomed into the
   * middle of a window - and otherwise writes the numbers over the buttons that
   * are already there. Rebuilding on every tally would drop the hover state and
   * restart the bars under a player who is pointing at one, at the wire's own
   * cadence.
   */
  setVote(vote: VoteView): void {
    if (this.card !== "roundover" || !this.nextRoot) return;
    if (this.voteEls.length !== vote.maps.length) {
      this.drawNext(vote);
      return;
    }
    this.paintVote(vote);
  }

  /**
   * The counts, the bars, the cast vote and the leader - everything about the
   * ballot that moves while it is open.
   *
   * The LEADER is drawn because it is the only thing on this card that says
   * what is actually going to happen: a tie and an empty ballot both resolve to
   * the first candidate, which is the map the rotation would have picked
   * anyway, and a player who cannot see that is being asked to vote against
   * something invisible. See `server/MapVote.ts`.
   */
  private paintVote(vote: VoteView): void {
    const total = vote.tally.reduce((a, b) => a + b, 0);
    let lead = 0;
    for (let i = 1; i < vote.tally.length; i++) {
      if ((vote.tally[i] ?? 0) > (vote.tally[lead] ?? 0)) lead = i;
    }
    this.voteEls.forEach((el, i) => {
      const count = vote.tally[i] ?? 0;
      el.classList.toggle("on", i === vote.choice);
      el.classList.toggle("lead", i === lead);
      const ct = el.querySelector(".ct");
      if (ct) ct.textContent = String(count);
      const fill = el.querySelector<HTMLElement>(".bar b");
      // Share of the votes CAST, so the bars answer "who is winning" rather
      // than "how many people are in the match" - a match of four with two
      // votes in it reads the same as a match of sixteen with eight.
      if (fill) fill.style.width = `${total > 0 ? (count / total) * 100 : 0}%`;
    });
    this.setVoteClock(vote.seconds);
    this.applyVoteSelection();
  }

  /** The countdown, which `Game` steps rather than this screen. */
  setVoteClock(seconds: number): void {
    if (this.voteClockEl) this.voteClockEl.textContent = String(Math.max(0, seconds));
  }

  /** Walks the cursor along the ballot. A no-op when there is no ballot up. */
  moveVoteSelection(delta: number): void {
    const n = this.voteEls.length;
    if (n === 0) return;
    this.voteIndex = (this.voteIndex + delta + n) % n;
    this.applyVoteSelection();
  }

  /**
   * Casts the cursor's candidate, and says whether there was one to cast.
   *
   * The return value is what keeps the confirm from falling through to
   * whatever else the card's key would do - the same shape `activateMenu`
   * gives the menu's own confirm.
   */
  activateVote(): boolean {
    if (this.voteEls.length === 0) return false;
    this.onVote(this.voteIndex);
    return true;
  }

  /** Paints the cursor. A class on buttons that already exist, never a redraw. */
  private applyVoteSelection(): void {
    this.voteEls.forEach((el, i) => el.classList.toggle("sel", i === this.voteIndex));
  }

  /** Forgets the ballot's markup. Called wherever the card it lived on goes. */
  private clearVote(): void {
    this.nextRoot = null;
    this.voteEls = [];
    this.voteClockEl = null;
    this.voteFootEl = null;
    this.voteIndex = 0;
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
    this.buildBar = null;
    this.clearVote();
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
    this.buildBar = this.root.querySelector(".ov-bar i");
  }

  /**
   * How much of what the card is covering is done, 0..1 — and until this is
   * called the bar sweeps, which is the state every card before the bake wait
   * left it in.
   *
   * **The build itself cannot report progress and this is not it.** Everything
   * `buildRound` does is one synchronous turn with no frame in it, so a bar
   * measured against the build would be painted once at 0 and once at 1. What
   * this measures is the tail the card now also covers: the reflection bake,
   * which is spent a budget of draws per FRAME and therefore has frames to be
   * painted on. See `Game.bakeWait`.
   *
   * The sweep is dropped on the first call rather than at `showBuilding`,
   * because a map whose bake lands in one frame — all four of the shipped ones
   * — never gets here at all and should not flash a bar at 0 on its way past.
   */
  setBuildProgress(done: number): void {
    const bar = this.buildBar;
    if (!bar || this.card !== "building") return;
    bar.parentElement?.classList.add("measured");
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
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
   *
   * `solo` as `showRoundOver` means it, and it decides one row — see
   * `PAUSE_ITEMS`.
   */
  showPause(solo: boolean): void {
    this.setCardClass("pause");
    this.card = "pause";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    this.buildBar = null;
    this.clearVote();
    const items = PAUSE_ITEMS.filter(([, , soloOnly]) => solo || !soloOnly)
      .map(
        ([action, label]) =>
          `<button class="pact" data-action="${action}">${label}</button>`,
      )
      .join("");
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
   * The round-over card and the building card are full-bleed screens over a
   * scene that is either last round's or nothing at all, and they take the
   * shell's frame and its veil. The MENU takes neither: it is laid out on a
   * grid of its own over a photograph, with a scrim shaped like that layout
   * (`#overlay.card-menu` in `overlay.css`), and it carries the prompt device
   * (`dev-*`) because every prompt on it is picked by the stylesheet. The
   * pause is anchored to one side and scrimmed from that side only, being a
   * lid over a live round the player is coming back to. Setting `className`
   * outright rather than toggling is what stops the previous card's modifier
   * surviving into the next one.
   *
   * `raised` is the menu's entrance and nothing else: the class has to be on
   * the ROOT before the markup is written, because what animates are
   * elements that do not exist yet.
   */
  private setCardClass(
    card: "menu" | "roundover" | "building" | "pause",
    raised = false,
  ): void {
    // Every card but the menu writes over the menu's markup, so the patch
    // path's references die here rather than at each of the three callers.
    if (card !== "menu") this.refs = null;
    this.root.className =
      card === "pause"
        ? "card-pause"
        : card === "menu"
          ? `card-menu dev-${this.device}${raised ? " enter" : ""}`
          : `ui-screen ui-veil card-${card}`;
  }

  /** Takes whichever card is up back down. The single way off all three. */
  hide(): void {
    this.root.className = "hidden";
    this.setOverlaid(false);
    this.clearShot();
    this.detailEl = null;
    this.buildBar = null;
    this.clearVote();
    this.refs = null;
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
