/**
 * LoadoutScreen.ts — The kit screen: pick a weapon, fit an optic, paint the
 * thing, turn it over in your hands, and read what the trade costs.
 * Owns: its own DOM under `#hud`, the three-slot selection model, the stat
 * table it derives from `CONFIG.weapons`, and the pointer drags over its
 * stage. It reports choices and redraws nothing on its own — `Game` applies a
 * pick and calls `setFit` back, so the highlighted button can never get ahead
 * of the weapon in the player's hands.
 *
 * The weapon on the right is not a picture: it is the real viewmodel, the one
 * that will be in the player's hands, posed on a turntable by `ViewModel` and
 * drawn by the live scene behind this overlay. Two consequences run through
 * the file:
 * - **The stage is a hole in the scrim, not a panel.** The weapon is on the
 *   canvas and every part of this screen is above it, so the stage half carries
 *   no background of its own — only a vignette to frame it. Which is also why
 *   `show()` marks `#hud` and the CSS hides the menu and the deploy map while
 *   the kit is up: they are DOM too, and either would paint over the weapon.
 * - **The stage's geometry is shared with `CONFIG.viewmodel.inspect`.** The
 *   panel column's width is what puts the stage's centre 0.46 of the way
 *   across the viewport, which is the anchor the weapon is placed at. Both
 *   sides are fractions of the viewport, so a resize moves them together.
 *
 * **The FINISH row is the one that is not a trade**, and it is drawn like the
 * other two anyway. Every other choice on this screen costs something — a
 * magnification is a field of view, a weapon is a rate against a magazine —
 * and a finish costs nothing at all, so it has no bar on the chart and never
 * touches one. What it has instead is the STAGE: it is the only pick here
 * whose whole effect is the thing already turning on the turntable, which is
 * why its copy is written under the weapon rather than beside the bars, and
 * why its buttons carry a swatch. A row of names for fifteen colour schemes
 * would be a row you have to try one at a time.
 *
 * The four on offer are the CARRIED weapon's own — the standard finish plus
 * three nothing else is offered, which `FINISHES_BY_WEAPON` decides — so this
 * row is rebuilt when the weapon row moves, exactly as the chart and the blurb
 * are.
 *
 * A screen rather than a row, because there are three slots now and the row it
 * replaces was a strip of buttons wedged under a menu that already had a
 * difficulty picker on it. It is reachable from the MAIN MENU and from the
 * DEPLOY screen, and deliberately not from the pause menu: a round you are
 * already standing in is not somewhere you get to change what you are
 * carrying. Nothing enforces that with a flag; the states that can open it are
 * the states that offer the button.
 *
 * The stat bars are DERIVED from the weapon table rather than authored. Each
 * one is that weapon's number against the best number any weapon has, so a
 * third weapon added to CONFIG re-scales the chart instead of dating it.
 *
 * "Any weapon" means `PRIMARY_WEAPON_IDS` throughout — the sidearm is in the
 * same table and is not a choice, so it appears on neither the buttons nor the
 * scale. Ranking against a weapon nobody can decline would shrink every bar on
 * the screen to say something the player cannot act on.
 *
 * CSS contract: `#hud` is `pointer-events: none`, so this overlay opts back in
 * — the same carve-out `#deploy` takes.
 */
import "./loadout.css";
import { CONFIG } from "../config";
import {
  finishBlurb,
  finishName,
  finishSwatch,
  FINISHES_BY_WEAPON,
  type FinishId,
} from "../entities/finishes";
import { EQUIPMENT_IDS, type EquipmentId } from "../entities/equipment";
import { SIGHT_IDS, type SightId } from "../entities/sights";
import {
  carriedSetup,
  PRIMARY_WEAPON_IDS,
  type CarriedId,
  type PrimaryWeaponId,
  type WeaponId,
} from "../entities/weapons";

/**
 * Which row of the kit the keyboard/pad is currently stepping through.
 *
 * In the order the choices depend on each other: the weapon decides what
 * optics and what finishes the other two rows are even allowed to offer, so it
 * is the one the cursor opens on and the one above the other two.
 */
type Slot = "weapon" | "sight" | "equipment" | "finish";

/**
 * The rows, in that order, with and without the anti-tank slot.
 *
 * **Two lists rather than one filtered at the point of use**, because the row
 * is genuinely absent rather than disabled: on a map with no armour there is
 * nothing the launcher could be used on, and a greyed row saying so would be
 * the kit screen explaining a rule instead of the map simply not having it.
 * `Game` decides which of these is in force — see `MapLayout.vehicles`.
 *
 * It sits between the OPTIC and the FINISH, which is the dependency order the
 * first three were already in: the weapon decides what the two rows under it
 * may offer, the AT slot decides nothing and is decided by nothing, and the
 * finish is the row that is not a trade at all and stays at the bottom next to
 * the stage it is about.
 */
const SLOTS: readonly Slot[] = ["weapon", "sight", "finish"];
const ARMED_SLOTS: readonly Slot[] = ["weapon", "sight", "equipment", "finish"];

/**
 * What each weapon is for, in the player's terms. Copy, not configuration —
 * every number these describe lives in `CONFIG.weapons` and is read from there
 * for the buttons and the bars rather than written twice.
 */
export const WEAPON_BLURBS: Record<PrimaryWeaponId, string> = {
  rifle:
    "A full-power battle rifle. Four rounds kill at any distance you can see a target at, and it holds its group across the valley — but the magazine is short and every round has to be worth its recoil.",
  carbine:
    "A bullpup, and the trigger buys three rounds rather than one. All three land in a tenth of a second and all three together are a kill — then the weapon sits out four tenths whether they hit or not, which makes a wasted burst the most expensive mistake in the kit.",
  smg: "Pistol-calibre, and it empties a long magazine in under three seconds. Quickest to the shoulder, cheapest to miss with, and past the width of a street it will not group whatever optic is on top of it.",
  dmr: "Semi-automatic: one round per trigger pull, and two rounds anywhere on a man will do it. The tightest group and the longest reach in the kit, paid for with a kick that has to be ridden back down before the second shot means anything.",
  lmg: "Belt-fed, and the only weapon here that does not have to stop: seventy-five rounds is fifteen kills without a pause, and the group barely opens across the whole belt. Slowest into the shoulder, useless from the hip, and a reload long enough that being caught empty is a decision about the sidearm.",
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
 * What each optic is for. The numbers these describe live in `CONFIG.sights`,
 * and the magnification on each button is read from there.
 */
const SIGHT_BLURBS: Record<SightId, string> = {
  reflex:
    "A lit dot in an open frame, and the least magnification on offer. Nothing to line up and nothing in the way — the clearest picture in the kit, a fraction slower up than the irons already standing on the rail.",
  iron: "Rear aperture over a hooded post. Nothing to switch on and the fastest to the shoulder, paid for with a post that covers whatever it is aimed at.",
  holo: "A lit ring and dot floating in a tube optic. The issued sight: enough magnification to pick a target out of the dark, little enough to swing between two.",
  prism:
    "A short prismatic body on an integral mount, with an etched chevron. Enough magnification to make a body across the square worth shooting at, and enough field left to swing onto the next one.",
  scope:
    "Telescopic, with a duplex reticle. Slow to bring up and a tunnel to look down, and the only thing on offer that will show you a body at the far end of the valley.",
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
 */
function sustainedRate(w: (typeof CONFIG.weapons)[WeaponId]): number {
  if (w.burst <= 1) return w.fireRate;
  return w.burst / (w.burstCycle + (w.burst - 1) / w.fireRate);
}

/**
 * How a weapon's trigger behaves, in the one word a button has room for.
 *
 * The burst carries its COUNT, because that is the number the mode is about —
 * three rounds is the difference between a kill on one pull and 68 damage and
 * a wait. `semiAuto` is not mentioned for a burst weapon even though it is set:
 * "one pull, one burst" is what "burst" already means to anyone reading it.
 */
function fireMode(w: (typeof CONFIG.weapons)[WeaponId]): string {
  if (w.burst > 1) return `burst ×${w.burst}`;
  return w.semiAuto ? "semi" : "auto";
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
 * curve, because one number is now a half-truth — the SMG's 18 and the LMG's 24
 * rank one way in a room and the other way at 40 m. The bar stays keyed to the
 * close figure, which is the one a weapon is picked to win a room with. A
 * weapon with no fall-off prints one number, and that is the whole of the DMR's
 * case made without a sentence.
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
  const rate = sustainedRate(w);
  return [
    {
      // Both ends of the curve, because one number is now a half-truth: the
      // SMG's 18 and the LMG's 24 rank one way close and the other way at
      // 40 m. The bar itself stays keyed to the CLOSE figure — that is the
      // one a player is choosing a weapon to win a room with — and the value
      // column says what happens to it. A weapon with no fall-off (the DMR)
      // prints one number, which is the whole of its case.
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
      frac: rate / best(sustainedRate),
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
      // distance a player can act on is the one where the damage runs out.
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

export class LoadoutScreen {
  private root: HTMLElement;
  private body: HTMLElement;
  /** The caption under the weapon on the stage. */
  private stageCap: HTMLElement;
  /**
   * What the FINISH is, said under the weapon rather than in the panel.
   *
   * The other two picks are written up beside their bars because what they
   * cost is invisible — a magnification is a field of view, a burst is four
   * tenths of a second. A finish costs nothing and its whole effect is the
   * thing on the turntable, so its copy belongs where the eye already is. It
   * is also fifty pixels the panel does not spend on a third paragraph, which
   * on a 1280x720 laptop is the difference between the footer being on the
   * screen and being scrolled to.
   */
  private stageNote: HTMLElement;
  /** The same caption in the panel's head. */
  private carriedEl!: HTMLElement;
  /**
   * Drag accumulated since `Game` last read it. Pixels, not radians — how far
   * a pixel turns the weapon is the viewmodel's business, and this screen has
   * no opinion about it.
   */
  private dragX = 0;
  private dragY = 0;
  private weapon: PrimaryWeaponId = PRIMARY_WEAPON_IDS[0];
  private sight: SightId = SIGHT_IDS[0];
  /** The finish on the CARRIED weapon — this row's list turns over with it. */
  private finish: FinishId = FINISHES_BY_WEAPON[PRIMARY_WEAPON_IDS[0]][0];
  /** Which row the d-pad is on. Left/right steps inside it; up/down swaps it. */
  private slot: Slot = "weapon";
  /** The AT item the kit has, whether or not this map offers the row. */
  private equipment: EquipmentId = EQUIPMENT_IDS[0];
  /** Whether this map has armour on it, and therefore whether the row exists. */
  private armour = false;

  /** Wired by Game. Each reports a choice; none of them redraws. */
  onWeapon: (id: PrimaryWeaponId) => void = () => {};
  onSight: (id: SightId) => void = () => {};
  onFinish: (id: FinishId) => void = () => {};
  onEquipment: (id: EquipmentId) => void = () => {};
  onClose: () => void = () => {};

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "loadout";
    this.root.className = "hidden";
    this.root.innerHTML = `
      <div class="lo-scrim"></div>
      <div class="lo-panel">
        <div class="ui-head">
          <div class="ui-titles">
            <span class="ui-eyebrow">Kit</span>
            <h2>Loadout</h2>
          </div>
          <div class="ui-meta">
            <span>Carried</span>
            <b class="lo-carried"></b>
          </div>
        </div>
        <div class="lo-body"></div>
        <p class="lo-foot ui-foot">
          <span><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd class="pad">Stick</kbd> choose</span>
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd class="pad">Stick</kbd> slot</span>
          <button class="ui-back"><kbd>Esc</kbd><kbd class="pad">B</kbd> Back</button>
        </p>
      </div>
      <div class="lo-stage">
        <span class="lo-stage-cap"></span>
        <p class="lo-stage-note"></p>
        <span class="lo-stage-hint">Drag &middot; right stick to turn</span>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    this.body = this.root.querySelector(".lo-body")!;
    this.stageCap = this.root.querySelector(".lo-stage-cap")!;
    this.stageNote = this.root.querySelector(".lo-stage-note")!;
    // The head's right-hand slot names the same kit the stage's caption
    // does, and is written by the same call — see `setCaption`. It is the
    // panel's own read-back: the caption lives over the weapon on the far
    // side of the screen, and the column making the choice should not send
    // the eye across a bay to see what it has chosen.
    this.carriedEl = this.root.querySelector(".lo-carried")!;
    this.bindStage(this.root.querySelector<HTMLElement>(".lo-stage")!);
    // The pointer's way off this screen, in the footer every lid screen ends
    // with (`.ui-foot` / `.ui-back` in base.css). It reads "Back" and not
    // "Done" for the reason it is shared at all: a pick is applied the moment
    // it is made, exactly as on the settings screen, so there is nothing here
    // to be finished with — and two screens that leave the same way should not
    // use two words for it. Enter and A still close this one (they have
    // nothing else to do here, where settings spends them on the row's value),
    // and the chips name the pair that works on all three.
    //
    // `click` is safe here where the buttons that OPEN this screen need
    // pointerdown: the state under it takes its confirm from a mouse-down,
    // and by the time a click fires that button is already back up.
    this.root.querySelector<HTMLElement>("button.ui-back")!.onclick = () =>
      this.onClose();
    this.draw();
  }

  /**
   * Turns the weapon under a mouse drag.
   *
   * `setPointerCapture` is what makes a drag that leaves the stage — over the
   * panel, off the window — keep turning the weapon instead of stopping dead
   * at the edge, which is the whole difference between a handle and a hotspot.
   * Deltas are taken from `clientX/Y` rather than `movementX/Y`: the pointer is
   * not locked here, and the movement fields are the ones this game reads only
   * when it is.
   */
  private bindStage(stage: HTMLElement): void {
    let last: { x: number; y: number } | null = null;
    stage.addEventListener("pointerdown", (e) => {
      last = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add("turning");
    });
    stage.addEventListener("pointermove", (e) => {
      if (!last) return;
      this.dragX += e.clientX - last.x;
      this.dragY += e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
    });
    const end = () => {
      last = null;
      stage.classList.remove("turning");
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
  }

  /**
   * The drag since the last call, in pixels, and zeroed by reading it — the
   * same consume-on-read shape `InputManager` gives mouse look, so a frame
   * that never ran cannot turn the weapon twice.
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
   * pushed through the same call as the four picks because it moves the same
   * markup: a row appearing or going away is a redraw exactly as a pick is.
   */
  setFit(
    weapon: PrimaryWeaponId,
    sight: SightId,
    finish: FinishId,
    equipment: EquipmentId,
    armour: boolean,
  ): void {
    if (
      weapon === this.weapon &&
      sight === this.sight &&
      finish === this.finish &&
      equipment === this.equipment &&
      armour === this.armour
    )
      return;
    this.weapon = weapon;
    this.sight = sight;
    this.finish = finish;
    this.equipment = equipment;
    this.armour = armour;
    // A row that has just gone away cannot keep the cursor. Sent back to the
    // top rather than to a neighbour: the weapon row is where `show` opens
    // anyway, so this is the one answer that is never a surprise.
    if (!armour && this.slot === "equipment") this.slot = "weapon";
    this.draw();
  }

  /** The rows this map actually has. */
  private get rows(): readonly Slot[] {
    return this.armour ? ARMED_SLOTS : SLOTS;
  }

  show(): void {
    // Always open on the weapon row: it is the choice that changes the other
    // one's meaning, and a screen that remembers where you left the cursor
    // three deploys ago is a screen you have to look at before you can use it.
    this.slot = "weapon";
    this.root.classList.remove("hidden");
    // The screens this one covers are DOM, and the weapon it shows is not:
    // either of them left up would paint over the stage. The CSS carries the
    // rule; this is the flag it reads.
    document.getElementById("hud")!.classList.add("kitting");
    this.draw();
  }

  hide(): void {
    this.root.classList.add("hidden");
    document.getElementById("hud")!.classList.remove("kitting");
    // A drag interrupted by the screen closing must not turn the weapon on the
    // next open.
    this.dragX = 0;
    this.dragY = 0;
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** Steps the active slot — the menu's up/down. */
  moveSlot(delta: number): void {
    const rows = this.rows;
    const i = rows.indexOf(this.slot);
    this.slot = rows[(i + delta + rows.length) % rows.length];
    this.draw();
  }

  /**
   * Steps the choice inside the active slot, wrapping at both ends — the
   * menu's left/right. Reports it and leaves the drawing to `setFit`.
   */
  cycle(delta: number): void {
    if (this.slot === "weapon") {
      const n = PRIMARY_WEAPON_IDS.length;
      const i = PRIMARY_WEAPON_IDS.indexOf(this.weapon);
      this.onWeapon(PRIMARY_WEAPON_IDS[(i + delta + n) % n]);
    } else if (this.slot === "sight") {
      const i = SIGHT_IDS.indexOf(this.sight);
      this.onSight(SIGHT_IDS[(i + delta + SIGHT_IDS.length) % SIGHT_IDS.length]);
    } else if (this.slot === "equipment") {
      const n = EQUIPMENT_IDS.length;
      const i = EQUIPMENT_IDS.indexOf(this.equipment);
      this.onEquipment(EQUIPMENT_IDS[(i + delta + n) % n]);
    } else {
      // This weapon's own list, not every finish there is — the row wraps
      // through four, and the other twelve belong to guns that are not in the
      // player's hands.
      const ids = FINISHES_BY_WEAPON[this.weapon];
      const i = ids.indexOf(this.finish);
      this.onFinish(ids[(i + delta + ids.length) % ids.length]);
    }
  }

  /**
   * Rebuilds the whole body rather than patching it. It is two rows of
   * buttons and six bars, redrawn only when something is picked — and the
   * alternative is four places that have to agree on which button carries the
   * highlight.
   */
  private draw(): void {
    const weapons = PRIMARY_WEAPON_IDS.map((id) => {
      const w = CONFIG.weapons[id];
      return `
        <button class="lo-opt${id === this.weapon ? " on" : ""}" data-weapon="${id}">
          <b>${w.name}</b><i>${w.damage} dmg · ${fireMode(w)}</i>
        </button>`;
    }).join("");
    const sights = SIGHT_IDS.map(
      (id) => `
        <button class="lo-opt lo-optic${id === this.sight ? " on" : ""}" data-sight="${id}">
          <b>${CONFIG.sights[id].name}</b><i>${magLabel(id)}</i>
        </button>`,
    ).join("");
    // The swatch is what a finish button says instead of a figure: three
    // custom properties the CSS lays out as a strip along the top edge, in
    // the order the eye reads a weapon — furniture, receiver, fittings. It
    // takes the `i` row's place rather than sitting beside the name, so a
    // finish button measures exactly like a weapon's and the three rows stay
    // one control.
    const finishes = FINISHES_BY_WEAPON[this.weapon]
      .map((id) => {
        const [a, b, c] = finishSwatch(id);
        return `
        <button class="lo-opt lo-finish${id === this.finish ? " on" : ""}" data-finish="${id}"
                style="--sw-a:${a};--sw-b:${b};--sw-c:${c}">
          <b>${finishName(id)}</b>
        </button>`;
      })
      .join("");
    // The AT row's two, and what each button says under the name is the whole
    // of what separates them: how many you get and what sets one off. Both
    // figures are read off `CONFIG.equipment` rather than written here, the
    // rule every other row on this screen follows.
    const kit = EQUIPMENT_IDS.map((id) => {
      const e = CONFIG.equipment[id];
      return `
        <button class="lo-opt${id === this.equipment ? " on" : ""}" data-equip="${id}">
          <b>${e.name}</b><i>${e.carried} carried · ${e.damage} vs armour</i>
        </button>`;
    }).join("");
    const bars = weaponStats(this.weapon)
      .map(
        (s) => `
        <div class="lo-stat">
          <span class="lo-stat-name">${s.label}</span>
          <span class="lo-bar"><u style="width:${(s.frac * 100).toFixed(1)}%"></u></span>
          <span class="lo-stat-val">${s.value}</span>
        </div>`,
      )
      .join("");

    // The stage's own caption: what is actually on the turntable, named where
    // the eye already is rather than only over on the buttons — and the same
    // string in the panel's head, so the column doing the choosing says what
    // it has chosen without the eye crossing the bay to check.
    const carried = kitLabel(this.weapon, this.sight);
    this.stageCap.textContent = carried;
    this.carriedEl.textContent = carried;
    // The paint, named and described under the weapon it is on. Deliberately
    // NOT folded into `kitLabel`: that string is also the HUD's magazine
    // caption and the deploy screen's kit line, and neither of those is
    // anywhere the colour of the gun is a thing you are choosing.
    this.stageNote.innerHTML =
      `<b>${finishName(this.finish)}</b>${finishBlurb(this.finish)}`;

    this.body.innerHTML = `
      <div class="lo-slots">
        <div class="lo-slot${this.slot === "weapon" ? " active" : ""}" data-slot="weapon">
          <span class="lo-slot-name">Weapon</span>
          <div class="lo-opts">${weapons}</div>
        </div>
        <div class="lo-slot${this.slot === "sight" ? " active" : ""}" data-slot="sight">
          <span class="lo-slot-name">Optic</span>
          <div class="lo-opts">${sights}</div>
        </div>
        ${
          this.armour
            ? `<div class="lo-slot${this.slot === "equipment" ? " active" : ""}" data-slot="equipment">
          <span class="lo-slot-name">Anti-Tank</span>
          <div class="lo-opts">${kit}</div>
        </div>`
            : ""
        }
        <div class="lo-slot${this.slot === "finish" ? " active" : ""}" data-slot="finish">
          <span class="lo-slot-name">Finish</span>
          <div class="lo-opts">${finishes}</div>
        </div>
      </div>
      <div class="lo-detail frame">
        <div class="lo-stats">${bars}</div>
        <div class="lo-blurbs">
          <p class="lo-blurb">${WEAPON_BLURBS[this.weapon]}</p>
          <p class="lo-blurb dim">${SIGHT_BLURBS[this.sight]}</p>
          ${
            this.armour
              ? `<p class="lo-blurb dim">${EQUIPMENT_BLURBS[this.equipment]}</p>`
              : ""
          }
        </div>
      </div>
    `;

    this.body.querySelectorAll<HTMLElement>("button.lo-opt").forEach((btn) => {
      btn.onclick = () => {
        const w = btn.dataset.weapon;
        const f = btn.dataset.finish;
        const e = btn.dataset.equip;
        if (w) this.onWeapon(w as PrimaryWeaponId);
        else if (f) this.onFinish(f as FinishId);
        else if (e) this.onEquipment(e as EquipmentId);
        else this.onSight(btn.dataset.sight as SightId);
      };
    });
    // Hovering a row moves the keyboard slot with it, so the highlighted row
    // and the one the arrow keys are about to step can never disagree — the
    // same rule the pause menu's list follows.
    this.body.querySelectorAll<HTMLElement>(".lo-slot").forEach((row) => {
      row.onmouseenter = () => {
        const next = row.dataset.slot as Slot;
        if (next !== this.slot) {
          this.slot = next;
          this.draw();
        }
      };
    });
  }
}
