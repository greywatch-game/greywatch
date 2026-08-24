/**
 * DeployScreen.ts — Top-down deploy map: renders spawn options from the
 * GameMap's collider geometry, hit-tests clicks, steps the selection for the
 * keyboard/pad (moveSelection), fires onDeploy (wired in Game) when a
 * selection is confirmed.
 * Invariants: CSS contract — #hud is pointer-events:none and this overlay
 * opts back in; don't break that or gameplay clicks die. Re-checks map/
 * conquest readiness every update; the 3D scene renders live behind it. The
 * offer is derived from flag ownership and changes UNDER the cursor, so the
 * highlight is held by identity (`selectedSpawn`) and never as an index. What
 * `onDeploy` means is the caller's: offline Game deploys, in a netplay round it
 * sends a request and `setPending` is how this screen says so.
 */
import "./deploy.css";
import { CONFIG } from "../config";
import type { Team } from "../entities/Combatant";
import type { ConquestSystem } from "../systems/ConquestSystem";
import type { GameMap, SpawnPointDef } from "../world/MapBuilder";

/**
 * The between-lives screen: a top-down view of the map with the flags you
 * hold, where you can pick a spawn and drop back in — and a way through to the
 * loadout screen before you do. Waiting out a respawn is the natural moment to
 * reconsider the kit, and it is the only moment inside a round when changing
 * it costs nothing: the weapon is already put away.
 *
 * The map is drawn straight from the collider boxes rather than from a separate
 * authored minimap. That keeps the two from ever disagreeing — if a building
 * blocks movement it appears here, and nothing has to be updated twice when the
 * layout changes.
 *
 * Note the CSS contract: `#hud` is `pointer-events: none` so the HUD never eats
 * a click meant for the game, which means this overlay has to opt back in.
 */
export class DeployScreen {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private statusEl: HTMLElement;
  /** The status line's two halves: what the clock says, and where. */
  private stateEl!: HTMLElement;
  private spawnEls: HTMLElement[] = [];
  /** The kit button's caption; rewritten when the fit changes. */
  private kitEl: HTMLElement;
  /** The confirm button; greyed until the reinforcement wait is over. */
  private goBtn!: HTMLElement;

  /** Wired by Game. */
  onDeploy: (spawn: SpawnPointDef) => void = () => {};
  /** Wired by Game: the player wants the loadout screen before dropping in. */
  onOpenLoadout: () => void = () => {};

  private map: GameMap | null = null;
  private conquest: ConquestSystem | null = null;
  private team: Team = 0;
  private options: SpawnPointDef[] = [];
  private selected = 0;
  /**
   * The spawn the highlight is ON, as an object rather than as a position in
   * the list.
   *
   * The list is derived from flag ownership and re-derived every frame, so in a
   * networked round it changes UNDER the cursor: a flag falling two hundred
   * metres away removes a row, everything below it shifts up, and a carried
   * index quietly becomes a different place — which the player then deploys to
   * with their hand already on Enter. Identity is what keeps the highlight on
   * what it was put on; when that spawn stops being offered the highlight falls
   * back to the home gatehouse, which is the one row that can never disappear.
   */
  private selectedSpawn: SpawnPointDef | null = null;
  /** Screen-space hit targets, rebuilt every draw. */
  private hotspots: { x: number; y: number; r: number; index: number }[] = [];
  private ready = false;
  /** The spawn a networked deploy has been requested at, until it is granted. */
  private pendingLabel: string | null = null;

  constructor() {
    this.root = document.createElement("div");
    this.root.id = "deploy";
    // The shell's frame and its veil, but NOT `.ui-solid`: this screen stands
    // over a round that is still being fought, and the map behind it is what
    // the player is deciding against.
    this.root.className = "ui-screen ui-veil hidden";
    // `.map-wrap` exists only to hang the chamfered hull and the corner
    // brackets on — a canvas cannot draw its own chrome.
    //
    // THE MAP IS THE SCREEN and the orders are the column beside it. Both used
    // to be one centred stack, which capped the map at whatever the status
    // line, a hint row and two buttons left of the window's height — about
    // 56vh. Beside them it takes the whole body row, and the panel's own
    // height stops mattering at all.
    //
    // Every input hint lives in the frame's foot, which is the one row this
    // screen has for them; the buttons carry only what they do.
    this.root.innerHTML = `
      <div class="ui-head">
        <div class="ui-titles">
          <span class="ui-eyebrow">Reinforcement</span>
          <h2>Select deployment</h2>
        </div>
        <div class="ui-meta">
          <span>Position</span>
          <b class="dp-spawn"></b>
        </div>
      </div>
      <div class="ui-body dp-body">
        <div class="map-wrap brackets">
          <div class="hull"></div>
          <canvas id="deploy-map" width="620" height="620"></canvas>
        </div>
        <div class="ui-panel dp-orders">
          <div id="deploy-status">
            <span class="dp-state"></span>
            <b class="dp-spawn"></b>
          </div>
          <div id="deploy-actions">
            <button id="deploy-go"><b>Deploy</b><i>Enter &middot; A</i></button>
            <button id="deploy-kit"><span class="lbl">Loadout</span><b></b></button>
          </div>
        </div>
      </div>
      <p class="ui-foot">
        <span><kbd>&larr;</kbd><kbd>&rarr;</kbd><kbd class="pad">Stick / D-pad</kbd> choose position</span>
        <span><kbd>Enter</kbd><kbd class="pad">A</kbd> deploy</span>
        <span><kbd>L</kbd><kbd class="pad">Y</kbd> loadout</span>
      </p>
    `;
    document.getElementById("hud")!.appendChild(this.root);
    this.canvas = this.root.querySelector("#deploy-map")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.statusEl = this.root.querySelector("#deploy-status")!;
    this.stateEl = this.statusEl.querySelector(".dp-state")!;
    // Two of them: the panel's own, and the head's — the name of the place you
    // are about to stand in is the one fact this screen is FOR, so it is read
    // back both beside the button that spends it and in the frame's own
    // right-hand slot. `Array.from` rather than a spread: the root tsconfig's
    // `lib` has DOM but not DOM.Iterable.
    this.spawnEls = Array.from(
      this.root.querySelectorAll<HTMLElement>(".dp-spawn"),
    );
    const kitBtn = this.root.querySelector<HTMLElement>("#deploy-kit")!;
    this.kitEl = kitBtn.querySelector("b")!;
    // Pointerdown rather than click, for the same reason the menu's kit button
    // uses it: the deploy confirm is a mouse-down anywhere, read a tick later,
    // so the state has to change on the down edge or the click that opened the
    // loadout also drops the player into the map behind it.
    kitBtn.onpointerdown = () => this.onOpenLoadout();

    // The deploy confirm is Enter / pad A and deliberately not the mouse, so
    // without this there is no pointer route off this screen except hitting one
    // of the markers — which on a phone, where the marker is 11 px on a map
    // scaled to the viewport, is not a target. Pointerdown for the reason the
    // markers use it: the same event goes on to take the pointer lock, and it
    // can only do that once `spawnPlayer` has put the state into `playing`.
    this.goBtn = this.root.querySelector<HTMLElement>("#deploy-go")!;
    this.goBtn.onpointerdown = () => this.confirm();

    this.canvas.addEventListener("pointerdown", (e) => this.click(e));
  }

  /**
   * Shows what is being carried. Called by Game once it has actually changed
   * the loadout, never straight from the screen that asked for the change —
   * so the caption cannot get ahead of the weapon.
   */
  setKit(label: string): void {
    this.kitEl.textContent = label;
  }

  show(map: GameMap, conquest: ConquestSystem, team: Team): void {
    this.map = map;
    this.conquest = conquest;
    this.team = team;
    this.selected = 0;
    this.selectedSpawn = null;
    this.ready = false;
    this.pendingLabel = null;
    this.root.classList.remove("hidden");
  }

  /**
   * Says that the deploy has been ASKED FOR and not yet granted — the networked
   * case, where confirming sends a request and the authority answers a round
   * trip later by putting the body in the world.
   *
   * The caption it raises names the spawn that was requested rather than the
   * one under the cursor, and stays up while the cursor moves: the two can
   * differ, because a player may keep looking around after confirming, and a
   * line that followed the highlight would claim they were deploying somewhere
   * they had not asked for. Confirming again replaces both.
   *
   * Nothing else changes. The Deploy button stays live on purpose — a re-confirm
   * is a new request, which is the whole of what a player can do about a server
   * that has not answered yet.
   */
  setPending(): void {
    this.pendingLabel = this.spawnLabel(this.options[this.selected]);
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** Redraws and refreshes the countdown. `remaining` is seconds until deploy. */
  update(remaining: number): void {
    if (!this.map || !this.conquest) return;
    this.options = this.conquest.deployOptions(this.team);
    // Re-found by identity, not carried as an index — see `selectedSpawn`. A
    // spawn that has stopped being offered drops the highlight to the home
    // spawn rather than onto whatever inherited its row.
    const at = this.selectedSpawn ? this.options.indexOf(this.selectedSpawn) : -1;
    this.selected = at >= 0 ? at : 0;
    this.selectedSpawn = this.options[this.selected] ?? null;
    this.ready = remaining <= 0;

    const name = this.spawnLabel(this.options[this.selected]);
    // The name is the selection read back. It is on this line rather than only
    // on the map because a marker highlighted 300 px away is not a label, and
    // stepping through spawns with a d-pad is exactly the case where nothing
    // else tells you what you just moved onto.
    //
    // A pending request outranks both: it is the one state in which this screen
    // is waiting on somebody else, and a line reading READY while the player has
    // already pressed the button says nothing happened.
    this.stateEl.textContent = this.pendingLabel
      ? "Deploying"
      : this.ready
        ? "Ready to deploy"
        : `Reinforcements in ${Math.ceil(remaining)}`;
    const where = this.pendingLabel ?? name;
    for (const el of this.spawnEls) {
      // Guarded like every per-frame write in `HUD`: this runs every frame the
      // screen is up, and the name changes only when the cursor moves.
      if (el.textContent !== where) el.textContent = where;
    }
    this.statusEl.classList.toggle("ready", this.ready);
    // `confirm()` is a no-op until the wait is over, so the button must not
    // look live before then — a control that answers nothing is worse than one
    // that is visibly not yet yours.
    this.goBtn.classList.toggle("waiting", !this.ready);
    this.draw();
  }

  /**
   * Steps the highlighted spawn, wrapping at both ends — the keyboard's arrows
   * and the pad's d-pad. The mouse picks a marker directly; without this there
   * was no way to change position at all without one, which made the pad's
   * confirm a deploy at whatever the list happened to start on.
   *
   * It only moves the index. `update()` runs every frame in this state and
   * redraws from it, so there is nothing to repaint here — and it is called
   * before that update, so the marker and the status line change on the same
   * frame the key was pressed.
   */
  moveSelection(delta: number): void {
    const n = this.options.length;
    if (n === 0) return;
    this.selected = (this.selected + delta + n) % n;
    this.selectedSpawn = this.options[this.selected];
  }

  /** Deploys at the current selection. Used by the keyboard/gamepad confirm. */
  confirm(): void {
    if (!this.ready) return;
    const spawn = this.options[this.selected];
    if (spawn) this.onDeploy(spawn);
  }

  private spawnLabel(spawn: SpawnPointDef | undefined): string {
    if (!spawn) return "NO POSITION";
    if (!spawn.controlPoint) return CONFIG.teams[this.team].name.toUpperCase();
    const p = this.conquest?.pointById(spawn.controlPoint);
    return (p?.def.name ?? spawn.controlPoint).toUpperCase();
  }

  private click(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    for (const h of this.hotspots) {
      const dx = h.x - x;
      const dy = h.y - y;
      if (dx * dx + dy * dy < h.r * h.r) {
        this.selected = h.index;
        this.selectedSpawn = this.options[this.selected];
        this.update(this.ready ? 0 : 1);
        if (this.ready) this.confirm();
        return;
      }
    }
  }

  private draw(): void {
    const map = this.map;
    const conquest = this.conquest;
    if (!map || !conquest) return;
    const c = this.ctx;
    const size = this.canvas.width;
    const scale = size / map.size;
    const toX = (wx: number) => (wx + map.size / 2) * scale;
    // Canvas Y grows downward and world +Z is north, so the axis is flipped —
    // north ends up at the top, matching the layout diagram.
    const toY = (wz: number) => (map.size / 2 - wz) * scale;

    c.fillStyle = "#0b0e12";
    c.fillRect(0, 0, size, size);

    // Building footprints, straight from the collision data.
    c.fillStyle = "#39434a";
    for (const b of map.colliderBoxes) {
      if (b.w > 200 || b.d > 200) continue; // ground plane and ridge
      c.save();
      c.translate(toX(b.cx), toY(b.cz));
      c.rotate(-b.rotY);
      c.fillRect(
        (-b.w / 2) * scale,
        (-b.d / 2) * scale,
        b.w * scale,
        b.d * scale,
      );
      c.restore();
    }

    this.hotspots.length = 0;
    const mine = CONFIG.teams[this.team].color;
    const theirs = CONFIG.teams[1 - this.team].color;

    // Flags.
    for (const p of conquest.points) {
      const x = toX(p.def.pos.x);
      const y = toY(p.def.pos.z);
      c.beginPath();
      c.arc(x, y, p.def.radius * scale, 0, Math.PI * 2);
      c.fillStyle =
        p.owner === null
          ? "rgba(150,150,160,0.15)"
          : p.owner === this.team
            ? hexA(mine, 0.22)
            : hexA(theirs, 0.22);
      c.fill();
      c.strokeStyle =
        p.owner === null ? "#8b8f96" : p.owner === this.team ? mine : theirs;
      c.lineWidth = p.contested ? 3 : 1.5;
      c.stroke();

      c.fillStyle = "#e8e8ea";
      c.font = "bold 15px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(p.def.id, x, y);
    }

    // Deployment markers. The selection is drawn LAST and on its own, so it is
    // never partly under a neighbour — two spawns behind the same flag land
    // within a marker's width of each other at this scale, and a selection you
    // have to look for is the one thing this screen cannot afford.
    //
    // The hit radius is the same for every marker whatever it is drawn at:
    // shrinking the unselected ones is a legibility decision, and it must not
    // quietly shrink their click targets with it.
    this.hotspots.length = 0;
    const ink = lighten(mine, 0.4);
    for (let i = 0; i < this.options.length; i++) {
      const s = this.options[i];
      const x = toX(s.pos.x);
      const y = toY(s.pos.z);
      this.hotspots.push({ x, y, r: 16, index: i });
      if (i !== this.selected) this.drawMarker(x, y, ink);
    }
    const sel = this.hotspots[this.selected];
    if (sel) this.drawSelected(sel.x, sel.y);
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
  private drawMarker(x: number, y: number, ink: string): void {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, 9, 0, Math.PI * 2);
    c.fillStyle = "rgba(6,8,12,0.8)";
    c.fill();
    c.strokeStyle = ink;
    c.lineWidth = 2;
    c.stroke();
    this.chevron(x, y, ink);
  }

  /**
   * The selection, in the screen's own accent rather than in the team's: what
   * it has to be distinct from is the other markers, which are all in the
   * team's colour — so a difference in fill and line width is the one
   * distinction it cannot use, and that is what it was. It now reads as
   * selected four ways over — brighter hue, larger, four ticks aimed at it,
   * and a halo that breathes — because a d-pad step has to be visible from
   * wherever on the map the eye happens to be.
   *
   * The pulse is drawn from the wall clock rather than from an accumulated dt:
   * this screen's only job is to be looked at, so a phase that survives across
   * respawns costs nothing and there is no dt in reach here anyway.
   */
  private drawSelected(x: number, y: number): void {
    const c = this.ctx;
    const beat = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 3.4);

    c.save();
    // A dark backing disc first: the halo is translucent, and over the mid-grey
    // of a building footprint it would otherwise wash out to nothing.
    c.beginPath();
    c.arc(x, y, 17, 0, Math.PI * 2);
    c.fillStyle = "rgba(6,8,12,0.72)";
    c.fill();

    c.beginPath();
    c.arc(x, y, 15 + beat * 3, 0, Math.PI * 2);
    c.strokeStyle = `rgba(255,230,128,${0.5 - beat * 0.28})`;
    c.lineWidth = 2;
    c.stroke();

    // Four ticks pointing in at the marker — the part that still reads when the
    // map is scaled down to a landscape phone and the disc is a few pixels.
    c.strokeStyle = "rgba(255,230,128,0.85)";
    c.lineWidth = 2;
    c.lineCap = "round";
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      c.beginPath();
      c.moveTo(x + dx * 16, y + dy * 16);
      c.lineTo(x + dx * 23, y + dy * 23);
      c.stroke();
    }

    c.shadowColor = "rgba(255,230,128,0.9)";
    c.shadowBlur = 12;
    c.beginPath();
    c.arc(x, y, 12, 0, Math.PI * 2);
    c.fillStyle = HOT;
    c.fill();
    c.strokeStyle = "#fff6d2";
    c.lineWidth = 2.5;
    c.stroke();
    c.restore();

    this.chevron(x, y, "#0b0e12", 1.35);
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

/** The interface's accent (`--hot` in base.css), which the canvas cannot read. */
const HOT = "#ffe680";

/** Hex colour with an alpha channel, for the zone fills. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

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
