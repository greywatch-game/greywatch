/**
 * DeployScreen.ts — The between-lives screen: a title screen for the POSITION
 * the cursor is on, laid out the way the main menu, the kit screen, the
 * settings screen and the lobby are. Paints the shared plan of the built world
 * (`mapPlan.ts`/`mapPaint.ts`) as the screen's stage, draws the live flags and
 * the spawn options over it, keeps the cursor on a spawn, and fires onDeploy
 * (wired in Game) when a selection is confirmed.
 * Owns `#deploy`, its cursor, and the `#hud.deploying` flag that takes the
 * gameplay chrome off the glass while it is up (the tickets and the flags are
 * drawn HERE now, so the HUD's copies under the scrim would be a second,
 * unreadable statement of the same thing).
 * Invariants: the plan is PRERENDERED and blitted — this screen redraws every
 * frame and the biggest map is 3,700 colliders — so anything added to the
 * static ground belongs in the painter and anything that changes inside a
 * round belongs in `draw`. The offer is derived from flag ownership and changes
 * UNDER the cursor, so the cursor is held by identity (`selectedSpawn`) and
 * never as an index. Every per-frame write is compared before it is made. What
 * `onDeploy` means is the caller's: offline Game deploys, in a netplay round it
 * sends a request and `setPending` is how this screen says so. Reads no input:
 * `Game` calls the verbs (`moveSelection`, `confirm`) and pushes the device.
 *
 * **IT IS A FRONT END, NOT A FORM.** It read as one: a heading reading "Select
 * deployment" over a square map in a black veil, a status box, a Deploy button
 * and a loadout bar floating in a column beside it, and a hint line naming
 * three devices along the bottom. Now the POSITION is the title — the name of
 * the place you are about to stand in, set large, with the flag's letter hollow
 * behind it and the round's standing under it. The map is the STAGE, the one
 * thing on this screen a player reads a decision off. The positions are a
 * column of plates the cursor walks, with the kit and Deploy closing the column
 * as they do on the menu; an INTEL plate says what the cursor's position is
 * like right now and how the round stands; Pause is the system corner.
 */
import "./deploy.css";
import { CONFIG } from "../config";
import { OTHER_TEAM, type Team } from "../entities/Combatant";
import { teamLook } from "../core/teamView";
import {
  paintFlagIcon,
  paintPlan,
  paintZone,
  px,
  py,
  type PlanView,
} from "./mapPaint";
import { planFromWorld } from "./mapPlan";
import { glyph, guessDevice, markDevice, type InputDevice } from "./prompts";
import type { ControlPoint, ConquestSystem } from "../systems/ConquestSystem";
import type { EnvironmentSpec } from "../world/environment";
import type { GameMap, SpawnPointDef } from "../world/MapBuilder";

/** Line icons in the menu's own drawing: a 24-unit box, square caps, no fill. */
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter">${d}</svg>`;
const ICON_PAUSE = svg(`<path d="M8 5v14M16 5v14"/>`);

/**
 * What one offered position is right now, read off the conquest state once a
 * frame and shared by the plate, the title and the intel so the three cannot
 * describe the same place three ways.
 */
interface Position {
  spawn: SpawnPointDef;
  /** The flag it belongs to, or null for the home base. */
  point: ControlPoint | null;
  name: string;
  /** The flag's letter, or "HQ" for the home base. */
  letter: string;
  /**
   * `home` is always offered; `held` is a flag of ours with nobody else in it;
   * `attack` is a flag of ours the enemy is standing in alone — still offered,
   * because it is still ours until the meter crosses zero, and the one state a
   * player most needs told before they drop into it. (A CONTESTED flag is not
   * offered at all — `ConquestSystem.flagSpawnsFor`.)
   */
  state: "home" | "held" | "attack";
  /** 0..1, how far the meter stands toward our side. */
  control: number;
  friends: number;
  foes: number;
}

const STATE_WORD: Record<Position["state"], string> = {
  home: "Always open",
  held: "Held",
  attack: "Under attack",
};

/** What deploying at a position MEANS, in a sentence — the intel's paragraph. */
function positionBlurb(p: Position): string {
  if (p.state === "home") {
    return "Your side's own ground at the edge of the map. It can never be taken, so it is always offered — and it is the longest walk to the fight.";
  }
  if (p.state === "attack") {
    return "The enemy is inside the zone and the meter is falling toward them. Deploying here puts you straight into its defence.";
  }
  return p.control < 0.999
    ? "Held by your side and quiet, with the meter still climbing back. You come back on the flag itself."
    : "Held by your side and quiet. You come back on the flag itself, a short run from wherever the fight has moved.";
}

/** A 1-based index as two digits: the title's counter. */
const twoDigits = (n: number) => String(n).padStart(2, "0");

/** What `update` last put on screen, so it can patch rather than rewrite. */
interface Shown {
  /** Every option's identity, in order — the list's SHAPE. */
  keys: string;
  heroKey: string;
  intelKey: string;
  facts: string;
}

export class DeployScreen {
  private root: HTMLElement;
  private kickerEl: HTMLElement;
  private heroEl: HTMLElement;
  private listEl: HTMLElement;
  private kitW: HTMLElement;
  private kitS: HTMLElement;
  /** The confirm button; drawn waiting until the reinforcement clock runs out. */
  private goBtn: HTMLElement;
  private goSub: HTMLElement;
  private goNum: HTMLElement;
  private goFill: HTMLElement;
  private intelPos: HTMLElement;
  private roundEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private device: InputDevice = guessDevice();

  /** Wired by Game. */
  onDeploy: (spawn: SpawnPointDef) => void = () => {};
  /** Wired by Game: the player wants the loadout screen before dropping in. */
  onOpenLoadout: () => void = () => {};
  /**
   * Wired by Game: the system corner's Pause. A phone has no Escape key and the
   * touch controls' own pause button is not up on this screen, so without it
   * there is no way off a round from here under a finger at all.
   */
  onPause: () => void = () => {};

  private map: GameMap | null = null;
  private conquest: ConquestSystem | null = null;
  /**
   * The palette the plan is drawn in, handed over with the map it belongs to.
   *
   * Definitely assigned rather than defaulted, and there is no map to default
   * TO: every colour on the plan is derived from the standing map's own
   * environment (see `mapPaint.ts`), and one named map borrowed as a fallback
   * would draw a desert town in a night village's palette on whatever frame
   * went wrong. Nothing reads it before `show`, which is the only door a map
   * arrives through and the only thing that fills `this.map` in.
   */
  private env!: EnvironmentSpec;
  private team: Team = 0;
  private options: SpawnPointDef[] = [];
  private positions: Position[] = [];
  private selected = 0;
  /**
   * The spawn the cursor is ON, as an object rather than as a position in the
   * list.
   *
   * The list is derived from flag ownership and re-derived every frame, so in a
   * networked round it changes UNDER the cursor: a flag falling two hundred
   * metres away removes a row, everything below it shifts up, and a carried
   * index quietly becomes a different place — which the player then deploys to
   * with their hand already on Enter. Identity is what keeps the cursor on what
   * it was put on; when that spawn stops being offered it falls back to the
   * home base, which is the one row that can never disappear.
   */
  private selectedSpawn: SpawnPointDef | null = null;
  /** Screen-space hit targets, rebuilt every draw. */
  private hotspots: { x: number; y: number; r: number; index: number }[] = [];
  /**
   * The prerendered plan and the two facts it is only valid for — the map it
   * was drawn of and the backing store it was drawn at. Dropped rather than
   * patched when either moves: it is one call to make again.
   */
  private base: HTMLCanvasElement | null = null;
  private baseFor: GameMap | null = null;
  private baseSize = 0;
  /** Where the world lands on the canvas. Written by `buildBase`. */
  private view: PlanView = { scale: 1, ox: 0, oy: 0 };
  private ready = false;
  /**
   * How long the wait was when this screen was raised, so the Deploy plate can
   * fill over it. The longest `remaining` seen since `show`: the first update
   * after a death is the clock's full length less what the death cam spent.
   */
  private waitFor = 0;
  /** The spawn a networked deploy has been requested at, until it is granted. */
  private pendingSpawn: SpawnPointDef | null = null;
  /** The clock's last reading, so a pick made by the pointer can redraw at once. */
  private lastRemaining = 0;
  private shown: Shown | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "deploy";
    this.root.className = `hidden dev-${this.device}`;
    // Every block is a named grid AREA, so a phone's layout is a change of
    // template in the stylesheet rather than a second copy of this markup —
    // the rule every front-end screen here keeps.
    this.root.innerHTML = `
      <div class="dp-top">
        <div class="dp-brand">
          <span class="dp-kicker"></span>
          <span class="dp-word">Deploy</span>
        </div>
        <div class="dp-sys">
          <button class="dp-sysbtn dp-pause">${ICON_PAUSE}<b>Pause</b>${glyph("Esc", "Start")}</button>
        </div>
      </div>
      <div class="dp-hero"></div>
      <div class="dp-list"></div>
      <div class="dp-kitrow">
        <button class="dp-kit">
          <span class="dp-kit-cap">Loadout</span>
          <b class="dp-kit-w"></b>
          <i class="dp-kit-s"></i>
          ${glyph("L", "Y")}
        </button>
      </div>
      <div class="dp-gorow">
        <button class="dp-go">
          <span class="dp-fill"></span>
          <span class="dp-go-t"><b>Deploy</b><i class="dp-go-sub"></i></span>
          <em class="dp-go-n"></em>
          ${glyph("Enter", "A")}
        </button>
      </div>
      <div class="dp-stage">
        <div class="dp-mapwrap">
          <div class="dp-hull"></div>
          <canvas width="620" height="620"></canvas>
        </div>
      </div>
      <aside class="dp-intel">
        <div class="dp-intel-pos"></div>
        <div class="dp-round"></div>
      </aside>
      <div class="dp-foot">
        <span data-dev="kbm"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Position</span>
        <span data-dev="pad"><kbd class="pd">D-pad</kbd> Position</span>
        <span data-dev="kbm"><kbd>Tab</kbd> Scores</span>
        <span data-dev="pad"><kbd class="pd">View</kbd> Scores</span>
      </div>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
    this.kickerEl = q(".dp-kicker");
    this.heroEl = q(".dp-hero");
    this.listEl = q(".dp-list");
    this.kitW = q(".dp-kit-w");
    this.kitS = q(".dp-kit-s");
    this.goBtn = q(".dp-go");
    this.goSub = q(".dp-go-sub");
    this.goNum = q(".dp-go-n");
    this.goFill = q(".dp-fill");
    this.intelPos = q(".dp-intel-pos");
    this.roundEl = q(".dp-round");
    this.canvas = q<HTMLCanvasElement>("canvas");
    this.ctx = this.canvas.getContext("2d")!;

    // Pointerdown rather than click, for the reason the menu's kit plate uses
    // it: the press changes the state on its down edge, so nothing later in the
    // same gesture can land on whatever this screen was covering.
    q(".dp-kit").onpointerdown = () => this.onOpenLoadout();
    // The confirm is Enter / pad A and deliberately not the mouse, so this
    // button is the pointer's one way off this screen. Pointerdown because the
    // same event goes on to take the pointer lock, which it can only do once
    // `spawnPlayer` has put the state into `playing`.
    this.goBtn.onpointerdown = () => this.confirm();
    q(".dp-pause").onclick = () => this.onPause();

    // The map PICKS and never fires: a click on a marker moves the cursor onto
    // it, and Deploy spends it. It used to deploy on the spot, which is a row
    // that picks behaving as a row that fires — on a phone, where the marker is
    // a few pixels on a map scaled to the viewport, a tap meant to read a flag
    // dropped the player on it.
    this.canvas.addEventListener("pointerdown", (e) => this.click(e));
    // The ELEMENT is what is watched and not the window, so the map follows
    // its box however that moved. Setting `width` from inside the callback
    // does not change the element's layout size, so this cannot feed itself.
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
  }

  /**
   * Shows what is being carried. Called by Game once it has actually changed
   * the loadout, never straight from the screen that asked for the change —
   * so the caption cannot get ahead of the weapon.
   */
  setKit(weapon: string, sight: string): void {
    if (this.kitW.textContent !== weapon) this.kitW.textContent = weapon;
    if (this.kitS.textContent !== sight) this.kitS.textContent = sight;
  }

  /**
   * Which device's prompts to draw. A class on the root, compared before it is
   * written, so `Game` can push it every frame.
   */
  setInputDevice(device: InputDevice): void {
    if (device === this.device) return;
    this.device = device;
    markDevice(this.root, device);
  }

  show(
    map: GameMap,
    conquest: ConquestSystem,
    team: Team,
    env: EnvironmentSpec,
    mapName: string,
  ): void {
    this.map = map;
    this.conquest = conquest;
    this.env = env;
    this.team = team;
    this.selected = 0;
    this.selectedSpawn = null;
    this.ready = false;
    this.waitFor = 0;
    this.pendingSpawn = null;
    this.kickerEl.textContent = `${mapName} · ${teamLook(team).name}`;
    this.root.classList.remove("hidden");
    // The ENTRANCE, replayed on every raise and never on a patch — the menu's
    // `.enter`. Taking the class off and reading a layout property is what
    // restarts animations that already ran on the last death.
    this.root.classList.remove("enter");
    void this.root.offsetWidth;
    this.root.classList.add("enter");
    document.getElementById("hud")!.classList.add("deploying");
    // The flag row in the intel is built per show, since it is the map's flags
    // and a side change re-shows; everything in it after this is a patch.
    this.buildRound(conquest);
    this.shown = null;
    // Measured HERE and not left to the observer, because a hidden screen is
    // `display: none` and measures nothing: the first frame after a show would
    // otherwise draw the plan at whatever store the canvas last carried, and
    // the observer would drop it and draw it again a frame later. On the
    // biggest map that is the same 70 ms twice, on the frame a player's death
    // cam has just ended.
    this.resize();
  }

  /**
   * Says that the deploy has been ASKED FOR and not yet granted — the networked
   * case, where confirming sends a request and the authority answers a round
   * trip later by putting the body in the world.
   *
   * What it raises names the spawn that was requested rather than the one under
   * the cursor, and stays up while the cursor moves: the two can differ,
   * because a player may keep looking around after confirming, and a line that
   * followed the cursor would claim they were deploying somewhere they had not
   * asked for. Confirming again replaces it.
   *
   * Nothing else changes. The Deploy button stays live on purpose — a re-confirm
   * is a new request, which is the whole of what a player can do about a server
   * that has not answered yet.
   */
  setPending(): void {
    this.pendingSpawn = this.options[this.selected] ?? null;
  }

  /**
   * Lets go of the map, its prerendered plan and the positions offered on it:
   * `Game.teardownMap`, for the menu. `show` hands it everything again.
   */
  clearMap(): void {
    this.map = null;
    this.base = null;
    this.baseFor = null;
    this.baseSize = 0;
    this.options = [];
    this.positions = [];
    this.hotspots = [];
    this.selectedSpawn = null;
    this.pendingSpawn = null;
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.root.classList.remove("enter");
    document.getElementById("hud")!.classList.remove("deploying");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** Redraws and refreshes the countdown. `remaining` is seconds until deploy. */
  update(remaining: number): void {
    const conquest = this.conquest;
    if (!this.map || !conquest) return;
    this.options = conquest.deployOptions(this.team);
    // Re-found by identity, not carried as an index — see `selectedSpawn`. A
    // spawn that has stopped being offered drops the cursor to the home base
    // rather than onto whatever inherited its row.
    const at = this.selectedSpawn ? this.options.indexOf(this.selectedSpawn) : -1;
    this.selected = at >= 0 ? at : 0;
    this.selectedSpawn = this.options[this.selected] ?? null;
    this.ready = remaining <= 0;
    this.waitFor = Math.max(this.waitFor, remaining);
    this.positions = this.options.map((s) => this.describe(s));

    const was = this.shown;
    const keys = this.options.map((s) => conquest.spawnIndex(s)).join("|");
    if (!was || was.keys !== keys) this.buildList(was ? was.keys : null);
    this.patchRows();

    const focus = this.positions[this.selected] ?? null;
    const heroKey = focus ? String(conquest.spawnIndex(focus.spawn)) : "none";
    if (!was || was.heroKey !== heroKey) this.writeHero(focus, was !== null);
    const facts = this.patchHero(focus);

    // The intel's position half is rewritten when the cursor moves or what it
    // is on changes KIND (quiet to under attack), never for a meter creeping.
    const intelKey = focus ? `${heroKey}:${focus.state}:${focus.control < 0.999}` : "none";
    if (!was || was.intelKey !== intelKey) {
      this.writeIntel(focus, !was || was.heroKey !== heroKey);
    }
    this.patchIntel(focus);
    this.patchRound(conquest);
    this.patchGo(remaining);

    this.shown = { keys, heroKey, intelKey, facts };
    this.draw();
  }

  /**
   * Steps the cursor, wrapping at both ends — the keyboard's arrows and the
   * pad's d-pad. It only moves the index: `update()` runs every frame in this
   * state and is called after this, so the plate, the title and the marker all
   * move on the frame the key was pressed.
   */
  moveSelection(delta: number): void {
    const n = this.options.length;
    if (n === 0) return;
    this.selected = (this.selected + delta + n) % n;
    this.selectedSpawn = this.options[this.selected];
  }

  /** Deploys at the cursor's position. The keyboard/pad confirm and the button. */
  confirm(): void {
    if (!this.ready) return;
    const spawn = this.options[this.selected];
    if (spawn) this.onDeploy(spawn);
  }

  /** Puts the cursor on a position by its place in the offer, and redraws. */
  private pick(index: number): void {
    const spawn = this.options[index];
    if (!spawn) return;
    this.selected = index;
    this.selectedSpawn = spawn;
    this.update(this.lastRemaining);
  }

  /** One offered spawn, read off the conquest state. */
  private describe(spawn: SpawnPointDef): Position {
    const point = spawn.controlPoint
      ? (this.conquest?.pointById(spawn.controlPoint) ?? null)
      : null;
    if (!point) {
      return {
        spawn,
        point: null,
        name: "Home base",
        letter: "HQ",
        state: "home",
        control: 1,
        friends: 0,
        foes: 0,
      };
    }
    const toward = this.team === 0 ? -1 : 1;
    const foes = point.present[OTHER_TEAM[this.team]];
    return {
      spawn,
      point,
      name: point.def.name,
      letter: point.def.id,
      state: foes > 0 ? "attack" : "held",
      control: Math.max(0, Math.min(1, point.meter * toward)),
      friends: point.present[this.team],
      foes,
    };
  }

  /**
   * The plates from nothing, when the SET of offered positions changed — a flag
   * taken or lost. `before` is the set that was on screen, so a position that
   * has just been OFFERED deals itself in while the others hold still.
   */
  private buildList(before: string | null): void {
    const conquest = this.conquest!;
    const old = before === null ? null : new Set(before.split("|"));
    this.listEl.innerHTML = this.positions
      .map((p, i) => {
        const key = String(conquest.spawnIndex(p.spawn));
        const fresh = old !== null && !old.has(key);
        const mark =
          p.state === "home"
            ? `<span class="dp-mark home"><i></i></span>`
            : `<span class="dp-mark"><b>${p.letter}</b></span>`;
        return `<div class="dp-rowwrap${fresh ? " fresh" : ""}" data-row="${i}" style="--i:${i + 1}">
          <button class="dp-row">
            ${mark}
            <span class="dp-name"><b></b><i class="dp-state"></i></span>
            <span class="dp-meter"><s></s></span>
          </button>
        </div>`;
      })
      .join("");
    this.listEl.querySelectorAll<HTMLElement>(".dp-rowwrap").forEach((wrap) => {
      const index = Number(wrap.dataset.row);
      // CLICKED, never hovered: Deploy is under the list, so the pointer
      // crosses every plate below the one it chose on its way down to it, and
      // a cursor that followed the hover would deploy the player at the last
      // plate it crossed. A plate PICKS; Deploy fires.
      wrap.onclick = () => this.pick(index);
    });
  }

  /** Every plate's changing text, meter and classes, written in place. */
  private patchRows(): void {
    const pendingKey = this.pendingSpawn;
    this.listEl.querySelectorAll<HTMLElement>(".dp-rowwrap").forEach((wrap) => {
      const i = Number(wrap.dataset.row);
      const p = this.positions[i];
      if (!p) return;
      const name = wrap.querySelector<HTMLElement>(".dp-name b")!;
      if (name.textContent !== p.name) name.textContent = p.name;
      const pending = pendingKey === p.spawn;
      const word = pending ? "Deploying…" : STATE_WORD[p.state];
      const state = wrap.querySelector<HTMLElement>(".dp-state")!;
      if (state.textContent !== word) state.textContent = word;
      wrap.classList.toggle("sel", i === this.selected);
      wrap.classList.toggle("attack", p.state === "attack");
      wrap.classList.toggle("home", p.state === "home");
      wrap.classList.toggle("busy", pending);
      // The meter as a transform, so a creeping capture is the compositor's.
      const scale = `scaleX(${p.control.toFixed(3)})`;
      const s = wrap.querySelector<HTMLElement>(".dp-meter s")!;
      if (s.style.transform !== scale) s.style.transform = scale;
    });
  }

  /**
   * The title: the flag's letter hollow behind, an eyebrow, the NAME, and a
   * strip of figures under it. Rewritten only when the cursor's position
   * changes, because replacing it is how `.swap` replays the wipe.
   */
  private writeHero(focus: Position | null, swap: boolean): void {
    const index = focus ? `<span class="dp-index" aria-hidden="true">${focus.letter}</span>` : "";
    this.heroEl.innerHTML = `<div class="dp-hero-in${swap ? " swap" : ""}">
        ${index}
        <span class="dp-mode"></span>
        <h2 class="dp-title"></h2>
        <div class="dp-facts"></div>
      </div>`;
    this.heroEl.querySelector(".dp-title")!.textContent = focus ? focus.name : "No position";
  }

  /**
   * The eyebrow and the figure strip, which move under a title that does not:
   * which position of how many and what state it is in, then the round — both
   * sides' tickets and the flags held. The strip is ALWAYS one line, so the
   * list under the title never moves as the round does. Returns its signature.
   */
  private patchHero(focus: Position | null): string {
    const mode = this.heroEl.querySelector<HTMLElement>(".dp-mode");
    const factsEl = this.heroEl.querySelector<HTMLElement>(".dp-facts");
    const conquest = this.conquest;
    if (!mode || !factsEl || !conquest) return "";
    const n = this.options.length;
    const eyebrow = focus
      ? `Position ${twoDigits(this.selected + 1)} / ${twoDigits(n)} · ${
          this.pendingSpawn ? "Deploying" : STATE_WORD[focus.state]
        }`
      : "Reinforcement";
    if (mode.textContent !== eyebrow) mode.textContent = eyebrow;
    mode.classList.toggle("attack", focus?.state === "attack");
    const other = OTHER_TEAM[this.team];
    const facts: [string, string, string][] = [
      [String(Math.ceil(conquest.tickets[this.team])), teamLook(this.team).name, "mine"],
      [String(Math.ceil(conquest.tickets[other])), teamLook(other).name, "theirs"],
      [`${conquest.flagsHeld(this.team)} / ${conquest.points.length}`, "Flags", ""],
    ];
    const sig = JSON.stringify(facts);
    if (factsEl.dataset.sig !== sig) {
      factsEl.dataset.sig = sig;
      factsEl.replaceChildren(
        ...facts.map(([v, l, cls]) => {
          const span = document.createElement("span");
          if (cls) span.className = cls;
          const b = document.createElement("b");
          b.textContent = v;
          const i = document.createElement("i");
          i.textContent = l;
          span.append(b, i);
          return span;
        }),
      );
    }
    return sig;
  }

  /**
   * The intel's position half — what the cursor's position IS, described.
   * `fresh` fades it in, for the cursor arriving on something new rather than
   * the same place changing state under it.
   */
  private writeIntel(focus: Position | null, fresh: boolean): void {
    if (!focus) {
      this.intelPos.innerHTML = "";
      return;
    }
    const eyebrow = focus.point ? `Flag ${focus.letter}` : teamLook(this.team).name;
    const figures = focus.point
      ? `<div class="dp-ifacts">
           <span><b class="dp-f-ctl"></b><i>Control</i></span>
           <span class="mine"><b class="dp-f-fr"></b><i>Friendlies</i></span>
           <span class="theirs"><b class="dp-f-foe"></b><i>Hostiles</i></span>
         </div>`
      : this.nearestFlag(focus.spawn);
    this.intelPos.innerHTML = `<div class="dp-intel-in${fresh ? " fade" : ""}">
        <div class="dp-intel-head"><span class="dp-eyebrow-s"></span><h3></h3></div>
        ${figures}
        <p class="dp-blurb"></p>
      </div>`;
    this.intelPos.querySelector(".dp-eyebrow-s")!.textContent =
      `${eyebrow} · ${STATE_WORD[focus.state]}`;
    this.intelPos.querySelector("h3")!.textContent = focus.name;
    this.intelPos.querySelector(".dp-blurb")!.textContent = positionBlurb(focus);
    this.intelPos.classList.toggle("attack", focus.state === "attack");
  }

  /**
   * The home base's figures: which flag is nearest it and how far — the one
   * thing worth knowing about a place that never changes hands, since it is
   * the walk a player choosing it is signing up for.
   */
  private nearestFlag(spawn: SpawnPointDef): string {
    let best: ControlPoint | null = null;
    let bestD = Infinity;
    for (const p of this.conquest?.points ?? []) {
      const d = Math.hypot(p.def.pos.x - spawn.pos.x, p.def.pos.z - spawn.pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return "";
    return `<div class="dp-ifacts">
        <span><b>${best.def.id}</b><i>Nearest flag</i></span>
        <span><b>${Math.round(bestD)} m</b><i>Walk to it</i></span>
      </div>`;
  }

  /** The intel's live figures, patched as the meter and the zone's bodies move. */
  private patchIntel(focus: Position | null): void {
    if (!focus?.point) return;
    const set = (sel: string, text: string) => {
      const el = this.intelPos.querySelector<HTMLElement>(sel);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set(".dp-f-ctl", `${Math.round(focus.control * 100)}%`);
    set(".dp-f-fr", String(focus.friends));
    set(".dp-f-foe", String(focus.foes));
  }

  /**
   * The intel's round half, built once per raise: both sides' tickets as bars,
   * and every flag on the map as the hexagon the whole interface names one
   * with — the HUD's own strip, which is off the glass while this is up.
   */
  private buildRound(conquest: ConquestSystem): void {
    const other = OTHER_TEAM[this.team];
    const flags = conquest.points
      .map((p) => `<span class="dp-flag" data-id="${p.def.id}"><i></i><b>${p.def.id}</b></span>`)
      .join("");
    this.roundEl.innerHTML = `
      <span class="dp-round-cap">The round</span>
      <div class="dp-tix mine"><span class="dp-tix-n"></span><b></b><em><s></s></em></div>
      <div class="dp-tix theirs"><span class="dp-tix-n"></span><b></b><em><s></s></em></div>
      <div class="dp-flags">${flags}</div>`;
    const [mineRow, theirsRow] = Array.from(this.roundEl.querySelectorAll<HTMLElement>(".dp-tix"));
    mineRow.querySelector(".dp-tix-n")!.textContent = teamLook(this.team).name;
    theirsRow.querySelector(".dp-tix-n")!.textContent = teamLook(other).name;
  }

  private patchRound(conquest: ConquestSystem): void {
    const other = OTHER_TEAM[this.team];
    const rows = this.roundEl.querySelectorAll<HTMLElement>(".dp-tix");
    [this.team, other].forEach((t, k) => {
      const row = rows[k];
      if (!row) return;
      const n = String(Math.ceil(conquest.tickets[t]));
      const b = row.querySelector("b")!;
      if (b.textContent !== n) b.textContent = n;
      const scale = `scaleX(${Math.max(0, Math.min(1, conquest.tickets[t] / CONFIG.conquest.tickets)).toFixed(3)})`;
      const s = row.querySelector<HTMLElement>("s")!;
      if (s.style.transform !== scale) s.style.transform = scale;
    });
    const toward = this.team === 0 ? -1 : 1;
    this.roundEl.querySelectorAll<HTMLElement>(".dp-flag").forEach((el) => {
      const p = conquest.pointById(el.dataset.id ?? "");
      if (!p) return;
      const owner = p.owner === null ? "" : p.owner === this.team ? "mine" : "theirs";
      const cls = `dp-flag${owner ? ` ${owner}` : ""}${p.contested ? " contested" : ""}`;
      if (el.className !== cls) el.className = cls;
      // The fill is how far the meter leans, in the colour it leans to — the
      // HUD strip's reading exactly.
      const lean = p.meter * toward;
      const fill = el.querySelector<HTMLElement>("i")!;
      const scale = `scaleY(${Math.abs(lean).toFixed(3)})`;
      if (fill.style.transform !== scale) fill.style.transform = scale;
      const side = lean >= 0 ? "mine" : "theirs";
      if (fill.className !== side) fill.className = side;
    });
  }

  /**
   * The Deploy plate: filling over the reinforcement wait with the seconds left
   * set large beside the word, then hot and live once it is over, then naming
   * the position a networked request was made for until the authority answers.
   */
  private patchGo(remaining: number): void {
    this.lastRemaining = remaining;
    const pending = this.pendingSpawn ? this.describe(this.pendingSpawn) : null;
    const focus = this.positions[this.selected];
    const where = focus ? focus.name : "";
    const sub = pending
      ? `Deploying at ${pending.name}…`
      : this.ready
        ? `At ${where}`
        : "Reinforcements inbound";
    if (this.goSub.textContent !== sub) this.goSub.textContent = sub;
    const secs = this.ready ? "" : String(Math.ceil(remaining));
    if (this.goNum.textContent !== secs) this.goNum.textContent = secs;
    // `confirm()` is a no-op until the wait is over, so the button must not
    // look live before then — a control that answers nothing is worse than one
    // that is visibly not yet yours.
    this.goBtn.classList.toggle("waiting", !this.ready);
    this.goBtn.classList.toggle("pending", pending !== null);
    const p = this.ready || this.waitFor <= 0 ? 1 : 1 - remaining / this.waitFor;
    const scale = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(3)})`;
    if (this.goFill.style.transform !== scale) this.goFill.style.transform = scale;
  }

  private click(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    for (const h of this.hotspots) {
      const dx = h.x - x;
      const dy = h.y - y;
      if (dx * dx + dy * dy < h.r * h.r) {
        this.pick(h.index);
        return;
      }
    }
  }

  /**
   * Matches the backing store to the box the stylesheet gave the canvas, and
   * drops the prerendered plan so the next draw builds it at the new scale.
   *
   * The canvas used to carry a fixed 620 x 620 store and be stretched by CSS,
   * which on a 1440p monitor is a 900 px map drawn at 620 and resampled — soft
   * hairlines on the one screen in the game that is nothing but hairlines —
   * and on a phone at 2x the same map drawn at a third of the resolution it is
   * shown at.
   */
  private resize(): void {
    const box = this.canvas.clientWidth;
    if (box < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const store = Math.round(box * dpr);
    if (this.canvas.width === store) return;
    this.canvas.width = store;
    this.canvas.height = store;
    this.base = null;
  }

  /**
   * The static plan, prerendered — the ground, the water, the roads and the
   * built mass, which is everything on this screen that cannot change inside a
   * round.
   *
   * It is a picture and not a redraw for two reasons, and the second is the
   * one that matters. Cinderhaven is 3,743 colliders, a heightfield, a
   * waterline bake and a road network, and this screen redraws EVERY FRAME
   * while the player waits out a reinforcement clock; and the plan is the same
   * drawing the minimap and the menu make, which is `mapPaint.ts`'s and is
   * priced for being made once. What changes per frame is five flags and a
   * cursor.
   */
  private buildBase(map: GameMap): void {
    const size = this.canvas.width;
    const base = document.createElement("canvas");
    base.width = size;
    base.height = size;
    const c = base.getContext("2d");
    if (!c) return;
    const scale = size / map.size;
    this.view = { scale, ox: size / 2, oy: size / 2 };
    paintPlan(c, planFromWorld(map, this.env), this.view, {
      bounds: { x: 0, y: 0, w: size, h: size },
      // The one of the three maps that letters its grid. It is the whole
      // stage, and it is the map a player reads a position OFF — "the barn in
      // D4" is a thing two people can say to each other, and neither the
      // menu's intel plate nor a turning corner map can carry it.
      grid: "labelled",
    });
    this.base = base;
    this.baseFor = map;
    this.baseSize = size;
  }

  private draw(): void {
    const map = this.map;
    const conquest = this.conquest;
    if (!map || !conquest) return;
    const c = this.ctx;
    const size = this.canvas.width;
    if (!this.base || this.baseFor !== map || this.baseSize !== size) {
      this.buildBase(map);
    }
    if (!this.base) return;
    const view = this.view;
    const k = size / DRAWN_AT;
    c.clearRect(0, 0, size, size);
    c.drawImage(this.base, 0, 0);

    this.hotspots.length = 0;
    // Through the view rather than the index, so `mine` is the amber every
    // player's own side is drawn in whichever slot the authority seated them
    // in — the same read the bodies out in the world are wearing. See
    // `core/teamView.ts`.
    const mine = teamLook(this.team).color;
    const theirs = teamLook(OTHER_TEAM[this.team]).color;

    // Flags: the zone at its real radius, the hexagon the whole interface
    // names a control point with, and the point's NAME under it — this is the
    // one map in the game with room for the word, and "Chapel" is what the
    // plates beside it read back.
    for (const p of conquest.points) {
      const x = px(view, p.def.pos.x);
      const y = py(view, p.def.pos.z);
      const color =
        p.owner === null ? NEUTRAL : p.owner === this.team ? mine : theirs;
      paintZone(c, x, y, p.def.radius * view.scale, color, {
        contested: p.contested,
      });
      paintFlagIcon(c, x, y, 13 * k, color, p.def.id, {
        meter: p.meter,
        meterColor:
          Math.sign(p.meter) === (this.team === 0 ? -1 : 1) ? mine : theirs,
        contested: p.contested,
        face: FACE,
      });
      c.save();
      c.textAlign = "center";
      c.textBaseline = "top";
      c.font = `600 ${(9 * k).toFixed(1)}px ${FACE}`;
      c.fillStyle = "rgba(226, 234, 246, 0.62)";
      c.shadowColor = "rgba(0, 0, 0, 0.85)";
      c.shadowBlur = 3;
      c.fillText(p.def.name.toUpperCase(), x, y + 22 * k);
      c.restore();
    }

    // Deployment markers. The cursor's is drawn LAST and on its own, so it is
    // never partly under a neighbour — a spawn behind a flag lands within a
    // marker's width of the flag at this scale, and a selection you have to
    // look for is the one thing this screen cannot afford.
    //
    // The hit radius is the same for every marker whatever it is drawn at:
    // shrinking the unselected ones is a legibility decision, and it must not
    // quietly shrink their click targets with it.
    const ink = lighten(mine, 0.4);
    for (let i = 0; i < this.options.length; i++) {
      const s = this.options[i];
      const x = px(view, s.pos.x);
      const y = py(view, s.pos.z);
      this.hotspots.push({ x, y, r: 16 * k, index: i });
      if (i !== this.selected) this.drawMarker(x, y, ink, k);
    }
    const sel = this.hotspots[this.selected];
    if (sel) this.drawSelected(sel.x, sel.y, k);
  }

  /**
   * An unselected spawn: a dark disc so it reads against a building footprint,
   * a ring, and a downward chevron so a spawn never reads as a flag.
   *
   * The ring is the team's colour lightened rather than the colour itself.
   * Both teams' colours are chosen to sit in a night scene, and this map is a
   * dark plan drawn at 2 px a stroke — the margin is thin enough that Redline's
   * old plum was within a few points of the background and simply was not
   * there. That colour is a crimson now and would survive on its own; the
   * lightening stays because what it protects against is the next dark team
   * colour, not that one.
   */
  private drawMarker(x: number, y: number, ink: string, k: number): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, 9 * k, 0, Math.PI * 2);
    c.fillStyle = "rgba(6,8,12,0.8)";
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = 2 * k;
    c.stroke();
    this.chevron(x, y, ink, k);
  }

  /**
   * The cursor's spawn, in the screen's own accent rather than in the team's:
   * what it has to be distinct from is the other markers, which are all in the
   * team's colour — so a difference in fill and line width is the one
   * distinction it cannot use. It reads as selected four ways over — brighter
   * hue, larger, four ticks aimed at it, and a halo that breathes — because a
   * d-pad step has to be visible from wherever on the map the eye happens to
   * be. The ticks are the plates' sight brackets drawn on the map: the same
   * cursor in both places.
   *
   * The pulse is drawn from the wall clock rather than from an accumulated dt:
   * this screen's only job is to be looked at, so a phase that survives across
   * respawns costs nothing and there is no dt in reach here anyway.
   */
  private drawSelected(x: number, y: number, k: number): void {
    const c = this.ctx;
    const beat = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 3.4);

    c.save();
    // A dark backing disc first: the halo is translucent, and over the mid-grey
    // of a building footprint it would otherwise wash out to nothing.
    c.beginPath();
    c.arc(x, y, 17 * k, 0, Math.PI * 2);
    c.fillStyle = "rgba(6,8,12,0.72)";
    c.fill();

    c.beginPath();
    c.arc(x, y, (15 + beat * 3) * k, 0, Math.PI * 2);
    c.strokeStyle = `rgba(255,230,128,${0.5 - beat * 0.28})`;
    c.lineWidth = 2 * k;
    c.stroke();

    // Four ticks pointing in at the marker — the part that still reads when the
    // map is scaled down to a landscape phone and the disc is a few pixels.
    c.strokeStyle = "rgba(255,230,128,0.85)";
    c.lineWidth = 2 * k;
    c.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      c.beginPath();
      c.moveTo(x + dx * 16 * k, y + dy * 16 * k);
      c.lineTo(x + dx * 23 * k, y + dy * 23 * k);
      c.stroke();
    }

    c.shadowColor = "rgba(255,230,128,0.9)";
    c.shadowBlur = 12 * k;
    c.beginPath();
    c.arc(x, y, 12 * k, 0, Math.PI * 2);
    c.fillStyle = HOT;
    c.fill();
    c.strokeStyle = "#fff6d2";
    c.lineWidth = 2.5 * k;
    c.stroke();
    c.restore();

    this.chevron(x, y, "#0b0e12", k * 1.35);
  }

  private chevron(x: number, y: number, fill: string, scale = 1): void {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x - 4 * scale, y - 3 * scale);
    c.lineTo(x + 4 * scale, y - 3 * scale);
    c.lineTo(x, y + 4.5 * scale);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }
}

/**
 * The canvas side every mark on this screen is stated against, so that one
 * number carries the lot to whatever the backing store turned out to be.
 *
 * The marks are NOT to scale with the map and must not be: a spawn marker is a
 * target a thumb has to hit and a flag's hexagon is a label, so both are sized
 * against the SCREEN. What they follow is the canvas's own resolution, which
 * moves with the window and with the device pixel ratio — see `resize`.
 */
const DRAWN_AT = 620;

/** The HUD's own face; a canvas inherits no font. */
const FACE = '"Bahnschrift", "DIN Alternate", "Roboto Condensed", sans-serif';

/** The interface's accent (`--hot` in base.css), which the canvas cannot read. */
const HOT = "#ffe680";

/** `--neutral` in `base.css`: a point nobody holds. */
const NEUTRAL = "#aeb6c2";

/**
 * A team colour mixed toward white, for the marks small enough that the colour
 * itself does not carry. The palette is authored for a night scene lit by one
 * moon; against this map's near-black paper the darker of the two teams is
 * barely a colour at all, and a 2 px ring drawn in it is invisible.
 */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (ch: number) => Math.round(ch + (255 - ch) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}
