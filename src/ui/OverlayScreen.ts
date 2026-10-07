/**
 * OverlayScreen.ts — The four full-screen cards that stop the game: the main
 * menu, the round-over result, the pause list, and the one that stands over a
 * map being built.
 * Owns: `#overlay` and everything written into it, the menu's and the pause
 * list's selection, `#menu-shot` (the photograph the menu stands on), and the
 * `.overlaid` class on `#hud` that hides the gameplay chrome behind a card. A
 * peer of DeployScreen and LoadoutScreen — Game wires its callbacks
 * (`onStart`, `onDifficulty`, `onMap`, `onOpenLoadout`, `onPauseAction`,
 * `onVote`, `onLeave`) and drives its selection, and it knows nothing about game state
 * beyond what it is handed.
 * Invariants: only one card is up at a time and `hide()` is the single way down
 * from any of them. The menu is BUILT when it is raised and PATCHED on every
 * later `showMenu` — the other three are rewritten whole by each `show*`, the
 * building card patching only its bar and the words over it, the round-over
 * card only its ballot and the pause only its two live figures.
 *
 * One class rather than four because the cards are one element, not four
 * screens that happen to overlap: they share the element, the veil and,
 * between the menu and the round-over card, the Deploy verb. What splitting
 * them would buy is four files that could never be shown together anyway, at
 * the cost of a base class or a duplicated stylesheet. A card that grows its
 * own state — a settings screen with rows to edit, a map picker — has earned a
 * file of its own; a card that is markup and a button has not. The building
 * card and the round-over card both stand in the menu's frame — its lockup,
 * its hero, its backdrop and its intel plate — and the pause takes its hero,
 * its Deploy plate and the round-over card's own-round plate, which is the
 * reason all three are here.
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
import type { MapDef } from "../world/maps";
import { pickFieldNote } from "./fieldNotes";
import { WEAPON_BLURBS } from "./LoadoutScreen";
import { mapShotUrl, shotThumbUrl } from "./mapShots";
import { paintMapThumb } from "./MapThumb";
import { glyph, guessDevice, markDevice, type InputDevice } from "./prompts";

/**
 * What the pause menu can do, and the label for each. In screen order.
 *
 * `settings` sits above the two destructive items on purpose: it is the only
 * one you can pick and come back from, and putting it under "Quit to menu"
 * would file the harmless action below the one that ends the round.
 */
export type PauseAction = "resume" | "settings" | "restart" | "quit";
/**
 * The pause card's column, in screen order: which ACTS are offered in which
 * round. The words on each plate are `pausePlate`'s, since they name the map.
 *
 * "Restart round" is offline only: it is a thing only the side running the
 * simulation may do, and in a match that is not this one. Left in, it read as
 * a way out of a round that was going badly and was instead a client tearing
 * its own world down under an authority that had not heard the key — the same
 * act the round-over card used to offer, arriving through a second door.
 * Leaving is the honest version of what that button was reaching for, and it
 * is on this list in both rounds.
 */
function pauseActions(solo: boolean): PauseAction[] {
  return solo
    ? ["resume", "settings", "restart", "quit"]
    : ["resume", "settings", "quit"];
}

/**
 * Everything the pause card draws itself from — the ROUND it is a pause in.
 *
 * `MenuState`'s shape and reason: an object, so the two flag counts and the
 * board cannot be swapped for each other and still typecheck.
 */
export interface PauseState {
  /** The map the round is on: the card's title, and its number behind it. */
  map: MapDef;
  index: number;
  /** Whether this client runs the round — offline — or is a seat in a match. */
  solo: boolean;
  /** The enemy tier's name offline; null in a match, where it decides nothing. */
  enemy: string | null;
  /** Flags held by the viewer's side, of the map's own count. */
  flagsMine: number;
  /** Every body in the round, unsorted — the card ranks it as the board does. */
  board: readonly BoardRow[];
}

/** The pause card's patchable parts, live only while it is up. */
interface PauseRefs {
  /** The hero's fact strip and the Your round plate — the two live figures. */
  facts: HTMLElement;
  you: HTMLElement;
  /** What each was last written with, so a patch that moved nothing writes nothing. */
  shownFacts: string;
  shownYou: string;
}

/**
 * What the main menu's cursor can rest on.
 *
 * The menu is a LIST a pad steps through — up and down move, left and right
 * change the row the cursor is on, A fires it — and the two dedicated keys
 * (`L`/Y for the kit, the bumpers for the map) are accelerators rather than
 * the only way in, which is what lets a pad reach every row on this screen.
 * Online and Settings have NO key: they are the system bar a mouse clicks and
 * the cursor reaches, and a letter that matched neither label (`M`, `O`) was
 * a prompt nobody could guess.
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
  /**
   * The same candidates by id, indexed alike — for their PHOTOGRAPHS and
   * nothing else. An id this build has no shot for is a plate with no
   * picture on it, which is also what an unknown map is.
   */
  ids: readonly string[];
  /** Votes per candidate, indexed alike. */
  tally: readonly number[];
  /** Which candidate this player has voted for, or -1. */
  choice: number;
  /** Whole seconds left in the window, for the card's own countdown. */
  seconds: number;
}

/**
 * One line of the round's board, as the round-over card ranks it.
 *
 * A view rather than `Scoreboard`'s `ScoreRow`, for `VoteView`'s reason: the card
 * draws SIDES as the viewer sees them (`mine`), never a team index, and has no
 * business with a ping. `name` may be a string a PERSON chose on the far end
 * of a socket, so it only ever reaches the page through `textContent`.
 */
export interface BoardRow {
  name: string;
  /** On the viewer's own side — the amber one, whatever slot seated them. */
  mine: boolean;
  kills: number;
  deaths: number;
  score: number;
  /** The local player's own line. */
  you: boolean;
}

/**
 * Everything the round-over card draws itself from.
 *
 * An object rather than a dozen positional arguments, which is `MenuState`'s
 * reason with more numbers in the row: two ticket counts side by side is a
 * signature where swapping them still typechecks and quietly reports the round
 * backwards, and the flag pair behind them is the same trap twice.
 */
export interface RoundOverState {
  /** The map the round was fought on: its photograph and its number. */
  map: MapDef;
  /** Its place in the rotation, drawn hollow behind the result as the menu does. */
  index: number;
  /** The side holding the map and the side that ran out, named through `teamLook`. */
  winnerName: string;
  loserName: string;
  playerWon: boolean;
  /** The counts in the VIEWER's order — see the method's own note. */
  ticketsMine: number;
  ticketsTheirs: number;
  flagsMine: number;
  flagsTheirs: number;
  /** Every body in the round, unsorted — the card ranks it. */
  board: readonly BoardRow[];
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
 * What the building card is told about the round it stands over. Everything
 * on it is known BEFORE the build starts — which is the only kind of thing the
 * card may carry, since it is painted on the frames before the main thread
 * stops (`showBuilding`).
 */
export interface BuildingState {
  /** The map being built — its name is the card's title. */
  map: MapDef;
  /** Its place in the rotation, drawn hollow behind the name as the menu does. */
  index: number;
  weapon: PrimaryWeaponId;
  sight: SightId;
  /**
   * The enemy tier's name offline, and null in a match, where the bots are the
   * authority's to field and the tier on this machine's menu decides nothing.
   */
  enemy: string | null;
}

/** The building card's patchable parts, live only while it is up. */
interface BuildRefs {
  map: MapDef;
  bar: HTMLElement;
  word: HTMLElement;
  stage: HTMLElement;
  pct: HTMLElement;
  /** The last figure written, so a frame that moved nothing writes nothing. */
  shown: number;
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
 *
 * It is also the AGPL's section 13 offer: a MODIFIED version that people play
 * over a network owes them ITS source. A fork must point this at its own
 * repository, or its players are offered code that is not what they are
 * playing.
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

/** The pause's Restart round: the round going back round to its start. */
const ICON_RESTART = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 3.5v4.5h4.5"/></svg>`;

/** The way OUT, as the kit, settings and lobby screens draw their Back. */
const ICON_BACK =`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"><path d="M15 5l-7 7 7 7"/></svg>`;

/**
 * How many lines of the board the round-over card's intel plate ranks. The
 * player's own line is added under them when it did not make the cut, since
 * where YOU finished is the one line every player reads first.
 */
const BOARD_ROWS = 8;

/** A 1-based index as two digits: the reel's counter and the hero's numeral. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** A place on the board in words: 1st, 2nd, 3rd, 11th, 22nd. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

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

/** A named pick under a caption — the optic under a weapon, a side's kit. */
function slot(eyebrow: string, name: string, note: string): string {
  return `<div class="ov-slot"><span class="ui-eyebrow">${eyebrow}</span><b>${name}</b><i>${note}</i></div>`;
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
  /**
   * The pause card's column, live only while it is up — the rows die with its
   * markup. Each is the UNCLIPPED wrapper the cursor's brackets hang on, in
   * the order of `pauseActs`.
   */
  private pauseRows: HTMLElement[] = [];
  private pauseActs: PauseAction[] = [];
  private pauseIndex = 0;
  /** The pause card's live figures, same lifetime. */
  private pauseRefs: PauseRefs | null = null;
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
   * The building card's bar and its stage line, live only while that card is
   * up. Held rather than re-queried because they are written on a frame the
   * main thread is otherwise spending on the bake — see `setBuildProgress`.
   */
  private build: BuildRefs | null = null;
  /** The field note the last building card told, so the next one differs. */
  private lastNote: string | null = null;
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
   * Wired by Game: the player asked to leave the round-over card for the main
   * menu — which in a match is leaving the MATCH, the same act as the pause
   * list's Quit to menu.
   */
  onLeave: () => void = () => {};

  /**
   * The block at the foot of the column that says what happens next — the
   * ballot, or the wait plate that stands in for one. Null on every other card
   * and on a round-over card this client is deciding for itself.
   *
   * Held because the ballot can arrive AFTER the card is raised: an older
   * server sends none at all, and a client that joined mid-window is welcomed
   * before it is handed one. Redrawing this block is how a late ballot lands,
   * and it is the block rather than the card so the result above it does not
   * flicker under the player.
   */
  private nextRoot: HTMLElement | null = null;
  /**
   * The candidates, in ballot order, or empty when there is no ballot. Each
   * is the UNCLIPPED wrapper round a candidate's plate, because the cursor's
   * brackets are drawn outside the plate's cut corners and a `clip-path`
   * would take them off with the corner.
   */
  private voteEls: HTMLElement[] = [];
  /** The countdown's own element, written by `setVoteClock` alone. */
  private voteClockEl: HTMLElement | null = null;
  /**
   * The foot, which says how to vote while there is a vote to cast and is
   * empty otherwise — a card with one button on it needs no hint line.
   */
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
   * player work out which of them was theirs. **A prompt ON a control is a key
   * that fires THAT control wherever the cursor is**, and the cursor's own verbs
   * (move, change, select) are the foot's — so Deploy carries the pad's Start
   * and no key at all, because Enter and A fire the CURSOR's row, and the cursor
   * follows the mouse onto whatever it crosses.
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
          <button class="mm-sysbtn" data-menu="multiplayer">${ICON_ONLINE}<b>Online</b></button>
          <button class="mm-sysbtn" data-menu="settings">${ICON_SETTINGS}<b>Settings</b></button>
          <a class="mm-source" href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer"
             title="Source (AGPL-3.0)" aria-label="Source code (AGPL-3.0)">${GITHUB_MARK}</a>
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
          ${glyph(null, "Start")}
        </button>
      </div>
      <aside class="mm-intel"></aside>
      <div class="mm-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Move</span>
        <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Change</span>
        <span data-dev="kbm"><kbd>Enter</kbd> Select</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Navigate</span>
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
   * The map's two bulk halves may not be here yet, so this can run three
   * times for one row: `paintMapThumb` draws what has landed and calls back as
   * each half arrives. The map is re-tested inside that callback because the
   * cursor moves faster than a fetch: a floor arriving for the map the player
   * has already stepped off must not repaint the one they are looking at now.
   */
  private paintThumb(): void {
    const canvas = this.detailEl?.querySelector("canvas");
    const map = this.maps[this.mapIndex];
    if (!canvas || !map) return;
    paintMapThumb(canvas, map, () => {
      if (this.maps[this.mapIndex] === map) this.paintThumb();
    });
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
    // Raised by the fact of being called: the menu, the building card and the
    // round-over card are the only three that call this (the lobby reaches it
    // through `showBackdrop`, over the menu), and the pause calls `clearShot`.
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
   * The backdrop, asked for by the LOBBY: the photograph of the map the lobby's
   * cursor is on, cross-faded exactly as a map step on the menu is.
   *
   * Public because the lobby is the one other screen that stands on the
   * picture — it is only ever raised over the menu, whose backdrop is already
   * up behind it — and one backdrop with one cross-fade is the whole reason
   * this is a call rather than a second copy of the layers. It raises nothing
   * the menu had not raised, and it is undone for free: the menu is redrawn on
   * the lobby's way out, and `showMenu` puts its own map back.
   */
  showBackdrop(map: MapDef | undefined): void {
    if (this.card !== "menu") return;
    this.setShot(map);
  }

  /**
   * Takes the backdrop down — the container, not the layers, so coming back to
   * the menu on the same map brings the same picture back without re-decoding
   * or re-fading it.
   *
   * The pause calls this, and `hide`: what a pause stands over is a live
   * round, and a photograph of a map behind the round
   * you are playing on it is two of the same place at once.
   */
  private clearShot(): void {
    this.shotRoot.classList.remove("on");
  }

  /**
   * Which device's prompts to draw. A class on the card, compared before it
   * is written, so `Game` can push it every frame; every prompt on the card
   * turns over on that one write because the stylesheet picks the label.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    if (this.card !== "menu" && this.card !== "roundover" && this.card !== "pause") return;
    markDevice(this.root, device);
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
   * The round-over card — a title screen for the RESULT, laid out as the menu
   * is and standing in its frame.
   *
   * **The result is the title, and the map it was fought on is the picture
   * behind it.** VICTORY or DEFEAT, set as the menu sets a map's name and in
   * the colour of the side that holds the ground — the one saturated word on
   * the card, because COLOUR MEANS OWNERSHIP — over the photograph of the
   * place, the map's own number hollow behind it. It used to be a green word
   * in the corner of a black veil with the result in a box in the middle, which
   * is a dialog telling a player what a game should be SHOWING them.
   *
   * **The column is what the round came to, read top to bottom**: the two
   * sides' reinforcements facing each other across the margin they finished
   * on, then the player's own round (where they placed, what they scored),
   * then what happens NEXT — which is the only control on the card, at the
   * foot of the column where the menu keeps Deploy. The intel plate on the
   * right is the top of the BOARD, because the Tab board belongs to the round
   * (`ScreenStack`'s `inRound`) and this is the one screen after it that can
   * say who did the work; it is the first thing a small viewport drops, and
   * the player's own line never leaves with it.
   *
   * The ticket counts arrive in the VIEWER's order — the player's own side
   * first — because the two sides on this card are `mine` and `theirs`, and
   * every player's own side is the amber `CONFIG.teams[0]` whichever slot the
   * authority seated them in. That is why the two names in the result plate
   * are indexed literally rather than through `teamLook`: they are the
   * presentation pair, not a team. See `core/teamView.ts`.
   *
   * **A round-over card in a MATCH does not offer to start a round**, and the
   * difference is a button that must not be there rather than one that is
   * dimmed — the same call the HUD's loader row makes for a hull with no gun.
   * The authority owns the rotation: it holds the result up for
   * `ROUND_OVER_MS`, builds the next map and says so with a `roundstart`, and a
   * client that started its own round here would tear the world down under a
   * match that is still running and then offer a deploy screen for a round
   * nobody else is in. What stands in that button's place is the next MAP,
   * which in a match is the players' even though the round is not — see
   * `drawNext`.
   *
   * **The way OUT is the system corner, in both rounds** — Main menu offline,
   * Leave match in one, on Esc and B wherever the cursor is. The card had no
   * way off it at all: offline the only door was another round, and a phone,
   * with no Escape key, could not leave a match from here.
   *
   * Built on the raise and never rewritten: the ballot is the one block that
   * changes under it, and it is patched (`setVote`).
   */
  showRoundOver(state: RoundOverState): void {
    const { map, playerWon, ticketsMine, ticketsTheirs } = state;
    this.setCardClass("roundover", true);
    this.setOverlaid(true);
    this.card = "roundover";
    this.menuEls.clear();
    this.detailEl = null;
    this.build = null;
    this.clearVote();
    // The photograph of the ground that was fought over, which is also what
    // the building card for another round on it stands on — so pressing the
    // button leaves the picture where it is. Until a different map's picture
    // has decoded, the last one must not stand behind this one's result.
    if (mapShotUrl(map.id) !== this.shotUrl) {
      this.shotLayers[this.shotFront].classList.remove("on");
    }
    this.setShot(map);
    const mine = CONFIG.teams[0];
    const theirs = CONFIG.teams[1];
    const per = perTeamOf(map.layout);
    const flags = map.layout.controlPoints.length;
    let killsMine = 0;
    let killsTheirs = 0;
    for (const r of state.board) {
      if (r.mine) killsMine += r.kills;
      else killsTheirs += r.kills;
    }
    // The bar is the two counts against each other rather than against the
    // ticket pool they started from: a round that ends 142-0 and one that ends
    // 12-0 are not the same round, and the pool is the same number on both
    // sides so the share IS the margin.
    const total = Math.max(1, ticketsMine + ticketsTheirs);
    const margin = ticketsMine - ticketsTheirs;
    this.root.innerHTML = `
      <div class="mm-top">
        <div class="mm-brand">
          <span class="mm-kicker">Cel-shaded conquest</span>
          <span class="mm-word">GREYWATCH</span>
        </div>
        <div class="mm-sys">
          <button class="mm-sysbtn ro-leave">${ICON_BACK}<b>${state.solo ? "Main menu" : "Leave match"}</b>${glyph("Esc", "B")}</button>
        </div>
      </div>
      <div class="mm-hero">
        <div class="mm-hero-in ro-hero ${playerWon ? "won" : "lost"}">
          <span class="mm-index" aria-hidden="true">${twoDigits(state.index + 1)}</span>
          <span class="mm-mode">Round over &middot; ${map.name} &middot; ${per} v ${per}</span>
          <h1 class="mm-title">${playerWon ? "Victory" : "Defeat"}</h1>
          <p class="mm-blurb">${state.loserName} ran out of reinforcements. ${state.winnerName} hold ${map.name}.</p>
          <div class="mm-facts">
            <span><b>${state.flagsMine} of ${flags}</b> flags held</span>
            <span><b>${killsMine} &ndash; ${killsTheirs}</b> kills</span>
          </div>
        </div>
      </div>
      <div class="ro-plate ro-result">
        <div class="ro-cap">
          <span>Reinforcements</span>
          <b class="${margin >= 0 ? "up" : "down"}">${margin > 0 ? "+" : ""}${margin}</b>
        </div>
        <div class="ro-sides">
          <div class="side mine"><span>${mine.name}</span><b>${ticketsMine}</b></div>
          <div class="ro-split">
            <i class="mine" style="flex:${ticketsMine / total}"></i>
            <i class="theirs" style="flex:${ticketsTheirs / total}"></i>
          </div>
          <div class="side theirs"><span>${theirs.name}</span><b>${ticketsTheirs}</b></div>
        </div>
      </div>
      ${this.yourRound(state.board)}
      ${
        state.solo
          ? `<div class="mm-go sel ro-next">
              <button class="mm-deploy ro-again">
                <span class="mm-deploy-t"><b>Another round</b><i>${map.name} &middot; conquest</i></span>
                ${glyph("Enter", "A")}
              </button>
            </div>`
          : `<div class="ro-next"></div>`
      }
      <aside class="mm-intel">
        <div class="mm-intel-in">
          ${detailHead("Scoreboard", "Top of the board")}
          ${this.boardMarkup(state.board)}
        </div>
      </aside>
      <div class="mm-foot ro-foot"></div>
    `;
    this.fillBoardNames(state.board);
    // POINTERDOWN for both, the edge every control in the interface that
    // LEAVES a screen uses. Another round is absent from a match's card, which
    // is what keeps a click from starting a round the authority never asked
    // for; `Game.onStart` refuses one anyway.
    const again = this.root.querySelector<HTMLElement>("button.ro-again");
    if (again) again.onpointerdown = () => this.onStart();
    const leave = this.root.querySelector<HTMLElement>("button.ro-leave");
    if (leave) leave.onpointerdown = () => this.onLeave();
    this.voteFootEl = this.root.querySelector(".ro-foot");
    this.nextRoot = state.solo ? null : this.root.querySelector(".ro-next");
    this.drawNext(state.solo ? null : state.vote);
  }

  /**
   * The board, ranked the way the Tab board ranks it — by POINTS, since a
   * round is won on flags and the player who took three of them did more for
   * it than the one with four more kills (see `ScoreRow.score`).
   */
  private rankBoard(board: readonly BoardRow[]): BoardRow[] {
    return [...board].sort(
      (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths,
    );
  }

  /**
   * The player's own round: where they placed and what they did. Absent for
   * a player with no line on the board.
   */
  private yourRound(board: readonly BoardRow[]): string {
    const inner = this.yourRoundInner(board, "Your round");
    return inner ? `<div class="ro-plate ro-you">${inner}</div>` : "";
  }

  /**
   * What is ON that plate, which the pause card draws too — the same round,
   * asked about while it is still going. Empty for a player with no line.
   */
  private yourRoundInner(board: readonly BoardRow[], caption: string): string {
    const ranked = this.rankBoard(board);
    const at = ranked.findIndex((r) => r.you);
    if (at < 0) return "";
    const you = ranked[at];
    return `
        <div class="ro-cap"><span>${caption}</span><b class="place">${ordinal(at + 1)} of ${ranked.length}</b></div>
        <div class="ro-figs">
          <div><b>${you.score}</b><span>Points</span></div>
          <div><b>${you.kills}</b><span>Kills</span></div>
          <div><b>${you.deaths}</b><span>Deaths</span></div>
        </div>`;
  }

  /**
   * The top of the board as the intel plate draws it, with the player's own
   * line under a break when it did not make the cut. The NAMES are left empty
   * here and written by `fillBoardNames`: a person's name is a string chosen
   * on the far end of a socket, and markup is no place for it.
   */
  private boardMarkup(board: readonly BoardRow[]): string {
    const ranked = this.rankBoard(board);
    const at = ranked.findIndex((r) => r.you);
    const line = (r: BoardRow, place: number) =>
      `<li class="${r.mine ? "mine" : "theirs"}${r.you ? " you" : ""}">
        <span class="rk">${place}</span><i></i><b class="nm"></b>
        <span>${r.kills}</span><span>${r.deaths}</span><span class="pts">${r.score}</span>
      </li>`;
    const rows = ranked
      .slice(0, BOARD_ROWS)
      .map((r, i) => line(r, i + 1))
      .join("");
    const tail = at >= BOARD_ROWS ? `<li class="gap"></li>${line(ranked[at], at + 1)}` : "";
    return `
      <ol class="ro-board">
        <li class="head"><span>#</span><i></i><b>Name</b><span>K</span><span>D</span><span class="pts">Pts</span></li>
        ${rows}${tail}
      </ol>`;
  }

  /** Writes the board's names into the lines `boardMarkup` left for them. */
  private fillBoardNames(board: readonly BoardRow[]): void {
    const ranked = this.rankBoard(board);
    const at = ranked.findIndex((r) => r.you);
    const names = ranked.slice(0, BOARD_ROWS).map((r) => r.name);
    if (at >= BOARD_ROWS) names.push(ranked[at].name);
    this.root
      .querySelectorAll<HTMLElement>(".ro-board li:not(.head):not(.gap) .nm")
      .forEach((el, i) => {
        el.textContent = names[i] ?? "";
        // The whole name under the pointer, for the plate too narrow to hold it.
        el.title = names[i] ?? "";
      });
  }

  /**
   * What happens next, drawn into the block the card left for it: the ballot,
   * or the plate that stands in for one.
   *
   * Also the FOOT, because the two say one thing between them — the foot
   * carries the ballot's cursor verbs and nothing without one, and the two are
   * rewritten together for that reason and never separately.
   */
  private drawNext(vote: VoteView | null): void {
    if (this.voteFootEl) this.voteFootEl.innerHTML = this.footFor(vote);
    const root = this.nextRoot;
    if (!root) return;
    this.voteEls = [];
    this.voteClockEl = null;
    root.innerHTML = "";
    if (!vote) {
      // A dark plate where the button would be, in the building card's load
      // plate's shape and for its reason: it is not a thing to press, and a
      // hot fill is what this interface uses to say that something is.
      root.className = "ro-next ro-wait";
      root.innerHTML = `
        <b>Next round</b>
        <i>The server is choosing &middot; you keep your slot</i>`;
      return;
    }
    root.className = "ro-next ro-vote";
    const head = document.createElement("div");
    head.className = "mm-cap";
    const lbl = document.createElement("span");
    lbl.textContent = "Vote · next map";
    const clock = document.createElement("b");
    clock.className = "vote-clock";
    head.append(lbl, clock);
    this.voteClockEl = clock;
    // A ROW OF PICKS IS A GRID OF EQUAL SHARES — see `docs/ui.md`. The same
    // equal shares at every width, and the stylesheet changes the COUNT on a
    // viewport too narrow for three rather than letting the longest map name
    // decide where the row breaks.
    const row = document.createElement("div");
    row.className = "ro-cands";
    vote.maps.forEach((name, i) => {
      const wrap = document.createElement("div");
      wrap.className = "ro-cand-w";
      const cand = document.createElement("button");
      cand.className = "ro-cand";
      // Built rather than written as markup, and the map NAME is why: a
      // candidate this build has no row for is drawn as the id the authority
      // sent, which is a string chosen by whatever is on the far end of the
      // socket. `textContent` is the same answer `cleanName` deliberately
      // leaves to the renderer for the other string this client did not choose.
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = name;
      cand.title = name;
      const ct = document.createElement("span");
      ct.className = "ct";
      const tag = document.createElement("em");
      tag.className = "tag";
      tag.textContent = "Your vote";
      const bar = document.createElement("i");
      bar.className = "bar";
      bar.appendChild(document.createElement("b"));
      cand.append(nm, ct, tag, bar);
      // The candidate's own photograph, as the menu's reel and the lobby's
      // plates draw a map: a picture needs no label to be told apart, and the
      // name is still on it for the map nobody has photographed.
      const id = vote.ids[i];
      if (id) {
        void shotThumbUrl(id)?.then((url) => {
          cand.style.backgroundImage = `url("${url}")`;
        });
      }
      // The pointer votes and moves the cursor with it, so a player who clicks
      // and then reaches for the keyboard carries on from where they clicked
      // rather than from wherever the cursor was left. A click rather than a
      // pointer-down: a vote changes a value on this card and leaves nothing.
      cand.addEventListener("click", () => {
        this.voteIndex = i;
        this.applyVoteSelection();
        this.onVote(i);
      });
      wrap.appendChild(cand);
      row.appendChild(wrap);
      this.voteEls.push(wrap);
    });
    root.append(head, row);
    this.voteIndex = Math.min(Math.max(this.voteIndex, 0), vote.maps.length - 1);
    this.paintVote(vote);
  }

  /**
   * The foot's hint line: the ballot's cursor verbs for the device in hand,
   * and nothing on a card without one. A constant either way, which is what
   * makes writing it as MARKUP safe.
   */
  private footFor(vote: VoteView | null): string {
    if (!vote) return "";
    return `
      <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Choose</span>
      <span data-dev="kbm"><kbd>Enter</kbd> Vote</span>
      <span data-dev="pad"><kbd class="pd">D-pad</kbd> Choose</span>
      <span data-dev="pad"><kbd class="pd face-a">A</kbd> Vote</span>
      <span>Most votes takes it</span>`;
  }

  /**
   * A new tally from the authority.
   *
   * Redraws the whole block only when the BALLOT itself is different from what
   * is on screen - a late first one, or a client that was welcomed into the
   * middle of a window - and otherwise writes the numbers over the plates that
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
      // votes in it reads the same as a match of sixteen with eight. A
      // transform rather than a width, so the slide is the compositor's.
      if (fill) fill.style.transform = `scaleX(${total > 0 ? count / total : 0})`;
    });
    this.setVoteClock(vote.seconds);
    this.applyVoteSelection();
  }

  /** The countdown, which `Game` steps rather than this screen. */
  setVoteClock(seconds: number): void {
    if (this.voteClockEl) this.voteClockEl.textContent = `${Math.max(0, seconds)} s`;
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

  /** Paints the cursor. A class on plates that already exist, never a redraw. */
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
   * The card that stands over a map being built — a title screen for the MAP,
   * laid out as the menu is.
   *
   * It exists because building one is ~0.7 s of merges, an occlusion bake and
   * a nav grid on a single frame (several on the two big maps, with the floor's
   * fetch in front of it), and until there was something to put up, the card
   * the player had just confirmed simply froze where it stood and the deploy
   * screen appeared out of it. A hang and a load look identical; the only thing
   * that separates them is whether the game said which it was.
   *
   * **The map is the title, over its own photograph, and it is the MENU's hero
   * exactly** (`heroMarkup`): a player who pressed Deploy on the menu watches
   * the column of decisions go and the same title stay, with the load plate
   * standing where Deploy was. What the rest of the screen is spent on is what
   * a player waiting can READ — a briefing on the round (the rules, their kit,
   * what they are up against) and one field note — because a wait is the one
   * time a front end has the player's attention and nothing for them to do.
   *
   * **Everything on it is PAINTED before the main thread stops, and that is
   * the rule deciding what may be on it at all.** The two frames
   * `Game.startRound` waits are all this card gets: nothing that needs a later
   * frame — a canvas, a decode, a fetch — may be part of what it says. So the
   * intel is text and figures and no schematic, the photograph is only drawn
   * once it is decoded (which it already is when the player came from the
   * menu on the same map), and what moves through the freeze moves on the
   * compositor alone: the bar, the photograph's drift, and nothing else.
   *
   * `setOverlaid` for the same reason the menu calls it — what is under this
   * is either last round's HUD or nothing at all.
   *
   * No button, no cursor, no callbacks: this is the one card the player cannot
   * act on, and it takes itself down (`Game.finishBakeWait` does) rather than
   * waiting to be dismissed. **Called again for the SAME map it is a no-op**,
   * and for a different one — a match whose map moved under the build — it is
   * rewritten without its entrance, because the card was already up.
   */
  showBuilding(state: BuildingState): void {
    const { map } = state;
    if (this.card === "building" && this.build?.map === map) return;
    const raised = this.card !== "building";
    this.setCardClass("building", raised);
    this.setOverlaid(true);
    this.card = "building";
    this.menuEls.clear();
    this.detailEl = null;
    this.clearVote();
    // The backdrop. A picture the layers are already holding (the menu's, on
    // the same map) goes straight back up; any other has to decode first, and
    // until it has, the LAST map's photograph must not stand behind this one's
    // name — so the front layer comes down and the scrim stands over the scene.
    if (mapShotUrl(map.id) !== this.shotUrl) {
      this.shotLayers[this.shotFront].classList.remove("on");
    }
    this.setShot(map);
    const weapon = CONFIG.weapons[state.weapon];
    const sight = CONFIG.sights[state.sight];
    const rules = CONFIG.conquest;
    const per = perTeamOf(map.layout);
    const note = pickFieldNote(map, this.lastNote);
    this.lastNote = note;
    // Offline the enemy is a TIER this player chose; in a match it is whoever
    // the authority fields, and a tier read off this machine's menu would be
    // a claim about a round it decides nothing in.
    const versus =
      state.enemy === null
        ? slot("Match", "Online", "Empty seats are bots")
        : slot("Enemy", state.enemy, "Bots");
    this.root.innerHTML = `
      <div class="mm-top">
        <div class="mm-brand">
          <span class="mm-kicker">Cel-shaded conquest</span>
          <span class="mm-word">GREYWATCH</span>
        </div>
      </div>
      <div class="mm-hero">${this.heroMarkup(map, state.index, false)}</div>
      <div class="bd-load">
        <div class="bd-load-t">
          <b class="bd-word">Building</b>
          <i class="bd-stage">Terrain &middot; structures &middot; routes</i>
        </div>
        <span class="bd-pct"></span>
        <div class="ov-bar"><i></i></div>
      </div>
      <aside class="mm-intel">
        <div class="mm-intel-in">
          ${detailHead("Briefing", "Conquest")}
          <p class="ov-blurb">Hold more flags than the enemy and their tickets
            bleed &mdash; ${rules.bleedPerFlagDeficit} every ${rules.bleedInterval} s
            for each flag they are behind. Every death costs a ticket, and the
            side that runs out first loses.</p>
          ${facts([
            [`${rules.tickets}`, "Tickets"],
            [`${map.layout.controlPoints.length}`, "Flags"],
            [`${per} v ${per}`, "Bodies"],
          ])}
          <div class="bd-slots">
            ${slot("Loadout", weapon.name, `${sight.name} &middot; ${sight.magnification.toFixed(1)}&times;`)}
            ${versus}
          </div>
        </div>
      </aside>
      <div class="bd-note">
        <span class="bd-note-cap">Field note</span>
        <p>${note}</p>
      </div>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.build = {
      map,
      bar: q(".ov-bar i"),
      word: q(".bd-word"),
      stage: q(".bd-stage"),
      pct: q(".bd-pct"),
      shown: -1,
    };
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
   * painted on. See `Game.bakeWait`. So the plate says so — its words turn
   * from the build to the LIGHT the moment a figure exists, because a
   * percentage under "Building" would be a claim about the wrong work.
   *
   * The sweep is dropped on the first FIGURE rather than at `showBuilding` or
   * on the first call, because a map whose bake lands in one frame never gets
   * here at all, and one that does always arrives reporting nothing done yet —
   * neither should stop the bar to show a zero on its way past.
   */
  setBuildProgress(done: number): void {
    const build = this.build;
    if (!build || this.card !== "building") return;
    const pct = Math.round(Math.min(1, Math.max(0, done)) * 100);
    if (pct === build.shown) return;
    // The words turn on the first call, because the work has; the FIGURE
    // waits for one that is not zero. The first frame of a bake always
    // reports none of it done, and a probe can take several frames — so a
    // bar that stopped sweeping to show "0%" would stand still over work that
    // is going on, which is the look this card exists to avoid.
    if (build.shown < 0) {
      build.word.textContent = "Lighting";
      build.stage.textContent = "Reflections";
    }
    build.shown = pct;
    if (pct === 0) return;
    build.bar.parentElement?.classList.add("measured");
    build.bar.style.width = `${pct}%`;
    build.pct.textContent = `${pct}%`;
  }

  /**
   * The pause card — a title screen for the ROUND it holds.
   *
   * **The title is the MAP the round is on**, set where the menu and the
   * building card set it, with its number hollow behind: the round is what a
   * pause is about, and the old heading's largest word was the card's own name
   * ("PAUSED"), which is what a form says. What the card IS goes in the
   * eyebrow over the title, and that is the one line that has to differ
   * between the two rounds: offline the world is HELD, and in a match nothing
   * is (`docs/states.md`), so the card says the match is live rather than
   * promising a hold that is not happening.
   *
   * **It still does not take the screen.** It deliberately does NOT call
   * `setOverlaid`, and its scrim falls off from the left before the middle of
   * the window: the menu and the round-over card hide the gameplay chrome
   * because what is under them is last round's, and under a pause everything
   * on screen is this round's — the tickets, the flags, the body you were
   * lining up. `#hud.paused`, which the HUD raises and not this, takes away
   * only what would be lying.
   *
   * **The column is the round, then what you can do about it**: the hero's
   * figures (flags held, the enemy), the player's own round as the round-over
   * card draws it, then the acts. Resume is first and is the hot plate — it is
   * what Esc and B do from anywhere, and what a confirm on arrival must do —
   * then Settings, the one act you come back from, then the two that end the
   * round. Resume is the way BACK and it is a row rather than a system corner,
   * the one place this card differs from the others (`docs/ui.md` says why).
   *
   * Built on the raise, with the entrance; the two live figures are patched
   * after (`setPauseRound`), which only a match has any reason to call.
   */
  showPause(state: PauseState): void {
    this.setCardClass("pause", true);
    this.card = "pause";
    this.clearShot();
    this.menuEls.clear();
    this.detailEl = null;
    this.build = null;
    this.clearVote();
    const { map, solo } = state;
    const per = perTeamOf(map.layout);
    this.pauseActs = pauseActions(solo);
    this.root.innerHTML = `
      <div class="mm-hero ps-hero">
        <div class="mm-hero-in${solo ? "" : " live"}">
          <span class="mm-index" aria-hidden="true">${twoDigits(state.index + 1)}</span>
          <span class="mm-mode">${solo ? "Paused" : "Match live"} &middot; Conquest &middot; ${per} v ${per}</span>
          <h1 class="mm-title">${map.name}</h1>
          <p class="mm-blurb">${
            solo
              ? "The round is held where it stood. Nothing moves until you resume."
              : "A match does not stop for a menu. The round goes on around you while this is up."
          }</p>
          <div class="mm-facts"></div>
        </div>
      </div>
      <div class="ro-plate ro-you ps-you"></div>
      <div class="ps-list">${this.pauseActs.map((a) => this.pausePlate(a, state)).join("")}</div>
      <div class="mm-foot ps-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Choose</span>
        <span data-dev="kbm"><kbd>Enter</kbd> Select</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Choose</span>
        <span data-dev="pad"><kbd class="pd face-a">A</kbd> Select</span>
      </div>
    `;
    this.pauseRefs = {
      facts: this.root.querySelector<HTMLElement>(".ps-hero .mm-facts")!,
      you: this.root.querySelector<HTMLElement>(".ps-you")!,
      shownFacts: "",
      shownYou: "",
    };
    this.setPauseRound(state);
    this.pauseRows = Array.from(this.root.querySelectorAll<HTMLElement>(".ps-row"));
    this.pauseRows.forEach((row, i) => {
      const btn = row.querySelector<HTMLElement>("button")!;
      // A CLICK, not a pointer-down: none of these takes the pointer lock in
      // the same press (Resume asks for it through `Game.resume`, which waits
      // for the button to come up), and a click is what a phone raises only
      // for a tap and never for a drag.
      btn.onclick = () => this.onPauseAction(this.pauseActs[i]);
      // Hovering moves the cursor with it, so the plate under the brackets and
      // the one a click is about to fire can never disagree. Safe here where
      // the kit screen's slots are not: the column is the only thing on the
      // card, so the mouse crosses nothing else on its way to a plate.
      btn.onmouseenter = () => this.setPauseSelection(i);
    });
    this.setPauseSelection(0);
  }

  /**
   * One plate of the pause's column. Resume is the menu's Deploy plate — hot,
   * with its prompt on it — and the others are dark plates with an icon, the
   * act's name and what it does to THIS round. Never the map's name: it is the
   * title already, and "Cinderhaven" is what would push a line off its plate.
   */
  private pausePlate(action: PauseAction, state: PauseState): string {
    if (action === "resume") {
      return `
        <div class="mm-go ps-row ps-resume">
          <button class="mm-deploy">
            <span class="mm-deploy-t"><b>Resume</b><i>${state.solo ? "Round held" : "Back into the match"}</i></span>
            ${glyph("Esc", "B")}
          </button>
        </div>`;
    }
    const [icon, label, note] =
      action === "settings"
        ? [ICON_SETTINGS, "Settings", "Controls &middot; display &middot; detail"]
        : action === "restart"
          ? [ICON_RESTART, "Restart round", `From the top &middot; ${CONFIG.conquest.tickets} a side`]
          : state.solo
            ? [ICON_BACK, "Quit to menu", "This round is not kept"]
            : [ICON_BACK, "Leave match", "Your slot goes back to a bot"];
    return `
      <div class="ps-row ps-${action}">
        <button class="ps-act">${icon}<span class="ps-t"><b>${label}</b><i>${note}</i></span></button>
      </div>`;
  }

  /**
   * The pause card's two live figures — the flags held and the player's own
   * round — written only where they changed.
   *
   * Offline nothing moves under a pause, so the raise is the only call. In a
   * match the round goes on under the card, and `Game` pushes it again on a
   * slow cadence rather than every frame, since the board is assembled to do
   * it. Both strings are this build's own words and numbers — no name a
   * person typed is on either — which is what makes writing them as markup
   * safe.
   */
  setPauseRound(state: PauseState): void {
    const refs = this.pauseRefs;
    if (!refs || this.card !== "pause") return;
    const flags = state.map.layout.controlPoints.length;
    const facts = `
      <span><b>${state.flagsMine} of ${flags}</b> flags held</span>
      <span><b>${state.enemy ?? "Online"}</b> ${state.enemy ? "enemy" : "match"}</span>`;
    if (facts !== refs.shownFacts) {
      refs.shownFacts = facts;
      refs.facts.innerHTML = facts;
    }
    const you = this.yourRoundInner(state.board, "Your round so far");
    if (you !== refs.shownYou) {
      refs.shownYou = you;
      refs.you.innerHTML = you;
    }
  }

  /** Steps the pause cursor, wrapping at both ends. */
  movePauseSelection(delta: number): void {
    const n = this.pauseRows.length;
    if (n === 0) return;
    this.setPauseSelection((this.pauseIndex + delta + n) % n);
  }

  /** Fires the plate under the cursor — Enter / gamepad A. */
  activatePause(): void {
    const action = this.pauseActs[this.pauseIndex];
    if (action && this.card === "pause") this.onPauseAction(action);
  }

  /**
   * The cursor: the sight brackets on the row's wrapper, and on Resume the
   * glow and the sheen the menu's Deploy wears under it. A class on a row that
   * already exists rather than a re-render, so arrowing down the column does
   * not restart the sheen or drop the hover state.
   */
  private setPauseSelection(i: number): void {
    this.pauseIndex = i;
    this.pauseRows.forEach((r, k) => r.classList.toggle("sel", k === i));
  }

  /**
   * Which card is up, as a class on the root.
   *
   * All four are laid out as the front end, in one frame sized off one unit
   * (`#overlay:is(.card-menu, .card-building, .card-roundover, .card-pause)`
   * in `overlay.css`), each on a grid of its own; three stand over a
   * photograph and the pause over the round it holds, scrimmed from its own
   * side only. The menu, the round-over card and the pause carry the prompt
   * device (`dev-*`) because every prompt on them is picked by the
   * stylesheet; the BUILDING card has no prompt on it to pick. Setting
   * `className` outright rather than toggling is what stops the previous
   * card's modifier surviving into the next one.
   *
   * `raised` is the entrance and nothing else: the class has to be on the
   * ROOT before the markup is written, because what animates are elements
   * that do not exist yet.
   */
  private setCardClass(
    card: "menu" | "roundover" | "building" | "pause",
    raised = false,
  ): void {
    // Every card but the menu writes over the menu's markup, so the patch
    // path's references die here rather than at each of the three callers.
    if (card !== "menu") this.refs = null;
    if (card !== "pause") this.pauseRefs = null;
    const device = card === "building" ? "" : ` dev-${this.device}`;
    this.root.className = `card-${card}${device}${raised ? " enter" : ""}`;
  }

  /** Takes whichever card is up back down. The single way off all four. */
  hide(): void {
    this.root.className = "hidden";
    this.setOverlaid(false);
    this.clearShot();
    this.detailEl = null;
    this.build = null;
    this.clearVote();
    this.refs = null;
    // The rows live in the card's markup, so they die with it.
    this.pauseRows = [];
    this.pauseActs = [];
    this.pauseIndex = 0;
    this.pauseRefs = null;
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
