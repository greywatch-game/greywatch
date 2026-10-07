/**
 * LoadoutScreen.ts — The kit screen: pick a weapon, fit an optic, choose what
 * goes in the off hand, paint the thing, turn it over in your hands, and read
 * what the trade costs.
 * Owns: its own DOM under `#hud`, the slot cursor, the option rail, the intel
 * plate and the stat table it derives from `CONFIG.weapons`, the pointer drags
 * over its bay, and the MEASUREMENT of that bay. It reports choices and never
 * decides one — `Game` applies a pick and calls `setFit` back, so the lit card
 * can never get ahead of the weapon in the player's hands.
 * Invariants: built once in the constructor and PATCHED by `draw`; nothing
 * that is already on screen is rewritten unless what it says has changed.
 *
 * The weapon in the middle is not a picture: it is the real viewmodel, the one
 * that will be in the player's hands, posed on a turntable by `ViewModel` and
 * drawn by the live scene behind this overlay.
 *
 * **THE BAY IS MEASURED, AND THAT IS THE ONE THING TO UNDERSTAND BEFORE
 * MOVING ANYTHING ON THIS SCREEN.** The weapon is placed by back-projecting a
 * screen position, and that position used to be a constant welded to a CSS
 * percentage — one possible layout. `stageBay` reports the hole instead, every
 * frame, and the weapon goes wherever the hole is. Move the layout freely; the
 * weapon follows. What it does NOT forgive is a hole that changes size while
 * the player is looking at it: the weapon would rescale under them. So every
 * block that shares the stage's column is a CONSTANT height — the hero's title
 * does not wrap, the rail is one height for every kind of option — and moving
 * the cursor between slots never moves the bay.
 *
 * **IT IS A TITLE SCREEN FOR A WEAPON, LAID OUT THE WAY THE MAIN MENU IS**, and
 * the menu is the only screen it is consistent with on purpose. The weapon's
 * NAME is the title, with its number in the rotation hollow and enormous
 * behind it; the SLOTS are one column of plates down the left, anchored to the
 * bottom as the menu's rows are; the options for the slot the cursor is on are
 * a RAIL under the weapon, the menu's reel in another guise; and an INTEL
 * plate on the right describes what the cursor rests on. Back is the system
 * corner (the menu's Online and Settings), and the prompts are drawn on their
 * controls for the device in hand (`prompts.ts`).
 *
 * **Two axes and a page**, the menu's own grammar: up and down walk the slots,
 * left and right walk the rail — each step APPLIED, as every pick here always
 * was — and the bumpers turn the WEAPON from anywhere, because the weapon is
 * this screen's page the way the map is the menu's. A pointer CLICKS a slot to
 * open its rail rather than hovering it open: the rail is under the stage and
 * the column is to its left, so a hover rule would re-open whatever slot the
 * mouse crossed on its way down to the rail.
 *
 * **The FINISH is the one slot that is not a trade**, and it is drawn unlike the
 * others for that reason. Every other choice here costs something — a
 * magnification is a field of view, a weapon is a rate against a magazine — and
 * a finish costs nothing, so it has no bar on any chart. All sixteen are offered
 * on every gun, which is what takes the NAMES off its options: a finish says
 * what it is with colour because "Verdigris" and "Oxblood" are words you would
 * otherwise try one at a time, so each option IS a swatch — three flat colours
 * in the order they sit on the weapon — and the name is the rail's caption, the
 * slot plate's and the intel's. Which one is lit is the carried gun's own
 * remembered finish (`prefs.readFinish`, one key each).
 *
 * The screen is reachable from the MAIN MENU and from the DEPLOY screen, and
 * deliberately not from the pause menu: a round you are already standing in is
 * not somewhere you get to change what you are carrying. That is `loadout`'s
 * `covers` in `ScreenStack.ts`.
 *
 * The stat bars are DERIVED from the weapon table rather than authored. Each
 * one is that weapon's number against the best number any weapon has, so a
 * weapon added to CONFIG re-scales the chart instead of dating it. "Any weapon"
 * means `PRIMARY_WEAPON_IDS` throughout — the sidearm is in the same table and
 * is not a choice, so it is on no rail and on no scale; the column names it
 * once, as the one thing in the kit nobody picks.
 *
 * CSS contract: `#hud` is `pointer-events: none`, so this overlay opts back in
 * — the same carve-out `#deploy` takes.
 */
import "./loadout.css";
import { CONFIG } from "../config";
import {
  DEFAULT_FINISH,
  finishBlurb,
  finishName,
  finishSwatch,
  FINISH_IDS,
  type FinishId,
} from "../entities/finishes";
import { EQUIPMENT_IDS, type EquipmentId } from "../entities/equipment";
import {
  THROWABLE_IDS,
  throwableCarried,
  throwableName,
  type ThrowableId,
} from "../entities/throwables";
import type { StageBay } from "../entities/ViewModel";
import { SIGHT_IDS, type SightId } from "../entities/sights";
import {
  carriedSetup,
  weaponSetup,
  PRIMARY_WEAPON_IDS,
  SIDEARM,
  type CarriedId,
  type PrimaryWeaponId,
  type WeaponId,
} from "../entities/weapons";
import { glyph, guessDevice, markDevice, type InputDevice } from "./prompts";

/**
 * Which slot the keyboard/pad cursor is on, and therefore which options the
 * rail is showing.
 *
 * In the order the choices depend on each other: the weapon decides what every
 * other slot is fitted TO, so it is the one the cursor opens on and the top of
 * the column.
 */
type Slot = "weapon" | "sight" | "equipment" | "throwable" | "finish";

/**
 * The slots, in that order, with and without the anti-tank one.
 *
 * **Two lists rather than one filtered at the point of use**, because the slot
 * is genuinely absent rather than disabled: on a map with no armour there is
 * nothing the launcher could be used on, and a greyed plate saying so would be
 * the kit screen explaining a rule instead of the map simply not having it.
 * `Game` decides which of these is in force — see `MapLayout.vehicles`.
 *
 * The AT slot sits between the OPTIC and the THROWABLE: the weapon decides what
 * the optic is bolted to, the AT slot decides nothing and is decided by
 * nothing, the throwable is on every map, and the finish is the slot that is
 * not a trade at all and closes the column.
 */
const SLOTS: readonly Slot[] = ["weapon", "sight", "throwable", "finish"];
const ARMED_SLOTS: readonly Slot[] = [
  "weapon",
  "sight",
  "equipment",
  "throwable",
  "finish",
];

/**
 * Line icons in the menu's own drawing (`OverlayScreen`'s system bar): a
 * 24-unit box, a 2-unit square-capped stroke, no fill. Each slot plate leads
 * with one, and on a phone held upright — where the plates are tabs too narrow
 * for a name — the icon is what is left.
 */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${d}</svg>`;
const ICONS: Record<Slot | "sidearm" | "back", string> = {
  weapon: svg(`<path d="M2 9.5h14l1.5-1.5H22v3.4h-3l-1 1.6H11.2L10 17.5H6.6l1.1-4.5H2z"/>`),
  sight: svg(`<circle cx="12" cy="12" r="6"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>`),
  equipment: svg(`<path d="M2 10h11v4H2zM13 10h3l5 2-5 2h-3M6 14v4"/>`),
  throwable: svg(`<circle cx="11" cy="14.5" r="6"/><path d="M8.5 8.6V6h5v2.6M13.5 6l4-3"/>`),
  finish: svg(`<path d="M12 3.5l5.2 7.4a6 6 0 1 1-10.4 0z"/>`),
  sidearm: svg(`<path d="M3 7h17v4h-8l-1 2H8.5L7 19H3.5L5 11H3z"/>`),
  back: svg(`<path d="M15 5l-7 7 7 7"/>`),
};

/**
 * What each slot is called. `cap` is the plate's caption and the rail's; `tab`
 * is the word a phone held upright has room for, where the plates are five
 * equal shares of 360 px; `eyebrow` heads the intel plate.
 */
const SLOT_NAMES: Record<Slot, { cap: string; tab: string; eyebrow: string }> = {
  weapon: { cap: "Primary", tab: "Weapon", eyebrow: "Primary weapon" },
  sight: { cap: "Optic", tab: "Optic", eyebrow: "Optic" },
  equipment: { cap: "Anti-tank", tab: "AT", eyebrow: "Anti-tank" },
  throwable: { cap: "Throwable", tab: "Throw", eyebrow: "Throwable" },
  finish: { cap: "Finish", tab: "Finish", eyebrow: "Finish · cosmetic" },
};

/** A 1-based index as two digits: the hero's numeral and a weapon card's. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * What each weapon is for, in the player's terms. Copy, not configuration —
 * every number these describe lives in `CONFIG.weapons` and is read from there
 * for the buttons and the bars rather than written twice.
 */
export const WEAPON_BLURBS: Record<PrimaryWeaponId, string> = {
  rifle:
    "A full-power battle rifle. Four rounds kill out to the middle distance and five across the valley, and it holds its group the whole way — but the magazine is short and every round has to be worth its recoil.",
  carbine:
    "A bullpup, and the trigger buys three rounds rather than one. All three land in a tenth of a second and all three together are a kill — then the weapon sits out four tenths whether they hit or not, which makes a wasted burst the most expensive mistake in the kit.",
  smg: "Pistol-calibre, and it empties a long magazine in under three seconds. The fastest kill of any held trigger inside a room, quickest to the shoulder, cheapest to miss with — and past the width of a street it will neither group nor hurt, whatever optic is on top of it.",
  dmr: "Semi-automatic: one round per trigger pull. Three anywhere on a man will do it, two if one of them is the head, at any range it reaches. The tightest group in the kit short of the bolt gun, paid for with a kick that has to be ridden back down before the next shot means anything — but you keep your sight picture the whole way, which is the thing the sniper cannot offer.",
  sniper:
    "Bolt-action, and one round to the head is a kill at any range it reaches; anywhere else it is a wound for somebody to finish. Then you work the bolt: a second and a quarter with the rifle off your target and no way to hurry it, which is the whole price of the weapon and is charged whether the round killed or not. Five in the magazine, nothing to offer inside a room, and a sidearm you will need.",
  lmg: "Belt-fed, and the only weapon here that does not have to stop: seventy-five rounds is fifteen kills without a pause, and the group barely opens across the whole belt — though the climb has to be pulled down the whole way. Slowest into the shoulder, useless from the hip, and a reload long enough that being caught empty is a decision about the sidearm.",
};

/**
 * What each anti-tank item is for. Copy, not configuration — every number
 * these describe lives in `CONFIG.equipment` and is read from there for the
 * buttons rather than written twice.
 */
const EQUIPMENT_BLURBS: Record<EquipmentId, string> = {
  rpg: "Two rockets and no way to get a third. The rocket FLIES — a second and a half across an avenue — so a moving hull has to be led and a driver who sees the smoke has that long to decide something. Both of them into the same tank is a dead tank; either of them into a doorway is most of a squad.",
  mine: "Two plates, laid on the ground and armed a beat later, and only a vehicle is heavy enough to set one off — your own infantry walk over them, and so does everybody else's. They outlive you, but you may only have two out: lay a third and the first one is lifted. It is the only weapon here that works while you are somewhere else.",
};

/**
 * What each throwable is for. Copy, not configuration — the counts on the
 * buttons are read off `CONFIG.grenade` and `CONFIG.molotov`.
 */
const THROWABLE_BLURBS: Record<ThrowableId, string> = {
  frag: "Two frags and a fuse you cannot cook. It bounces, it rolls, and it goes off where it ends up — everything within a couple of metres is dead and everything short of eight is hurt, but only if the fragments can see them. The answer to somebody who will not come out of a room.",
  molotov:
    "Two bottles of petrol, and they break on the first thing they touch — no bounce, no fuse. The fire covers a doorway and the room behind it for eight seconds; running through it costs a third of a man and standing in it kills him. A frag clears a room once. This closes it.",
};

/**
 * What each optic is for. The numbers these describe live in `CONFIG.sights`,
 * and the magnification on each button is read from there.
 */
const SIGHT_BLURBS: Record<SightId, string> = {
  reflex:
    "A lit dot in an open frame, and the least magnification on offer. Nothing to line up and nothing in the way — the clearest picture in the kit, a fraction slower up than the irons already standing on the rail.",
  iron: "Rear aperture over a post between two guard ears. Nothing to switch on and the fastest to the shoulder, paid for with a post that covers whatever it is aimed at.",
  holo: "A lit ring and dot floating in a tube optic. The issued sight: enough magnification to pick a target out of the dark, little enough to swing between two.",
  greenDot:
    "A small green dot in a short 2x tube. A step more reach than the holo and a step quicker up than the prism, with one mark in the picture and nothing around it.",
  prism:
    "A short prismatic body on an integral mount, with an etched chevron. Enough magnification to make a body across the square worth shooting at, and enough field left to swing onto the next one.",
  scope:
    "A compact combat scope with a slanted hood, and fine black posts around a small black dot. Slow to bring up and a tunnel to look down, and the only thing on offer that will show you a body at the far end of the valley.",
  longScope:
    "Six times, on the biggest optic in the kit. It will show you a man at three hundred metres and it will show you nothing else at all — the field is half the scope's, the slowest thing here into the shoulder, and it magnifies your own hands along with everything you are looking at.",
};

/** One bar on the stat chart: a caption, the figure, and its share of the best. */
interface StatRow {
  label: string;
  value: string;
  frac: number;
}

/** Formats a magnification the way a lens is marked. */
function magLabel(id: SightId): string {
  return `${CONFIG.sights[id].magnification.toFixed(1)}×`;
}

/** The largest value of one field across every weapon — the bars' full scale. */
function best(pick: (w: (typeof CONFIG.weapons)[WeaponId]) => number): number {
  return Math.max(...PRIMARY_WEAPON_IDS.map((id) => pick(CONFIG.weapons[id])));
}

/** The smallest, for the fields where less is better (spread). */
function least(pick: (w: (typeof CONFIG.weapons)[WeaponId]) => number): number {
  return Math.min(...PRIMARY_WEAPON_IDS.map((id) => pick(CONFIG.weapons[id])));
}

/**
 * Rounds a weapon actually delivers per second, held down.
 *
 * For everything but the carbine that is `fireRate` itself. A burst weapon's
 * `fireRate` is the rate WITHIN its burst — 20/s on a weapon that fires six —
 * and charting that would put the longest bar in the kit against the lowest
 * sustained output in it, which is the opposite of what the bar is for. The
 * burst's own rate is not lost: it is what the damage bar is about, since the
 * three rounds arrive together.
 *
 * It is the FIRST position's figure, on a weapon that has more than one. The
 * chart is what a weapon is picked on, and a weapon is picked before it is
 * carried: the rifle's bar is its held trigger and the carbine's is its
 * burst, which is what each of them turns up to the fight with.
 */
function sustainedRate(id: WeaponId): number {
  const m = weaponSetup(id).modes[0];
  const rate = 1 / m.shotInterval;
  if (m.burst <= 1) return rate;
  return m.burst / (m.burstCycle + (m.burst - 1) * m.shotInterval);
}

/**
 * How a weapon's trigger behaves, in the words a button has room for — every
 * position of the selector, in the order the switch walks them.
 *
 * The burst carries its COUNT, because that is the number the mode is about —
 * three rounds is the difference between a kill on one pull and 68 damage and
 * a wait. That a burst position is also semi-automatic goes unsaid: "one pull,
 * one burst" is what "burst" already means to anyone reading it.
 *
 * A second position is printed rather than hidden behind the key that reaches
 * it, because it is part of what the weapon IS and the kit screen is where a
 * weapon is compared: "auto / semi" against "burst ×3 / semi" against a bare
 * "semi" is three different guns, and the reader has to be able to see that
 * before deploying rather than after.
 */
function fireMode(id: WeaponId): string {
  const w = CONFIG.weapons[id];
  const modes = weaponSetup(id).modes;
  // A bolt gun's first position is `semi` too and "semi" would be true and
  // useless — it is what the DMR says, and the two weapons are as far apart as
  // anything in the kit. What the word has to carry is that the trigger is not
  // the thing you are waiting for, which is the same job "burst" does.
  const word = (m: (typeof modes)[number]) =>
    w.boltCycle && m.id === "semi" ? "bolt" : m.name;
  return modes.map(word).join(" / ");
}

/**
 * The chart for one weapon. Accuracy is the AIMED spread inverted — a bar
 * that grows with the number would rank the SMG as the accurate one — and is
 * shown in degrees, which is the only unit that means anything at a glance.
 *
 * Rate is left as a bare figure even though it means something different on a
 * semi-automatic (a ceiling on the trigger finger, not a cadence): the value
 * column is 52px and "3/s semi" does not fit in it. The fire mode is on the
 * weapon's own button instead, next to the number it qualifies.
 *
 * **Two rows carry fall-off, and both had to.** Damage prints BOTH ends of the
 * curve, because one number is now a half-truth — the SMG's 21 and the LMG's 24
 * rank one way in a room and the other way at 40 m. The bar stays keyed to the
 * close figure, which is the one a weapon is picked to win a room with. A
 * weapon with no fall-off prints one number, and on the two that do it that is
 * their whole case made without a sentence.
 *
 * **The chart is RELATIVE and the sniper is what proves it costs nothing.**
 * Every bar is a share of the best figure in the kit, so a weapon that sets a
 * new best shortens every other bar in that row — 80 damage against the
 * rifle's 28 takes the rifle's damage bar to about a third of the width it used
 * to draw. That is the chart working rather than breaking: the rifle has not
 * changed, and what the row is for is saying where a weapon sits among the ones
 * it is being chosen against. Pinning the scale to an absolute instead would
 * mean every bar in the kit needing a re-tune the day a weapon is added.
 *
 * Range is `falloffFar`, **not** `range`, and that is a correction rather than
 * a choice: `range` is where the ray stops, which since fall-off arrived is no
 * longer the interesting end of the weapon. The DMR's 180 m is mostly spent
 * past a fog wall at 78, and the SMG's rounds carry to 70 m having stopped
 * being worth firing at 40. The distance a player can act on is the one where
 * the damage runs out.
 */
function weaponStats(id: PrimaryWeaponId): StatRow[] {
  const w = CONFIG.weapons[id];
  const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(2);
  const rate = sustainedRate(id);
  return [
    {
      // Both ends of the curve, because one number is now a half-truth: the
      // SMG's 21 and the LMG's 24 rank one way close and the other way at
      // 40 m. The bar itself stays keyed to the CLOSE figure — that is the
      // one a player is choosing a weapon to win a room with — and the value
      // column says what happens to it. A weapon with no fall-off (the DMR and
      // the sniper) prints one number, which is the whole of its case.
      label: "Damage",
      value:
        w.damageFar === w.damage
          ? `${w.damage}`
          : `${w.damage}–${w.damageFar}`,
      frac: w.damage / best((x) => x.damage),
    },
    {
      label: "Rate",
      value: `${rate % 1 === 0 ? rate : rate.toFixed(1)}/s`,
      frac: rate / Math.max(...PRIMARY_WEAPON_IDS.map(sustainedRate)),
    },
    {
      label: "Magazine",
      value: `${w.magSize}`,
      frac: w.magSize / best((x) => x.magSize),
    },
    {
      label: "Accuracy",
      value: `±${deg(w.spreadAds)}°`,
      frac: least((x) => x.spreadAds) / w.spreadAds,
    },
    {
      // `falloffFar`, NOT `range`. `range` is where the ray stops, and since
      // fall-off arrived it is no longer the interesting end of the weapon:
      // the DMR's 180 m is most of it spent past a fog wall at 78, while the
      // SMG's rounds carry to 70 m and stopped being worth firing at 40. The
      // distance a player can act on is the one where the damage runs out —
      // and on the sniper, which never runs out, `falloffFar` is still the
      // honest figure, because past it the round is unchanged and the LIMIT is
      // whether the map has anything that far away to shoot at.
      label: "Range",
      value: `${w.falloffFar} m`,
      frac: w.falloffFar / best((x) => x.falloffFar),
    },
    {
      label: "Handling",
      value: `${w.adsSpeedMult.toFixed(2)}×`,
      frac: w.adsSpeedMult / best((x) => x.adsSpeedMult),
    },
  ];
}

/** The kit as one line, for the menu button and the HUD's magazine caption. */
export function kitLabel(weapon: CarriedId, sight: SightId): string {
  return `${carriedSetup(weapon).name} · ${CONFIG.sights[sight].name}`;
}

/**
 * The sight bars' two rows: how far the glass reaches and how quickly it comes
 * up, each against the best optic in the kit — the same relative scale the
 * weapon chart uses, for the same reason.
 */
function sightStats(id: SightId): StatRow[] {
  const s = CONFIG.sights[id];
  const all = SIGHT_IDS.map((x) => CONFIG.sights[x]);
  return [
    {
      label: "Zoom",
      value: magLabel(id),
      frac: s.magnification / Math.max(...all.map((x) => x.magnification)),
    },
    {
      label: "Aim speed",
      value: `${s.adsSpeedMult.toFixed(2)}×`,
      frac: s.adsSpeedMult / Math.max(...all.map((x) => x.adsSpeedMult)),
    },
  ];
}

/** One bar row, in the markup `patchWeaponIntel` writes back into. */
function barRow(s: StatRow): string {
  return `
    <div class="lo-bar-row">
      <span>${s.label}</span>
      <b>${s.value}</b>
      <u><s style="width:${(s.frac * 100).toFixed(1)}%"></s></u>
    </div>`;
}

/** A figure over its caption, the intel's and the hero's shared shape. */
function fact(value: string, label: string, extra = false): string {
  return `<span class="lo-fact${extra ? " x" : ""}"><b>${value}</b><i>${label}</i></span>`;
}

/** The swatch's three custom properties — furniture, receiver, fittings. */
function swatchVars(id: FinishId): string {
  const [a, b, c] = finishSwatch(id);
  return `--sw-a:${a};--sw-b:${b};--sw-c:${c}`;
}

/** What `draw` last put on screen, so it can patch rather than rewrite. */
interface Shown {
  slot: Slot | null;
  weapon: PrimaryWeaponId | null;
  armour: boolean | null;
  /** The id lit on the rail, keyed with its slot. */
  pick: string;
}

export class LoadoutScreen {
  private root: HTMLElement;
  /** The slot column, rebuilt only when the AT slot comes or goes. */
  private slotsEl: HTMLElement;
  /** The weapon's title block, rewritten when the weapon changes. */
  private heroEl: HTMLElement;
  /**
   * The HOLE, and the element `stageBay` measures. It is the bay minus the
   * touch hint: what is reported has to be the empty box the weapon can stand
   * in.
   */
  private well: HTMLElement;
  private railKind: HTMLElement;
  private railName: HTMLElement;
  private railCount: HTMLElement;
  /** The options for the cursor's slot. Rebuilt when the slot changes. */
  private track: HTMLElement;
  private intelEl: HTMLElement;
  /**
   * Drag accumulated since `Game` last read it. Pixels, not radians — how far
   * a pixel turns the weapon is the viewmodel's business.
   */
  private dragX = 0;
  private dragY = 0;
  private weapon: PrimaryWeaponId = PRIMARY_WEAPON_IDS[0];
  private sight: SightId = SIGHT_IDS[0];
  /** The finish on the CARRIED weapon — remembered per gun, so it turns over with it. */
  private finish: FinishId = DEFAULT_FINISH;
  /** Which slot the d-pad is on. Up/down steps it; left/right steps its rail. */
  private slot: Slot = "weapon";
  /** The AT item the kit has, whether or not this map offers the slot. */
  private equipment: EquipmentId = EQUIPMENT_IDS[0];
  /** Whether this map has armour on it, and therefore whether the slot exists. */
  private armour = false;
  /** What the pouch holds. Offered on every map. */
  private throwable: ThrowableId = THROWABLE_IDS[0];
  /** Which device's prompts the screen draws — see `setInputDevice`. */
  private device: InputDevice = guessDevice();
  private shown: Shown = { slot: null, weapon: null, armour: null, pick: "" };
  /**
   * The bay handed back when there is nothing to measure — the screen hidden,
   * or a frame before the first layout. A full-viewport bay cannot put the
   * weapon somewhere silly.
   */
  private readonly wholeScreen: StageBay = { x: 0, y: 0, width: 1, height: 1 };

  /** Wired by Game. Each reports a choice; none of them redraws. */
  onWeapon: (id: PrimaryWeaponId) => void = () => {};
  onSight: (id: SightId) => void = () => {};
  onFinish: (id: FinishId) => void = () => {};
  onEquipment: (id: EquipmentId) => void = () => {};
  onThrowable: (id: ThrowableId) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "loadout";
    this.root.className = `hidden dev-${this.device}`;
    // Every block is a named grid AREA, which is what lets a phone's layout be
    // a change of template in the stylesheet rather than a second copy of this
    // markup — the menu's rule, for the menu's reason.
    this.root.innerHTML = `
      <div class="lo-top">
        <div class="lo-brand">
          <span class="lo-kicker">Greywatch</span>
          <span class="lo-word">Loadout</span>
        </div>
        <button class="lo-back">${ICONS.back}<b>Back</b>${glyph("Esc", "B")}</button>
      </div>
      <div class="lo-hero"></div>
      <nav class="lo-slots"></nav>
      <div class="lo-bay">
        <div class="lo-well"></div>
        <span class="lo-turn">Drag to turn</span>
      </div>
      <div class="lo-rail">
        <div class="lo-rail-cap">
          <span class="lo-rail-kind"></span>
          <b class="lo-rail-name"></b>
          <i class="lo-rail-count"></i>
        </div>
        <div class="lo-track"></div>
      </div>
      <aside class="lo-intel"></aside>
      <div class="lo-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Slot</span>
        <span data-dev="kbm"><kbd>&larr;</kbd><kbd>&rarr;</kbd> Change</span>
        <span data-dev="kbm"><kbd>Drag</kbd> Turn</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Navigate</span>
        <span data-dev="pad"><kbd class="pd">RS</kbd> Turn</span>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.slotsEl = q(".lo-slots");
    this.heroEl = q(".lo-hero");
    this.well = q(".lo-well");
    this.railKind = q(".lo-rail-kind");
    this.railName = q(".lo-rail-name");
    this.railCount = q(".lo-rail-count");
    this.track = q(".lo-track");
    this.intelEl = q(".lo-intel");
    this.bindBay(q(".lo-bay"));
    this.bindTrack();
    // The pointer's way off this screen, in the system corner where the
    // menu keeps its own. It reads "Back" because a pick is applied the moment
    // it is made — there is nothing here to be finished with. `click` is safe
    // where the buttons that OPEN this screen need pointerdown: the state
    // under it takes its confirm from a mouse-down, and by the time a click
    // fires that button is already back up.
    q(".lo-back").onclick = () => this.onClose();
    this.draw();
  }

  /**
   * The hole the weapon stands in, as the browser has just laid it out.
   *
   * Read once a frame from `Game.updateKitStage`, which is the whole of what
   * makes this screen's layout free: any arrangement the stylesheet can
   * express is one the weapon will be in the middle of. Nothing here is cached
   * — the read lands on a layout nothing has dirtied since the last frame, so
   * it costs a lookup rather than a reflow, and a cache is one more thing that
   * can disagree with where the hole actually is.
   *
   * Measured against the ROOT rather than against `window`, because the root
   * is `inset: 0` over the canvas and is therefore the same box the aspect
   * ratio is taken from.
   */
  stageBay(): StageBay {
    const box = this.root.getBoundingClientRect();
    const well = this.well.getBoundingClientRect();
    if (box.width < 1 || box.height < 1 || well.width < 1 || well.height < 1)
      return this.wholeScreen;
    return {
      x: ((well.left + well.width / 2 - box.left) / box.width) * 2 - 1,
      y: 1 - ((well.top + well.height / 2 - box.top) / box.height) * 2,
      width: well.width / box.width,
      height: well.height / box.height,
    };
  }

  /**
   * Turns the weapon under a drag.
   *
   * `setPointerCapture` is what makes a drag that leaves the bay keep turning
   * the weapon instead of stopping dead at the edge. Deltas are taken from
   * `clientX/Y` rather than `movementX/Y`: the pointer is not locked here.
   */
  private bindBay(bay: HTMLElement): void {
    let last: { x: number; y: number } | null = null;
    bay.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      bay.setPointerCapture(e.pointerId);
      bay.classList.add("turning");
    });
    bay.addEventListener("pointermove", (e) => {
      if (!last) return;
      this.dragX += e.clientX - last.x;
      this.dragY += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => {
      last = null;
      bay.classList.remove("turning");
    };
    bay.addEventListener("pointerup", end);
    bay.addEventListener("pointercancel", end);
  }

  /**
   * The rail's two pointer affordances. A rail longer than its row SCROLLS —
   * natively under a thumb (`pan-x` in the stylesheet), under a mouse wheel
   * here, since a wheel is vertical and a rail is not — and its edges FADE on
   * whichever side there is more of it, which is the only thing that says a
   * row of cards cut off at the frame is cut off rather than finished.
   */
  private bindTrack(): void {
    this.track.addEventListener(
      "wheel",
      (e) => {
        const t = this.track;
        if (t.scrollWidth <= t.clientWidth + 1) return;
        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
        t.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    this.track.addEventListener("scroll", () => this.markEdges(), { passive: true });
  }

  private markEdges(): void {
    const t = this.track;
    const over = t.scrollWidth - t.clientWidth;
    t.classList.toggle("more-l", over > 1 && t.scrollLeft > 1);
    t.classList.toggle("more-r", over > 1 && t.scrollLeft < over - 1);
  }

  /**
   * The drag since the last call, in pixels, and zeroed by reading it — the
   * consume-on-read shape `InputManager` gives mouse look, so a frame that
   * never ran cannot turn the weapon twice.
   */
  consumeDrag(): { x: number; y: number } {
    const drag = { x: this.dragX, y: this.dragY };
    this.dragX = 0;
    this.dragY = 0;
    return drag;
  }

  /**
   * Shows the kit that is actually fitted. Called by Game, never by a click.
   *
   * `armour` is the MAP's answer rather than the kit's — whether there is
   * anything on the field an anti-tank item could be used on — and it is
   * pushed through the same call as the picks because it moves the same
   * markup: a slot appearing or going away is a redraw exactly as a pick is.
   */
  setFit(
    weapon: PrimaryWeaponId,
    sight: SightId,
    finish: FinishId,
    equipment: EquipmentId,
    armour: boolean,
    throwable: ThrowableId,
  ): void {
    if (
      weapon === this.weapon &&
      sight === this.sight &&
      finish === this.finish &&
      equipment === this.equipment &&
      armour === this.armour &&
      throwable === this.throwable
    )
      return;
    this.weapon = weapon;
    this.sight = sight;
    this.finish = finish;
    this.equipment = equipment;
    this.armour = armour;
    this.throwable = throwable;
    // A slot that has just gone away cannot keep the cursor. Sent back to the
    // top rather than to a neighbour: the weapon is where `show` opens anyway.
    if (!armour && this.slot === "equipment") this.slot = "weapon";
    this.draw();
  }

  /** The slots this map actually has. */
  private get slots(): readonly Slot[] {
    return this.armour ? ARMED_SLOTS : SLOTS;
  }

  show(): void {
    // Always open on the weapon: it is the choice that changes what every
    // other slot means, and a screen that remembers where you left the cursor
    // three deploys ago is a screen you have to look at before you can use it.
    this.slot = "weapon";
    this.root.classList.remove("hidden");
    // The ENTRANCE, replayed on every raise and never on a patch — the menu's
    // `.enter`. Taking the class off and reading a layout property is what
    // restarts animations that already ran on the last open.
    this.root.classList.remove("enter");
    void this.root.offsetWidth;
    this.root.classList.add("enter");
    // The screens this one covers are DOM, and the weapon it shows is not:
    // either of them left up would paint over the bay. The CSS carries the
    // rule; this is the flag it reads.
    document.getElementById("hud")!.classList.add("kitting");
    // A raise is drawn from nothing, so the hero arrives with the entrance
    // rather than wiping in as though the weapon had just changed.
    this.shown = { slot: null, weapon: null, armour: null, pick: "" };
    this.draw();
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.root.classList.remove("enter");
    document.getElementById("hud")!.classList.remove("kitting");
    // A drag interrupted by the screen closing must not turn the weapon on the
    // next open.
    this.dragX = 0;
    this.dragY = 0;
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /**
   * Which device's prompts to draw. A class on the root, compared before it
   * is written, so `Game` can push it every frame; every prompt on the screen
   * turns over on that one write because the stylesheet picks the label.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    markDevice(this.root, device);
  }

  /** Steps the slot cursor — the screen's up/down. Wraps at both ends. */
  moveSlot(delta: number): void {
    const slots = this.slots;
    const i = slots.indexOf(this.slot);
    this.slot = slots[(i + delta + slots.length) % slots.length];
    this.draw();
  }

  /**
   * Steps the cursor slot's rail, wrapping at both ends — the screen's
   * left/right. Reports the pick and leaves the drawing to `setFit`.
   */
  cycle(delta: number): void {
    this.step(this.slot, delta);
  }

  /**
   * Steps the WEAPON wherever the cursor is — the bumpers, the page this
   * screen is about. A player fitting an optic can look through every gun
   * without leaving the optic's rail, which is what the menu's bumpers do for
   * its maps.
   */
  stepWeapon(delta: number): void {
    this.step("weapon", delta);
  }

  private step(slot: Slot, delta: number): void {
    const ids = this.idsFor(slot);
    const i = ids.indexOf(this.pickOf(slot));
    this.pick(slot, ids[(i + delta + ids.length) % ids.length]);
  }

  /** Every option a slot offers, in the order its rail draws them. */
  private idsFor(slot: Slot): readonly string[] {
    switch (slot) {
      case "weapon":
        return PRIMARY_WEAPON_IDS;
      case "sight":
        return SIGHT_IDS;
      case "equipment":
        return EQUIPMENT_IDS;
      case "throwable":
        return THROWABLE_IDS;
      case "finish":
        return FINISH_IDS;
    }
  }

  /** What a slot holds right now. */
  private pickOf(slot: Slot): string {
    switch (slot) {
      case "weapon":
        return this.weapon;
      case "sight":
        return this.sight;
      case "equipment":
        return this.equipment;
      case "throwable":
        return this.throwable;
      case "finish":
        return this.finish;
    }
  }

  /** Reports a pick. The ids come from `idsFor`, so each cast is to its own union. */
  private pick(slot: Slot, id: string): void {
    switch (slot) {
      case "weapon":
        this.onWeapon(id as PrimaryWeaponId);
        break;
      case "sight":
        this.onSight(id as SightId);
        break;
      case "equipment":
        this.onEquipment(id as EquipmentId);
        break;
      case "throwable":
        this.onThrowable(id as ThrowableId);
        break;
      case "finish":
        this.onFinish(id as FinishId);
        break;
    }
  }

  /** An option's name, the way the plate, the rail's caption and the intel say it. */
  private nameOf(slot: Slot, id: string): string {
    switch (slot) {
      case "weapon":
        return CONFIG.weapons[id as PrimaryWeaponId].name;
      case "sight":
        return CONFIG.sights[id as SightId].name;
      case "equipment":
        return CONFIG.equipment[id as EquipmentId].name;
      case "throwable":
        return throwableName(id as ThrowableId);
      case "finish":
        return finishName(id as FinishId);
    }
  }

  /**
   * The short figure a slot's PLATE carries at its right-hand end: the one
   * number that tells the fitted pick from its neighbours without opening the
   * rail. The finish carries its swatch instead, written by `patchSlots`.
   */
  private figureOf(slot: Slot): string {
    switch (slot) {
      case "weapon":
        return `${CONFIG.weapons[this.weapon].damage} dmg`;
      case "sight":
        return magLabel(this.sight);
      case "equipment":
        return `&times;${CONFIG.equipment[this.equipment].carried}`;
      case "throwable":
        return `&times;${throwableCarried(this.throwable)}`;
      case "finish":
        return "";
    }
  }

  /**
   * One option on the rail. Four shapes, one per kind of thing being chosen,
   * and each leads with whatever tells it from its neighbours: a weapon its
   * SHORT name (the full one is the title over it, and six of "Submachine Gun"
   * do not fit under a weapon) and what one round is worth, an optic its
   * MAGNIFICATION set large (the
   * names are words, the number is the choice), a throwable or an AT item its
   * name and what the pouch holds, and a finish nothing but its colours.
   */
  private card(slot: Slot, id: string, i: number): string {
    const on = id === this.pickOf(slot) ? " on" : "";
    const open = `<button class="lo-opt${on}" data-id="${id}" style="--i:${i}"`;
    switch (slot) {
      case "weapon": {
        const w = CONFIG.weapons[id as PrimaryWeaponId];
        return `${open}>
          <span class="lo-opt-top"><span>${twoDigits(i + 1)}</span><span>${w.damage} dmg</span></span>
          <b class="lo-opt-name lo-opt-short" title="${w.name}">${w.short}</b>
          <i class="lo-opt-fig">${fireMode(id as PrimaryWeaponId)}</i>
        </button>`;
      }
      case "sight":
        return `${open}>
          <b class="lo-opt-big">${magLabel(id as SightId)}</b>
          <b class="lo-opt-name">${CONFIG.sights[id as SightId].name}</b>
        </button>`;
      case "equipment": {
        const e = CONFIG.equipment[id as EquipmentId];
        return `${open}>
          <b class="lo-opt-name">${e.name}</b>
          <i class="lo-opt-fig">&times;${e.carried} &middot; ${e.damage} vs armour</i>
        </button>`;
      }
      case "throwable": {
        const t = id as ThrowableId;
        const worth =
          t === "frag"
            ? `${CONFIG.grenade.damage} blast`
            : `${CONFIG.molotov.fire.dps}/s burn`;
        return `${open}>
          <b class="lo-opt-name">${throwableName(t)}</b>
          <i class="lo-opt-fig">&times;${throwableCarried(t)} &middot; ${worth}</i>
        </button>`;
      }
      case "finish": {
        const name = finishName(id as FinishId);
        return `<button class="lo-opt lo-sw${on}" data-id="${id}" style="--i:${i};${swatchVars(id as FinishId)}"
                  title="${name}" aria-label="${name}"></button>`;
      }
    }
  }

  /**
   * Brings the screen up to date by PATCHING it. Each block is touched only
   * when what it says has changed, and that is not tidiness: the hero's wipe,
   * the rail's deal and the bars' slide are animations on elements that have
   * to survive the redraw to run at all — written wholesale on every press,
   * as this screen used to be, each of them would be a jump cut.
   */
  private draw(): void {
    const was = this.shown;
    const pick = `${this.slot}:${this.pickOf(this.slot)}`;
    const slotMoved = was.slot !== this.slot || was.armour !== this.armour;
    if (was.armour !== this.armour) this.buildSlots();
    this.patchSlots();
    if (was.weapon !== this.weapon) this.writeHero(was.weapon !== null);
    if (slotMoved) this.buildRail(was.slot !== null);
    else if (was.pick !== pick) this.patchRail(true);
    if (slotMoved) this.writeIntel();
    else if (this.slot === "weapon" && was.weapon !== this.weapon) this.patchWeaponIntel();
    else if (was.pick !== pick) this.writeIntel();
    this.shown = { slot: this.slot, weapon: this.weapon, armour: this.armour, pick };
  }

  /**
   * The slot column: one plate per slot, and the sidearm under them as the
   * one line of the kit nobody chooses.
   *
   * Each plate sits in a ROW that is not clipped, because the cursor is a pair
   * of sight brackets on the row's corners — the menu's mark — and the plate
   * itself is cut by a `clip-path` that would take them off with its corner.
   */
  private buildSlots(): void {
    const plates = this.slots
      .map(
        (slot) => `
        <div class="lo-slotrow" data-slot="${slot}">
          <button class="lo-slot" data-slot="${slot}">
            <span class="lo-slot-ic">${ICONS[slot]}</span>
            <span class="lo-slot-cap">${SLOT_NAMES[slot].cap}</span>
            <span class="lo-slot-tab">${SLOT_NAMES[slot].tab}</span>
            <b class="lo-slot-v"></b>
            <i class="lo-slot-f"></i>
          </button>
        </div>`,
      )
      .join("");
    const side = CONFIG.weapons[SIDEARM];
    this.slotsEl.innerHTML = `${plates}
      <div class="lo-side">
        <span class="lo-slot-ic">${ICONS.sidearm}</span>
        <span class="lo-side-cap">Sidearm</span>
        <b>${side.short}</b>
        <i>Always carried</i>
      </div>`;
    this.slotsEl.querySelectorAll<HTMLElement>("button.lo-slot").forEach((btn) => {
      btn.onclick = () => {
        const slot = btn.dataset.slot as Slot;
        if (slot === this.slot) return;
        this.slot = slot;
        this.draw();
      };
    });
  }

  /** Writes each plate's value and figure, and puts the cursor on its row. */
  private patchSlots(): void {
    this.slotsEl.querySelectorAll<HTMLElement>(".lo-slotrow").forEach((row) => {
      const slot = row.dataset.slot as Slot;
      row.classList.toggle("sel", slot === this.slot);
      const v = row.querySelector<HTMLElement>(".lo-slot-v")!;
      const name = this.nameOf(slot, this.pickOf(slot));
      if (v.textContent !== name) v.textContent = name;
      const f = row.querySelector<HTMLElement>(".lo-slot-f")!;
      if (slot === "finish") {
        f.className = "lo-slot-f lo-slot-sw";
        f.setAttribute("style", swatchVars(this.finish));
      } else {
        f.innerHTML = this.figureOf(slot);
      }
    });
  }

  /**
   * The weapon's title block: its number in the rotation, hollow and enormous
   * behind; the bumpers either side of the eyebrow, which is what they turn;
   * the NAME; and a strip of figures under it. Rewritten only when the weapon
   * changes, because replacing it is how `.swap` replays the wipe.
   *
   * The strip carries all six of the chart's figures and the stylesheet drops
   * two of them (`.x`) wherever the intel plate is up with its bars — the
   * numbers a player picks on are never further than the title, whatever the
   * viewport has room for.
   */
  private writeHero(swap: boolean): void {
    const n = PRIMARY_WEAPON_IDS.indexOf(this.weapon) + 1;
    const w = CONFIG.weapons[this.weapon];
    const facts = weaponStats(this.weapon)
      .map((s, i) => fact(s.value, s.label, i === 3 || i === 5))
      .join("");
    this.heroEl.innerHTML = `
      <div class="lo-hero-in${swap ? " swap" : ""}">
        <span class="lo-index">${twoDigits(n)}</span>
        <div class="lo-eyebrow">
          <button class="lo-step prev" data-step="-1" aria-label="Previous weapon">${glyph("Q", "LB")}</button>
          <span class="lo-mode">Primary &middot; ${twoDigits(n)} / ${twoDigits(PRIMARY_WEAPON_IDS.length)} &middot; ${fireMode(this.weapon)}</span>
          <button class="lo-step next" data-step="1" aria-label="Next weapon">${glyph("E", "RB")}</button>
        </div>
        <h2 class="lo-title">${w.name}</h2>
        <div class="lo-facts">${facts}</div>
      </div>`;
    this.heroEl.querySelectorAll<HTMLElement>("button.lo-step").forEach((btn) => {
      btn.onclick = () => this.stepWeapon(Number(btn.dataset.step));
    });
  }

  /**
   * The rail, from nothing — on a slot change, where the cards are a different
   * KIND of thing and there is nothing to patch. `deal` is the entrance they
   * make, staggered by index; it is left off the first draw of a raise, where
   * the whole screen is already arriving.
   */
  private buildRail(deal: boolean): void {
    const slot = this.slot;
    this.track.className = `lo-track k-${slot}${deal ? " deal" : ""}`;
    this.track.innerHTML = this.idsFor(slot)
      .map((id, i) => this.card(slot, id, i))
      .join("");
    this.track.querySelectorAll<HTMLElement>("button.lo-opt").forEach((btn) => {
      btn.onclick = () => this.pick(slot, btn.dataset.id!);
    });
    this.track.scrollLeft = 0;
    this.patchRail(false);
  }

  /** Moves the lit card, re-captions the rail, and keeps the lit card in view. */
  private patchRail(smooth: boolean): void {
    const slot = this.slot;
    const ids = this.idsFor(slot);
    const id = this.pickOf(slot);
    let lit: HTMLElement | null = null;
    this.track.querySelectorAll<HTMLElement>("button.lo-opt").forEach((btn) => {
      const on = btn.dataset.id === id;
      btn.classList.toggle("on", on);
      if (on) lit = btn;
    });
    this.railKind.textContent = SLOT_NAMES[slot].cap;
    this.railName.textContent = this.nameOf(slot, id);
    this.railCount.textContent = `${twoDigits(ids.indexOf(id) + 1)} / ${twoDigits(ids.length)}`;
    const card = lit as HTMLElement | null;
    const t = this.track;
    if (card && t.scrollWidth > t.clientWidth + 1) {
      const left = card.offsetLeft - (t.clientWidth - card.offsetWidth) / 2;
      t.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
    }
    this.markEdges();
  }

  /**
   * The intel plate: what the cursor's slot holds, described. The weapon gets
   * its chart; an optic its two bars; the two pouches their counts and what
   * each is worth; the finish its colours and nothing to trade. Rewritten on a
   * slot change and on a pick — it carries no listener, so a rewrite costs one
   * box — except where the weapon changes under the weapon's own plate, which
   * `patchWeaponIntel` does in place so the bars SLIDE to their new lengths.
   */
  private writeIntel(): void {
    const slot = this.slot;
    const id = this.pickOf(slot);
    let body = "";
    switch (slot) {
      case "weapon":
        body = `<div class="lo-bars">${weaponStats(this.weapon).map(barRow).join("")}</div>
          <p class="lo-blurb">${WEAPON_BLURBS[this.weapon]}</p>`;
        break;
      case "sight":
        body = `<div class="lo-bars">${sightStats(this.sight).map(barRow).join("")}</div>
          <p class="lo-blurb">${SIGHT_BLURBS[this.sight]}</p>`;
        break;
      case "equipment": {
        const e = CONFIG.equipment[this.equipment];
        body = `<div class="lo-ifacts">${fact(`&times;${e.carried}`, "Carried")}${fact(`${e.damage}`, "Vs armour")}</div>
          <p class="lo-blurb">${EQUIPMENT_BLURBS[this.equipment]}</p>`;
        break;
      }
      case "throwable": {
        const worth =
          this.throwable === "frag"
            ? fact(`${CONFIG.grenade.damage}`, "Blast") + fact(`${CONFIG.grenade.fuse}s`, "Fuse")
            : fact(`${CONFIG.molotov.fire.dps}/s`, "Burn") + fact(`${CONFIG.molotov.fire.life}s`, "Fire");
        body = `<div class="lo-ifacts">${fact(`&times;${throwableCarried(this.throwable)}`, "Carried")}${worth}</div>
          <p class="lo-blurb">${THROWABLE_BLURBS[this.throwable]}</p>`;
        break;
      }
      case "finish":
        body = `<div class="lo-bigsw" style="${swatchVars(this.finish)}"><i></i><i></i><i></i></div>
          <p class="lo-blurb">${finishBlurb(this.finish)}</p>
          <p class="lo-note">Paint only &mdash; it changes nothing about how the weapon shoots.</p>`;
        break;
    }
    this.intelEl.innerHTML = `
      <div class="lo-intel-in">
        <div class="lo-intel-head">
          <span class="lo-eyebrow-s">${SLOT_NAMES[slot].eyebrow}</span>
          <h3>${this.nameOf(slot, id)}</h3>
        </div>
        ${body}
      </div>`;
  }

  /** The weapon chart moved in place: the name, the six figures, the bars, the copy. */
  private patchWeaponIntel(): void {
    const rows = this.intelEl.querySelectorAll<HTMLElement>(".lo-bar-row");
    const stats = weaponStats(this.weapon);
    if (rows.length !== stats.length) {
      this.writeIntel();
      return;
    }
    this.intelEl.querySelector("h3")!.textContent = CONFIG.weapons[this.weapon].name;
    rows.forEach((row, i) => {
      row.querySelector("b")!.textContent = stats[i].value;
      row.querySelector<HTMLElement>("s")!.style.width = `${(stats[i].frac * 100).toFixed(1)}%`;
    });
    this.intelEl.querySelector(".lo-blurb")!.textContent = WEAPON_BLURBS[this.weapon];
  }
}
