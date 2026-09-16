/**
 * TouchControls.ts — the on-screen controls a phone plays with: a floating (or
 * fixed) movement stick in the left zone, a free-look drag in the right one,
 * and the button cluster over both.
 * Owns: `#touch` and every finger that lands on it — the pointer-id bookkeeping,
 * the stick's origin, the ADS and scoreboard latches, the round a fire press is
 * owed under aim-on-fire, and the look delta it hands over consume-on-read.
 * Owns NO game state: it is polled by `InputManager` exactly as a gamepad is,
 * and the things it cannot know (whether the body is crouched, whether the
 * magazine is out, whether there is a hull in reach to get into or out of, and
 * whether the trigger should aim and the sight is up yet) are PUSHED by `Game`
 * like every other HUD gauge.
 *
 * Invariants: `consume()` must be called exactly once per frame — it zeroes the
 * look accumulator and spends the one-frame floor under a tap. Every listener
 * calls `preventDefault`, which is what stops a tap on the fire button arriving
 * a moment later as a synthesized `mousedown` and convincing `InputManager`
 * that a mouse turned up. It never assigns `InputManager`'s fields directly and
 * never imports a system; `Game` wires it, and the pause button is a callback
 * out, never a state change taken here.
 *
 * WHY THE SHAPE IS WHAT IT IS. Every decision here is the one both Call of Duty
 * Mobile and Delta Force Mobile made, because the ergonomics are not a matter of
 * taste — two thumbs have to cover four jobs:
 *
 * - **The stick FLOATS, unless the player fixes it.** By default its ring is
 *   born wherever the thumb lands in the left zone rather than sitting in a
 *   fixed corner, so it is in the right place on every screen size and under
 *   every grip, and the thumb never has to look for it. It is also forgiving:
 *   a thumb that drags past the radius pulls the origin along instead of
 *   pinning at full deflection, so pulling back responds at once rather than
 *   after the slack is taken up.
 *   A FIXED stick (`Settings.touchStick`, CoD Mobile's "Fixed Joystick") is
 *   the other half of the same trade, and players who want it want it for the
 *   thing floating cannot do: the ring is always drawn in the corner and
 *   deflection is measured from ITS centre, so a thumb that lands off-centre
 *   moves the body on that frame without dragging first. Neither of the
 *   floating stick's forgiveness rules can apply to it — the origin cannot
 *   follow a thumb past the rim and still be fixed, and a touch that lands
 *   well away from the ring (`CONFIG.touch.fixedReach`) is not a claim on it.
 *   Where the ring sits is `touch.css`'s, and this file MEASURES it at the
 *   moment of the press rather than restating a number the sheet owns.
 * - **Sprint comes off the stick, not off a button** (CoD Mobile's "Joystick
 *   Sprint"): pushing to the rim runs. A button would cost a press with a thumb
 *   that is already busy, and there is no room for another one anyway.
 * - **The look is a DRAG, not a second stick.** A drag anywhere in the right
 *   zone turns the view, which is what makes a flick behind you one gesture.
 * - **The fire button steers.** Pressing it claims the finger AND starts a look
 *   drag, so the right thumb can hold the trigger and keep aiming — CoD Mobile
 *   ships this as the non-"Fixed R-Fire Button" behaviour, and without it the
 *   right thumb has to choose between shooting and looking, which is the single
 *   thing that makes a touch shooter unplayable. The second, smaller fire
 *   button on the left is for the claw grip, where a left finger shoots and the
 *   right thumb does nothing but aim.
 * - **ADS and the scoreboard LATCH; crouch does not.** A hold costs a thumb the
 *   player does not have, so tapping aims and tapping again lowers. Crouch is
 *   the exception because it must not own a second latch: `InputManager` already
 *   holds one for `C` and the pad's B, and this button flips that one on its
 *   rising edge exactly as they do. Which is also why the crouched LOOK of the
 *   button is pushed in rather than known here.
 * - **FIRE may also AIM** (`Settings.touchAutoAds`, CoD Mobile's "ADS fire").
 *   The ADS latch costs a tap before every fight, and it is the tap a phone
 *   player skips. With the option on, a finger on either fire button raises the
 *   sight, and the sight stays up for `CONFIG.touch.autoAds.linger` after the
 *   finger lifts so tapping out a semi-automatic stays aimed. **The round waits
 *   for the sight** (`setAutoAds`' `sightUp`, pushed by `Game`, which owns the
 *   blend): a round fired as the sight starts to rise goes out at hip spread,
 *   and hip spread here is 7.5x to 90x the aimed figure with no crosshair to
 *   say so. So a press is OWED a round: a tap that lifts before the sight
 *   arrives still fires once when it does, and the sight is held up until it
 *   has. `Game` decides whether it applies at all (on foot, and not with a
 *   mine), because this layer cannot know what the player is carrying.
 * - **THE CLUSTER IS THE CONTROLS OF WHATEVER THE PLAYER IS IN.** A body and a
 *   hull are two different jobs for the same two thumbs, so every button
 *   declares which MODES it belongs to (`ButtonSpec.modes`) and a button
 *   outside the one the player is in is OFF THE GLASS rather than dimmed —
 *   which is the rule `#hud-kit` and `#vehicle` already follow one layer up
 *   (`hud.css`). JUMP, CROUCH, RELOAD and GRENADE are a BODY's and go when the
 *   player boards; the collective takes two of the slots they left, which is
 *   what it was placed on and what used to draw straight over them; ADS is the
 *   body's sight or the GUNNER's optic and never a driver's; and the trigger
 *   itself goes on a hull whose driver has no main gun. `Game` pushes the mode
 *   (`setMode`) exactly as it pushes every other fact this layer cannot know.
 */
import "./touch.css";
import { CONFIG } from "../config";
import type { TouchStick } from "../core/settings";

/**
 * One frame of touch input, as `InputManager` folds it in.
 *
 * Held state, not edges — the same shape a gamepad is read in, so the existing
 * rising-edge bookkeeping over there does the work for both devices instead of
 * this file growing a second copy of it. The exception is the pair of latches
 * (`ads`, `scoreboard`), which are held BOOLEANS this file resolves, for the
 * reason in the header.
 */
export interface TouchFrame {
  /** Strafe/forward, -1..1, from the floating stick. */
  moveX: number;
  moveY: number;
  /** Look drag since the last consume, in CSS pixels. */
  lookX: number;
  lookY: number;
  fire: boolean;
  ads: boolean;
  sprint: boolean;
  /** Momentary: the rising edge flips `InputManager`'s shared crouch latch. */
  crouch: boolean;
  jump: boolean;
  reload: boolean;
  grenade: boolean;
  swap: boolean;
  scoreboard: boolean;
  /**
   * Momentary: get into or out of the hull in front of you. Folded into
   * `InputManager.usePressed` beside `E` and the pad's X, so nothing
   * downstream knows a finger asked.
   */
  use: boolean;
  /**
   * The COLLECTIVE, -1..1, from the two contextual buttons — folded into
   * `InputManager.lift` beside Space/Ctrl and the pad's A/B, so nothing
   * downstream knows a finger asked.
   */
  lift: number;
}

/**
 * What the thumbs are ON — a body's controls, or a crewed hull's, and which
 * chair. Pushed by `Game`; see `setMode`.
 *
 * The SEAT rather than the vehicle, because the two chairs are two different
 * sets of controls (a gunner has no sticks and no collective, a driver has no
 * optic) — and never the KIND, which nothing in this game branches on.
 */
export type TouchMode = "foot" | "driver" | "gunner";

/** What a finger currently on the glass is doing. */
type Role =
  | { kind: "stick" }
  | { kind: "look"; x: number; y: number }
  | { kind: "button"; id: ButtonId; look: boolean; x: number; y: number };

type ButtonId =
  | "fire"
  | "fire2"
  | "ads"
  | "jump"
  | "crouch"
  | "reload"
  | "grenade"
  | "swap"
  | "use"
  | "climb"
  | "descend"
  | "score"
  | "menu";

/** How a button answers a press. */
type ButtonKind =
  /** Reported held for as long as the finger is down. */
  | "hold"
  /** Reported held for at least one frame, then only while down. */
  | "tap"
  /** A press flips a latch this file keeps; reported held while it is on. */
  | "latch";

interface ButtonSpec {
  id: ButtonId;
  label: string;
  kind: ButtonKind;
  /** Which corner's group it belongs to — see `touch.css`. */
  group: "main" | "left" | "top";
  /** Whether a finger on it also drags the view. The fire buttons do. */
  look?: boolean;
  /**
   * Which modes this button is part of the controls FOR. Required rather than
   * defaulted, so a new button does not compile until it has answered the
   * question — the same bargain `SCREENS` makes of a new screen.
   *
   * Membership is only half of whether it is drawn: the rest is the pushed
   * facts `shows()` reads, and that one method is where the two meet.
   */
  modes: readonly TouchMode[];
}

/** Every mode, for the buttons that are the same job in all of them. */
const ANY: readonly TouchMode[] = ["foot", "driver", "gunner"];

/**
 * The cluster, in DOM order. Position and size are CSS (`touch.css`) — this
 * list is what each button IS, and the sheet is where it sits, the same split
 * every other screen here makes.
 */
const BUTTONS: readonly ButtonSpec[] = [
  { id: "fire", label: "FIRE", kind: "hold", group: "main", look: true, modes: ANY },
  // Aiming is the body's sight or the GUNNER's optic (`Game.opticUp`), and a
  // driver has neither: the view from that chair is the chase camera's, and
  // the gun it would raise is laid by the same look that steers it.
  { id: "ads", label: "ADS", kind: "latch", group: "main", modes: ["foot", "gunner"] },
  // The four a BODY has and a crewman does not, and the whole reason `modes`
  // exists: `touch.css` puts UP and DOWN on CROUCH's slot and the one above
  // the trigger on purpose, because Space and Ctrl are where a player who has
  // flown anything already reaches. While these stayed up in a hull, that
  // placement simply drew the collective on top of them.
  { id: "jump", label: "JUMP", kind: "tap", group: "main", modes: ["foot"] },
  { id: "crouch", label: "CROUCH", kind: "tap", group: "main", modes: ["foot"] },
  { id: "reload", label: "RELOAD", kind: "tap", group: "main", modes: ["foot"] },
  { id: "grenade", label: "GRENADE", kind: "tap", group: "main", modes: ["foot"] },
  // In every mode because it is TWO verbs on one button, exactly as the pad's
  // Y and this button already are to `InputManager`: the weapon swap on foot,
  // and crossing to the other chair in a hull. Which one it is saying is
  // `setSeatOffer`'s, for `setUse`'s reason — one vocabulary per verb.
  { id: "swap", label: "SWAP", kind: "tap", group: "main", modes: ANY },
  // The only button here that is not always there. It is gated on an offer,
  // which is one line of bookkeeping and the whole reason a phone can drive:
  // `E` and the pad's X are keys a player finds by pressing them, and glass
  // has neither — so the verb has to APPEAR when there is something to use and
  // say what it would do. `Game` pushes both facts (`setUse`), exactly as it
  // pushes the crouch lamp and the empty magazine, because this layer cannot
  // know it is standing next to a tank.
  { id: "use", label: "", kind: "tap", group: "main", modes: ANY },
  // The collective, and the same bargain the verb above makes for the same
  // reason: a phone has no Space and no Ctrl, so the only way to fly one is for
  // the control to APPEAR when there is something to fly. `hold` and not
  // `tap`, because how long you hold it IS the input — a tap's one-frame floor
  // would be a machine that climbed in steps. The DRIVER's alone, which is
  // stated here as well as gated by `setFlying`: a gunner has no sticks at all.
  { id: "climb", label: "UP", kind: "hold", group: "main", modes: ["driver"] },
  { id: "descend", label: "DOWN", kind: "hold", group: "main", modes: ["driver"] },
  { id: "fire2", label: "FIRE", kind: "hold", group: "left", look: true, modes: ANY },
  { id: "score", label: "SCORE", kind: "latch", group: "top", modes: ANY },
  { id: "menu", label: "MENU", kind: "tap", group: "top", modes: ANY },
];

/** The markup for one group's buttons. */
function groupMarkup(group: ButtonSpec["group"]): string {
  return BUTTONS.filter((b) => b.group === group)
    .map(
      (b) =>
        `<div class="tb tb-${b.id} frame" data-act="${b.id}"><span>${b.label}</span></div>`,
    )
    .join("");
}

/** The state one button is in, between frames. */
interface ButtonState {
  el: HTMLElement;
  spec: ButtonSpec;
  /** A finger is on it right now. */
  down: boolean;
  /** A press no frame has seen yet — the one-frame floor under a fast tap. */
  pending: boolean;
  /** `latch` buttons only. */
  latched: boolean;
}

export class TouchControls {
  /** The pause button. `Game` wires it; nothing here changes a state. */
  onPause: () => void = () => {};

  private readonly root: HTMLElement;
  private readonly moveZone: HTMLElement;
  private readonly lookZone: HTMLElement;
  private readonly stick: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons = new Map<ButtonId, ButtonState>();
  /** Every finger on the glass, by `pointerId`. */
  private readonly roles = new Map<number, Role>();

  /** Whether the stick is fixed in the corner. See `setStickMode`. */
  private fixed = false;
  /** Where the stick was born (floating) or its ring's centre (fixed), in
   * client pixels. */
  private stickX = 0;
  private stickY = 0;
  /** Its deflection, -1..1, y positive forward. */
  private moveX = 0;
  private moveY = 0;
  private sprinting = false;
  /** Look drag accumulated since the last `consume()`. */
  private lookX = 0;
  private lookY = 0;
  private visible = false;
  /** Pushed in by `Game`; see the header on why these are not known here. */
  private crouched = false;
  private reloadDue = false;
  /** What the vehicle verb would do right now, or null when it would do
   * nothing. Also the button's label — see `setUse`. */
  private useOffer: string | null = null;
  /** What the thumbs are on. Pushed; see `setMode`. */
  private mode: TouchMode = "foot";
  /** Whether pulling the trigger would do anything at all. Pushed with the
   * mode, and false only for the driver of an unarmed hull. */
  private trigger = true;
  /** How this player would change SEATS, or null when they would not — which
   * on foot is always, the button being the weapon swap there. See
   * `setSeatOffer`. */
  private seatOffer: string | null = null;
  /** Whether the collective pair is on screen. See `setFlying`. */
  private flying = false;
  /** Whether a fire button also aims right now. Pushed; see `setAutoAds`. */
  private autoAds = false;
  /** Whether the sight is far enough up for a round to leave. Pushed. */
  private sightUp = false;
  /** A fire press that has not produced a trigger frame yet. See the header. */
  private shotOwed = false;
  /** `performance.now()` until which the sight stays up after a lift. */
  private aimUntil = 0;

  /** Reused, because `consume()` runs every frame of every touch round. */
  private readonly frame: TouchFrame = {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
    fire: false,
    ads: false,
    sprint: false,
    crouch: false,
    jump: false,
    reload: false,
    grenade: false,
    swap: false,
    scoreboard: false,
    use: false,
    lift: 0,
  };

  constructor() {
    const hud = document.getElementById("hud")!;
    this.root = document.createElement("div");
    this.root.id = "touch";
    this.root.className = "hidden";
    // The radius is a number the maths reads and a ring the player sees, so it
    // is published rather than restated — the rule `CONFIG.touch` states and
    // the one the minimap's backing store follows.
    this.root.style.setProperty("--stick-r", `${CONFIG.touch.stickRadius}px`);
    this.root.style.setProperty("--move-zone", `${CONFIG.touch.moveZone * 100}%`);
    this.root.innerHTML = `
      <div id="touch-move"><div id="touch-stick" class="frame"><i></i></div></div>
      <div id="touch-look"></div>
      <div class="tb-group g-main">${groupMarkup("main")}</div>
      <div class="tb-group g-left">${groupMarkup("left")}</div>
      <div class="tb-group g-top">${groupMarkup("top")}</div>
    `;
    hud.appendChild(this.root);
    this.moveZone = this.root.querySelector("#touch-move") as HTMLElement;
    this.lookZone = this.root.querySelector("#touch-look") as HTMLElement;
    this.stick = this.root.querySelector("#touch-stick") as HTMLElement;
    this.knob = this.stick.querySelector("i") as HTMLElement;
    for (const spec of BUTTONS) {
      const el = this.root.querySelector(`.tb-${spec.id}`) as HTMLElement;
      this.buttons.set(spec.id, { el, spec, down: false, pending: false, latched: false });
      el.addEventListener("pointerdown", (e) => this.pressButton(e, spec.id, el));
    }
    // What is on the glass is never written into the markup: `refresh` is the
    // one place that decides it, so the cluster a round opens with and the one
    // a mode change leaves behind are the same computation.
    this.refresh();
    this.moveZone.addEventListener("pointerdown", (e) => this.claimStick(e));
    this.lookZone.addEventListener("pointerdown", (e) => this.claimLook(e));
    // On the window rather than per element: a captured pointer retargets to
    // whatever claimed it but still bubbles here, so one handler serves the
    // stick, the look zone and every button — and a finger that leaves the
    // element it started on, or the viewport entirely, is still heard.
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.release(e));
    window.addEventListener("pointercancel", (e) => this.release(e));
    // A phone that backgrounds mid-fight (a call, the app switcher) delivers no
    // `pointerup` at all. Without this the trigger is still held when it comes
    // back, and the round resumes firing at nothing.
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
  }

  /**
   * Whether the controls are on screen. `Game` pushes it — they belong to
   * `playing` and to nothing else, so a lid, a death cam or a deploy map takes
   * them away, and taking them away drops everything being held. That last part
   * is the whole reason this is not a CSS class: a pause with the trigger down
   * must not come back with the trigger down.
   */
  setVisible(on: boolean): void {
    if (on === this.visible) return;
    this.visible = on;
    this.root.classList.toggle("hidden", !on);
    if (!on) this.releaseAll();
  }

  /** Whether the body is crouched, so the button can say so. Guarded. */
  setCrouched(on: boolean): void {
    if (on === this.crouched) return;
    this.crouched = on;
    this.buttons.get("crouch")!.el.classList.toggle("on", on);
  }

  /**
   * Whether the magazine is empty or filling. Guarded.
   *
   * A phone player has no eye to spare for the ammo readout in the corner, and
   * the weapon reloads itself on the last round anyway — so the button is the
   * one place the news can arrive in peripheral vision.
   */
  setReloadDue(on: boolean): void {
    if (on === this.reloadDue) return;
    this.reloadDue = on;
    this.buttons.get("reload")!.el.classList.toggle("due", on);
  }

  /**
   * What the vehicle verb is being offered right now — the same sentence the
   * HUD's prompt carries on a keyboard (`ENTER TANK`, `TAKE OVER TANK`, `EXIT
   * TANK`) — or null when there is nothing in reach. Guarded.
   *
   * ONE label rather than a short one of its own, because two vocabularies for
   * one verb is how a player ends up believing the button on the glass and the
   * prompt on the HUD are different controls. The button is sized and its type
   * scaled in `touch.css` to take the longest of them on two lines.
   *
   * Taking the offer away also LETS GO of the button: a finger resting on
   * `EXIT TANK` when the hull brews up is a finger that would otherwise still
   * be reported held once the next offer put the button back.
   */
  setUse(label: string | null): void {
    if (label === this.useOffer) return;
    this.useOffer = label;
    this.refresh();
  }

  /**
   * What the SWAP button would do to the SEATS right now — the same sentence
   * `Game.swapPrompt` gives the HUD (`TAKE OVER GUN`, `SWAP SEAT`) — or null
   * when it would do nothing to them, which is every frame on foot and the
   * frames in a hull whose other chair a PERSON is in. Guarded.
   *
   * It is the label AND the gate, for `setUse`'s reason twice over. One
   * vocabulary per verb, so the words on the glass and the words on the HUD
   * cannot come apart; and a button that would do nothing is off the glass
   * rather than dead under a thumb — in a hull there is no weapon swap left
   * for it to fall back on, `Player.update` not being called there at all.
   *
   * On foot it is null and the button is its own plain self, which is why this
   * is an OFFER rather than a label: the two are different controls sharing
   * one key everywhere else in the game, and `shows()` reads it as one.
   */
  setSeatOffer(label: string | null): void {
    if (label === this.seatOffer) return;
    this.seatOffer = label;
    this.refresh();
  }

  /**
   * What the thumbs are on, and whether the trigger under them does anything.
   * Pushed by `Game` every frame the controls are up; guarded on the pair.
   *
   * See the header: a button outside the current mode is off the glass rather
   * than dimmed, and this is the push that moves the whole cluster between a
   * body's controls and a hull's. `armed` is the one thing the mode cannot say
   * on its own — a DRIVER has a main gun only on a hull that has one
   * (`Vehicle.armed`; the truck and the gunship have none, and `gunReady` is
   * already false there), and a trigger that fires nothing is the same bad
   * bargain a collective in a gunner's chair would be.
   */
  setMode(mode: TouchMode, armed: boolean): void {
    if (mode === this.mode && armed === this.trigger) return;
    this.mode = mode;
    this.trigger = armed;
    this.refresh();
  }

  /**
   * Whether there is a collective to pull, pushed by `Game` exactly as the
   * verb above is and for the identical reason: this layer cannot know what a
   * player is sitting in, and a phone has no key to discover.
   *
   * The pair goes away for a GUNNER as well as for a walking body — a gunner
   * has no sticks at all, and two buttons that move nothing are worse than no
   * buttons. Letting go on the way out matters here more than it does for the
   * verb: a finger resting on UP when the pilot swaps seats would otherwise be
   * reported held for as long as it stayed there.
   */
  setFlying(on: boolean): void {
    if (on === this.flying) return;
    this.flying = on;
    this.refresh();
  }

  /**
   * Whether one button is on the glass right now — the ONE place that decides
   * it, which is what lets the mode table and four pushed facts meet without
   * any of them having to know the others exist.
   *
   * Membership in the mode first, then whatever that particular button is
   * additionally waiting on. The switch is over the few with a second gate;
   * the default is the answer for every button that is simply part of the
   * controls it belongs to.
   */
  private shows(spec: ButtonSpec): boolean {
    if (!spec.modes.includes(this.mode)) return false;
    switch (spec.id) {
      case "fire":
      case "fire2":
        return this.trigger;
      case "use":
        return this.useOffer !== null;
      case "climb":
      case "descend":
        return this.flying;
      case "swap":
        return this.mode === "foot" || this.seatOffer !== null;
      default:
        return true;
    }
  }

  /**
   * Draws the cluster the pushed facts describe, and LETS GO of everything
   * that just left it.
   *
   * The letting go is the load-bearing half rather than tidiness: a finger
   * resting on `EXIT TANK` when the hull brews up, or on UP when the pilot
   * swaps seats, would otherwise still be reported held for as long as it
   * stayed there — and a LATCH on a button that is no longer drawn is one the
   * player can neither see nor turn off, which is how a body comes back out of
   * a tank already aiming down its sights. The finger's ROLE goes with it, or
   * a thumb still down on a vanished fire button keeps dragging the view.
   *
   * What does NOT go is the pushed LOOK of a button — the crouch lamp, the
   * empty magazine — because both are still true of the body waiting outside,
   * and their setters are guarded on the value they last wrote.
   */
  private refresh(): void {
    const swap = this.buttons.get("swap")!;
    swap.el.firstElementChild!.textContent = this.seatOffer ?? swap.spec.label;
    swap.el.classList.toggle("saying", this.seatOffer !== null);
    if (this.useOffer !== null) {
      this.buttons.get("use")!.el.firstElementChild!.textContent = this.useOffer;
    }
    for (const state of this.buttons.values()) {
      const on = this.shows(state.spec);
      // Already right, and that guard is what makes this cheap enough to be
      // the only path: `Game` pushes the mode every frame of every round.
      if (on === !state.el.classList.contains("hidden")) continue;
      state.el.classList.toggle("hidden", !on);
      if (on) continue;
      state.down = false;
      state.pending = false;
      state.latched = false;
      state.el.classList.remove("held", "lit");
      for (const [pid, role] of this.roles) {
        if (role.kind === "button" && role.id === state.spec.id) this.roles.delete(pid);
      }
    }
  }

  /**
   * Floating or fixed, from the player's settings. `Game.applySettings` pushes
   * it on load and on every change; guarded, so the push can be unconditional.
   *
   * A thumb on the stick is let go of on a change, which the settings screen
   * already guarantees (the controls are not up while it is) and this does not
   * rely on: a stick claimed under one rule and driven under the other would
   * measure from a floating origin that the fixed rule never moves again. The
   * floating stick's last inline position goes too, or it would override the
   * corner the sheet gives the fixed one.
   */
  setStickMode(mode: TouchStick): void {
    const fixed = mode === "fixed";
    if (fixed === this.fixed) return;
    this.fixed = fixed;
    for (const [id, role] of this.roles) if (role.kind === "stick") this.roles.delete(id);
    this.dropStick();
    this.stick.style.left = "";
    this.stick.style.top = "";
    this.root.classList.toggle("fixed-stick", fixed);
  }

  /**
   * Whether a fire button also aims right now, and whether the sight is far
   * enough up for the round to leave. Pushed by `Game` every frame the
   * controls are up.
   *
   * `armed` is the setting AND what the player is doing: `Game` sends false in
   * a vehicle and with a mine in hand, which this layer cannot tell apart from
   * a rifle. `sightUp` is `CameraSystem.adsBlend` against
   * `CONFIG.touch.autoAds.fireAt` — the one number here this layer cannot
   * know, and a frame old by the time it is read, which is inside the blend's
   * own time constant.
   *
   * Disarming drops an owed round and the linger with it: a tap owed while
   * walking must not fire the moment the player is next armed.
   */
  setAutoAds(armed: boolean, sightUp: boolean): void {
    this.sightUp = sightUp;
    if (armed === this.autoAds) return;
    this.autoAds = armed;
    if (!armed) {
      this.shotOwed = false;
      this.aimUntil = 0;
    }
  }

  /**
   * The frame's input, spent by reading it: the look delta is zeroed and the
   * one-frame floor under every tap is cleared, so a frame that never ran
   * cannot fire a shot twice and a tap between two frames cannot be lost.
   */
  consume(): TouchFrame {
    const f = this.frame;
    f.moveX = this.moveX;
    f.moveY = this.moveY;
    f.sprint = this.sprinting;
    f.lookX = this.lookX;
    f.lookY = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    const firing = this.held("fire") || this.held("fire2");
    let aimed = false;
    if (this.autoAds) {
      // The trigger is the finger OR a round a tap is still owed, and neither
      // is let through before the sight is up. Spending the debt on the first
      // frame the trigger is reported is what makes a tap one round: a
      // semi-automatic sees one rising edge, an automatic one frame of trigger.
      const now = performance.now();
      if (firing) this.aimUntil = now + CONFIG.touch.autoAds.linger * 1000;
      aimed = firing || this.shotOwed || now < this.aimUntil;
      f.fire = (firing || this.shotOwed) && this.sightUp;
      if (f.fire) this.shotOwed = false;
    } else {
      f.fire = firing;
    }
    f.ads = this.buttons.get("ads")!.latched || aimed;
    f.scoreboard = this.buttons.get("score")!.latched;
    f.crouch = this.held("crouch");
    f.jump = this.held("jump");
    f.reload = this.held("reload");
    f.grenade = this.held("grenade");
    f.swap = this.held("swap");
    f.use = this.held("use");
    f.lift = (this.held("climb") ? 1 : 0) - (this.held("descend") ? 1 : 0);
    for (const state of this.buttons.values()) state.pending = false;
    return f;
  }

  /** Lets go of everything: fingers, latches, the stick and the ring. */
  releaseAll(): void {
    this.roles.clear();
    for (const state of this.buttons.values()) {
      state.down = false;
      state.pending = false;
      state.latched = false;
      state.el.classList.remove("held", "lit", "on", "due");
    }
    // The two PUSHED states go with them, and that pair of lines is the whole
    // reason this is not just a class sweep: both setters guard on the value
    // they last wrote, so clearing the class without clearing the field leaves
    // a guard that will never write it again — the crouch lamp would stay off
    // for the rest of a round the player spent crouched.
    this.crouched = false;
    this.reloadDue = false;
    // Same rule, and the facts that decide what is on the glass AT ALL have a
    // second half to it: the class that hides a button is not a look but the
    // button's whole existence, so they go back to what a body outside a hull
    // has — or a round resumed on foot comes back offering a seat, and one
    // resumed in a tank comes back with a rifle's controls over the tank's.
    // `refresh` is what draws the answer, here as everywhere else.
    this.useOffer = null;
    this.flying = false;
    this.mode = "foot";
    this.trigger = true;
    this.seatOffer = null;
    this.refresh();
    // And aim-on-fire's pushed pair, for the same reason: a round owed when a
    // pause came down must not leave the moment the round resumes.
    this.autoAds = false;
    this.sightUp = false;
    this.shotOwed = false;
    this.aimUntil = 0;
    this.lookX = 0;
    this.lookY = 0;
    this.dropStick();
  }

  /**
   * The stick with no thumb on it: centred, not running, and — floating — gone.
   *
   * The knob goes back to the middle here rather than on the next claim,
   * which the floating stick never needed because nobody sees its ring idle.
   * A fixed ring is always drawn, so a knob left where the thumb let go would
   * show a stick still pushed.
   */
  private dropStick(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.sprinting = false;
    this.stick.classList.remove("live");
    this.moveZone.classList.remove("running");
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  /** Down, or pressed since the last frame looked. */
  private held(id: ButtonId): boolean {
    const state = this.buttons.get(id)!;
    return state.down || state.pending;
  }

  private claimStick(e: PointerEvent): void {
    e.preventDefault();
    let originX = e.clientX;
    let originY = e.clientY;
    if (this.fixed) {
      // Measured off the ring rather than restated: the sheet places it, with
      // the safe-area insets a number here would not know about. It is not
      // moved while fixed, so the box a press measures is the box the whole
      // drag happens in.
      const box = this.stick.getBoundingClientRect();
      originX = box.left + box.width / 2;
      originY = box.top + box.height / 2;
      const reach = CONFIG.touch.fixedReach * CONFIG.touch.stickRadius;
      if (Math.hypot(e.clientX - originX, e.clientY - originY) > reach) return;
    }
    // A second thumb in the left zone REPLACES the first rather than being
    // ignored: the common case is a player lifting and re-placing, and an
    // ignored press reads as a stick that has stopped working.
    for (const [id, role] of this.roles) if (role.kind === "stick") this.roles.delete(id);
    this.roles.set(e.pointerId, { kind: "stick" });
    this.capture(this.moveZone, e.pointerId);
    this.stickX = originX;
    this.stickY = originY;
    if (!this.fixed) {
      this.stick.style.left = `${originX}px`;
      this.stick.style.top = `${originY}px`;
    }
    this.stick.classList.add("live");
    this.driveStick(e.clientX, e.clientY);
  }

  private claimLook(e: PointerEvent): void {
    e.preventDefault();
    // Same replacement rule as the stick, and here it also stops two fingers
    // resting in the right zone from turning the view at twice the speed.
    for (const [id, role] of this.roles) if (role.kind === "look") this.roles.delete(id);
    this.roles.set(e.pointerId, { kind: "look", x: e.clientX, y: e.clientY });
    this.capture(this.lookZone, e.pointerId);
  }

  private pressButton(e: PointerEvent, id: ButtonId, el: HTMLElement): void {
    e.preventDefault();
    const state = this.buttons.get(id)!;
    // Captured on the BUTTON, so a thumb that slides off it keeps firing until
    // it lifts — which is exactly what happens when the fire button is also
    // steering the view.
    this.capture(el, e.pointerId);
    this.roles.set(e.pointerId, {
      kind: "button",
      id,
      look: state.spec.look === true,
      x: e.clientX,
      y: e.clientY,
    });
    state.down = true;
    state.pending = true;
    el.classList.add("held");
    // A press owes a round when the trigger also aims, so a tap that lifts
    // before the sight is up is still a shot. See the header.
    if (this.autoAds && (id === "fire" || id === "fire2")) this.shotOwed = true;
    if (state.spec.kind === "latch") {
      state.latched = !state.latched;
      el.classList.toggle("lit", state.latched);
    }
    // The one button that is not input at all: it asks `Game` for the pause
    // menu, which is the only way off a round on a device with no Escape key.
    if (id === "menu") this.onPause();
  }

  private move(e: PointerEvent): void {
    const role = this.roles.get(e.pointerId);
    if (!role) return;
    e.preventDefault();
    if (role.kind === "stick") {
      this.driveStick(e.clientX, e.clientY);
      return;
    }
    // Both remaining roles are a drag: the look zone's, and a fire button that
    // is steering. `clientX/Y` differences rather than `movementX/Y` — the
    // pointer is not locked here, and the movement fields are what this game
    // reads only when it is (the same call `LoadoutScreen`'s turntable makes).
    if (role.kind === "look" || role.look) {
      this.lookX += e.clientX - role.x;
      this.lookY += e.clientY - role.y;
      role.x = e.clientX;
      role.y = e.clientY;
    }
  }

  private release(e: PointerEvent): void {
    const role = this.roles.get(e.pointerId);
    if (!role) return;
    this.roles.delete(e.pointerId);
    if (role.kind === "stick") {
      this.dropStick();
      return;
    }
    if (role.kind !== "button") return;
    const state = this.buttons.get(role.id)!;
    state.down = false;
    state.el.classList.remove("held");
  }

  /**
   * Where the thumb is against where the stick was born.
   *
   * Past the radius a FLOATING stick's ORIGIN follows the thumb rather than the
   * output pinning — the forgiveness every guide to this asks for. Without it
   * a thumb that has wandered 30 px past the rim has to travel those 30 px back
   * before the character slows at all, which reads as input lag. A FIXED stick
   * pins instead, knob at the rim: that slack is the price of an origin that
   * never moves, and the player who chose it chose that.
   */
  private driveStick(x: number, y: number): void {
    const r = CONFIG.touch.stickRadius;
    let dx = x - this.stickX;
    let dy = y - this.stickY;
    const dist = Math.hypot(dx, dy);
    if (dist > r && this.fixed) {
      dx *= r / dist;
      dy *= r / dist;
    } else if (dist > r) {
      const pull = (dist - r) / dist;
      this.stickX += dx * pull;
      this.stickY += dy * pull;
      dx = x - this.stickX;
      dy = y - this.stickY;
      this.stick.style.left = `${this.stickX}px`;
      this.stick.style.top = `${this.stickY}px`;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const mag = Math.min(1, Math.hypot(dx, dy) / r);
    if (mag < CONFIG.touch.stickDeadzone) {
      this.moveX = 0;
      this.moveY = 0;
    } else {
      // Rescaled out of the deadzone rather than reported raw, so the first
      // millimetre past it is a crawl and not a jump to a tenth of full speed.
      const scale = ((mag - CONFIG.touch.stickDeadzone) / (1 - CONFIG.touch.stickDeadzone)) / mag;
      this.moveX = dx * scale * (1 / r);
      this.moveY = -dy * scale * (1 / r);
      this.moveX = Math.max(-1, Math.min(1, this.moveX));
      this.moveY = Math.max(-1, Math.min(1, this.moveY));
    }
    // Sprint off the rim, with hysteresis either side of it (CONFIG.touch).
    const forward = this.moveY;
    if (!this.sprinting && forward >= CONFIG.touch.sprintPush) this.sprinting = true;
    else if (this.sprinting && forward < CONFIG.touch.sprintDrop) this.sprinting = false;
    this.moveZone.classList.toggle("running", this.sprinting);
    // A latched aim would otherwise make the sprint unreachable: `Player` will
    // not run with a sight up, so the latch has to go when the thumb asks to.
    if (this.sprinting) {
      const ads = this.buttons.get("ads")!;
      if (ads.latched) {
        ads.latched = false;
        ads.el.classList.remove("lit");
      }
    }
  }

  /** Pointer capture, tolerating a browser that refuses (it is an optimisation). */
  private capture(el: HTMLElement, id: number): void {
    try {
      el.setPointerCapture(id);
    } catch {
      /* the window-level handlers still see the move; only the retarget is lost */
    }
  }
}
