/**
 * TouchControls.ts — the on-screen controls a phone plays with: a floating
 * movement stick in the left zone, a free-look drag in the right one, and the
 * button cluster over both.
 * Owns: `#touch` and every finger that lands on it — the pointer-id bookkeeping,
 * the stick's origin, the ADS and scoreboard latches, and the look delta it
 * hands over consume-on-read. Owns NO game state: it is polled by
 * `InputManager` exactly as a gamepad is, and the three things it draws that it
 * cannot know (whether the body is crouched, whether the magazine is out, and
 * whether there is a hull in reach to get into or out of) are PUSHED by `Game`
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
 * - **The stick FLOATS.** Its ring is born wherever the thumb lands in the left
 *   zone rather than sitting in a fixed corner, so it is in the right place on
 *   every screen size and under every grip, and the thumb never has to look for
 *   it. It is also forgiving: a thumb that drags past the radius pulls the
 *   origin along instead of pinning at full deflection, so pulling back
 *   responds at once rather than after the slack is taken up.
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
 */
import "./touch.css";
import { CONFIG } from "../config";

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
   * `InputManager.usePressed` beside `E` and the pad's d-pad up, so nothing
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
   * Whether it is only on screen when the game says so — hidden until
   * `setUse` gives it a label, and hidden again the moment the offer goes.
   * Today the vehicle verb, and only that.
   */
  contextual?: boolean;
}

/**
 * The cluster, in DOM order. Position and size are CSS (`touch.css`) — this
 * list is what each button IS, and the sheet is where it sits, the same split
 * every other screen here makes.
 */
const BUTTONS: readonly ButtonSpec[] = [
  { id: "fire", label: "FIRE", kind: "hold", group: "main", look: true },
  { id: "ads", label: "ADS", kind: "latch", group: "main" },
  { id: "jump", label: "JUMP", kind: "tap", group: "main" },
  { id: "crouch", label: "CROUCH", kind: "tap", group: "main" },
  { id: "reload", label: "RELOAD", kind: "tap", group: "main" },
  { id: "grenade", label: "GRENADE", kind: "tap", group: "main" },
  { id: "swap", label: "SWAP", kind: "tap", group: "main" },
  // The only button here that is not always there. It is `contextual`, which
  // is one line of bookkeeping and the whole reason a phone can drive: `E` and
  // the pad's d-pad north are keys a player finds by pressing them, and glass
  // has neither — so the verb has to APPEAR when there is something to use and
  // say what it would do. `Game` pushes both facts (`setUse`), exactly as it
  // pushes the crouch lamp and the empty magazine, because this layer cannot
  // know it is standing next to a tank.
  { id: "use", label: "", kind: "tap", group: "main", contextual: true },
  // The collective, and the same bargain the verb above makes for the same
  // reason: a phone has no Space and no Ctrl, so the only way to fly one is for
  // the control to APPEAR when there is something to fly. `hold` and not
  // `tap`, because how long you hold it IS the input — a tap's one-frame floor
  // would be a machine that climbed in steps.
  { id: "climb", label: "UP", kind: "hold", group: "main", contextual: true },
  {
    id: "descend",
    label: "DOWN",
    kind: "hold",
    group: "main",
    contextual: true,
  },
  { id: "fire2", label: "FIRE", kind: "hold", group: "left", look: true },
  { id: "score", label: "SCORE", kind: "latch", group: "top" },
  { id: "menu", label: "MENU", kind: "tap", group: "top" },
];

/** The markup for one group's buttons. */
function groupMarkup(group: ButtonSpec["group"]): string {
  return BUTTONS.filter((b) => b.group === group)
    .map(
      (b) =>
        `<div class="tb tb-${b.id} frame${b.contextual ? " hidden" : ""}" data-act="${b.id}"><span>${b.label}</span></div>`,
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

  /** Where the floating stick was born, in client pixels. */
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
  /** Whether the collective pair is on screen. See `setFlying`. */
  private flying = false;

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
    const state = this.buttons.get("use")!;
    if (label !== null) state.el.firstElementChild!.textContent = label;
    else {
      state.down = false;
      state.pending = false;
      state.el.classList.remove("held");
    }
    state.el.classList.toggle("hidden", label === null);
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
    for (const id of ["climb", "descend"] as const) {
      const state = this.buttons.get(id)!;
      if (!on) {
        state.down = false;
        state.pending = false;
        state.el.classList.remove("held");
      }
      state.el.classList.toggle("hidden", !on);
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
    f.fire = this.held("fire") || this.held("fire2");
    f.ads = this.buttons.get("ads")!.latched;
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
    // Same rule, and the contextual button has a second half to it: the class
    // that hides it is not a look but the button's whole existence, so it goes
    // back on here or a round resumed on foot comes back offering a seat.
    this.useOffer = null;
    this.buttons.get("use")!.el.classList.add("hidden");
    this.flying = false;
    for (const id of ["climb", "descend"] as const) {
      this.buttons.get(id)!.el.classList.add("hidden");
    }
    this.moveX = 0;
    this.moveY = 0;
    this.sprinting = false;
    this.lookX = 0;
    this.lookY = 0;
    this.stick.classList.remove("live");
    this.moveZone.classList.remove("running");
  }

  /** Down, or pressed since the last frame looked. */
  private held(id: ButtonId): boolean {
    const state = this.buttons.get(id)!;
    return state.down || state.pending;
  }

  private claimStick(e: PointerEvent): void {
    e.preventDefault();
    // A second thumb in the left zone REPLACES the first rather than being
    // ignored: the common case is a player lifting and re-placing, and an
    // ignored press reads as a stick that has stopped working.
    for (const [id, role] of this.roles) if (role.kind === "stick") this.roles.delete(id);
    this.roles.set(e.pointerId, { kind: "stick" });
    this.capture(this.moveZone, e.pointerId);
    this.stickX = e.clientX;
    this.stickY = e.clientY;
    this.stick.style.left = `${e.clientX}px`;
    this.stick.style.top = `${e.clientY}px`;
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
      this.moveX = 0;
      this.moveY = 0;
      this.sprinting = false;
      this.stick.classList.remove("live");
      this.moveZone.classList.remove("running");
      this.knob.style.transform = "translate(-50%, -50%)";
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
   * Past the radius the ORIGIN follows the thumb rather than the output pinning
   * — the forgiveness every guide to this asks for. Without it a thumb that has
   * wandered 30 px past the rim has to travel those 30 px back before the
   * character slows at all, which reads as input lag and is why a fixed origin
   * feels stuck.
   */
  private driveStick(x: number, y: number): void {
    const r = CONFIG.touch.stickRadius;
    let dx = x - this.stickX;
    let dy = y - this.stickY;
    const dist = Math.hypot(dx, dy);
    if (dist > r) {
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
