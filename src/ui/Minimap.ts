/**
 * Minimap.ts — Corner minimap: the shared map plan prerendered once per map
 * (`mapPlan.ts`/`mapPaint.ts`), with the flags, the friendlies and the player
 * drawn over it every frame.
 * Invariants: enemies are NEVER shown live — only briefly via reveal() when
 * they fire. That's a deliberate information-rule, not a missing feature.
 * setMap() must be called once per round to rebuild the backdrop.
 * The view is PLAYER-CENTRED and HEADING-UP: the player sits at the canvas
 * centre and the world turns under them, so a control point off the drawn
 * disc owes a rim marker or it is simply gone.
 * The bodies it draws are `Combatant`s and nothing narrower: offline they are
 * `Bot`s and in a netplay round they are the roster's `NetSoldier`s, and this
 * class must never be able to tell which — a remote human is a body on the map
 * exactly as a bot is.
 * **The DRAWING is the painter's and the TURN is this file's.** What belongs
 * here is only what a heading-up map owes that a north-up one does not: the
 * counter-rotation, `twelve` (which keeps a capture dial's zero at the top of
 * the glass), the rim markers, the compass, and the pad under the player's own
 * arrow. Anything about what the GROUND looks like belongs in `mapPaint.ts`,
 * or the corner map and the deploy screen start disagreeing about the village
 * again.
 * **The map's SHAPE and its PLATE are this file's, not the stylesheet's, and
 * the shape is a DISC**: the clip is a canvas arc and the edge is a canvas
 * stroke, because the plate is translucent and a CSS edge layer behind a
 * translucent canvas is a lit shape rather than a line. `minimap.css` positions
 * the box and styles the one piece of text outside it; everything inside the
 * circle is drawn here.
 */
import "./minimap.css";
import type { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import type { ControlPoint } from "../systems/ConquestSystem";
import type { EnvironmentSpec } from "../world/environment";
import type { GameMap } from "../world/MapBuilder";
import {
  paintFlagIcon,
  paintPlan,
  paintZone,
  type PlanView,
} from "./mapPaint";
import { planFromWorld } from "./mapPlan";

// The "mine/theirs" palette the rest of the HUD uses. Those live in CSS,
// but canvas drawing needs them here.
const COLOR_MINE = "#ffc46b";
const COLOR_THEIRS = "#ff5a4f";
const COLOR_NEUTRAL = "#9aa4b2";
/**
 * How much of the scene the plate lets through — **translucent, and that is
 * the whole of the plate**. The HUD's own house rule is that legibility comes
 * from a scrim rather than from an opaque panel over a moving scene
 * (`base.css`), and this map was the last gameplay chrome still painting a
 * solid rectangle over the village.
 *
 * **It is now one alpha on the BLIT rather than an alpha per colour**, which
 * is what lets the plan be the same drawing as the deploy screen's and the
 * menu's: `mapPaint.ts` paints an opaque plan into the backdrop, and the plate
 * is that picture composited at this. Dense enough that a lamp-lit street
 * behind it cannot take a footprint off the map, thin enough that the map sits
 * IN the scene rather than on top of it — and, unlike the per-colour version,
 * it holds the plan's own value ladder together instead of flattening a
 * three-storey block and a yard wall into one wash.
 */
const PLATE_ALPHA = 0.84;
/** The ground past the play square, which only a borderland map ever shows. */
const COLOR_OUTSIDE = "rgba(4, 6, 10, 0.62)";
/** The hairline the plate is closed with, drawn around the rim. */
const COLOR_EDGE = "rgba(255, 255, 255, 0.2)";
/** How far the player's view cone reaches, at the authored size. */
const CONE_LENGTH = 32;
/**
 * The floor under anything on this map that has to be READ rather than merely
 * seen — a blip, a letter, a rim marker. Below about this the mark stops being
 * one, so the shape constants follow the box down and these do not: the map
 * shrinks, the things standing on it do not shrink with it all the way.
 */
const MIN_BLIP = 2.4;
const MIN_GLYPH = 7.5;
/** The eight-point compass the heading label is quantised to. */
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * The in-round corner minimap: a player-centred, heading-up view showing the
 * ground around the player, the flags, every friendly, and — pinned to the rim
 * — a marker for each control point the view does not reach.
 *
 * **It is a local view, not a map of the level.** The whole-map, north-up
 * picture is the deploy screen's job and it is still there; this one exists to
 * answer *what is around me right now*, which a 240–400 m square shrunk into
 * 220 px cannot do — at Harrowmead's scale a building was two pixels and the
 * five flags sat in the middle third. `CONFIG.minimap.viewRange` metres reach
 * the RIM — the plate is a disc, so that is one radius in every direction
 * rather than a square's mid-edge — and the world turns under a player who
 * stays put at the centre pointing up, so a bearing read off the map is the bearing the picture above
 * it already shows. What that costs is NORTH, which the frame's compass gives
 * back as the heading the top of the map is currently pointing at.
 *
 * **How BIG it is is the stylesheet's** (`--hud-map`), and `resize` is what
 * follows it — the map is the one readout on this HUD whose cost is an area, so
 * it is the first thing that reads as too big on a phone. Everything drawn here
 * is stated at the AUTHORED size (`CONFIG.minimap.size`) and multiplied by `k`;
 * see that field for the one split that matters, which is that a SHAPE follows
 * the box down and a MARK a player has to read does not.
 *
 * The static village backdrop is prerendered once per round straight from the
 * collider boxes — the same source the deploy screen draws from, so the two
 * maps can never disagree, and a layout change updates both for free. It is
 * rendered at the SAME pixels-per-metre the canvas is drawn at, so scrolling
 * and turning it is a 1:1 blit and nothing blurs; the backdrop is therefore as
 * many pixels across as the play square is metres times that scale — 733 px on
 * Harrowmead's 400 m at the authored box — which is why a resize has to build
 * it again (`buildBase`) rather than merely redrawing.
 *
 * Enemies are deliberately NOT shown: that would be a wallhack. Instead a body
 * that opens fire is revealed for `CONFIG.minimap.enemyRevealTime` seconds —
 * the classic "shooting gives you away" rule — via `reveal()`, wired in Game
 * to `BattleSystem.onBotFired` offline and to the server's `fire` event in a
 * netplay round. Both callers make the team test; this class reveals whoever
 * it is handed.
 */
export class Minimap {
  private canvas: HTMLCanvasElement;
  /**
   * The chrome around the canvas — the heading mark, and the box the drop
   * shadow hangs off. A canvas cannot carry a label outside itself, and the
   * frame is what `setVisible` toggles, so the two can never disagree.
   */
  private frame: HTMLElement;
  private compass: HTMLElement;
  /** Last heading written to the compass, so a frame that turns nothing writes nothing. */
  private compassLabel = "";
  private ctx: CanvasRenderingContext2D;
  /** Static backdrop (ground + footprints + home gates), rebuilt per round. */
  private base: HTMLCanvasElement | null = null;
  private mapSize: number = CONFIG.map.size;
  /**
   * The map's side in CSS pixels, which is whatever `--hud-map` resolved to —
   * `resize` reads it back off the element rather than this file deciding it.
   * Everything below is drawn in these units; `dpr` is what the backing store
   * carries on top, so a phone gets a crisp map and this code never mentions
   * device pixels again.
   */
  private box: number = CONFIG.minimap.size;
  private dpr = 1;
  /**
   * The box against the size this map was AUTHORED at, and the one number that
   * says how much smaller the plate has become. Shapes on it — the view cone,
   * the rim gutter, the arrow — are stated at the authored size and multiplied
   * by this; the marks a player has to read are floored instead (see
   * `MIN_BLIP`), because a blip drawn to scale on a phone-sized map is a blip
   * nobody can see.
   */
  private k = 1;
  /**
   * Canvas pixels per world metre — the ONE scale in this file. The backdrop
   * is prerendered at it and the live view is drawn at it, which is what makes
   * the per-frame blit 1:1. It moves with the box, which is why the backdrop
   * has to be rebuilt when the box does.
   */
  private ppm = CONFIG.minimap.size / (2 * CONFIG.minimap.viewRange);
  /**
   * The round's map and side, held only so a RESIZE can prerender the backdrop
   * again at the new scale. Nothing else reads them: `setMap` is still the one
   * place a backdrop is described, and this is the one place it is repeated.
   */
  private lastMap: GameMap | null = null;
  private lastTeam: Team = 0;
  private lastEnv: EnvironmentSpec | null = null;
  /** Enemies currently given away by their gunfire, seconds remaining. */
  private readonly revealed = new Map<Combatant, number>();
  /** Accumulator driving the contested-flag pulse. */
  private pulseT = 0;
  /**
   * The HUD's own condensed grotesque, read off the element once rather than
   * restated as a stack. Canvas takes a font as a string and inherits nothing,
   * so a letter drawn here would otherwise be the browser's UI face sitting
   * beside a HUD set entirely in `--font`.
   */
  private readonly face: string;
  /**
   * The view cone's fade, built once. A gradient is resolved in the space it
   * is PAINTED in, and this one is painted with the origin at the canvas
   * centre every time — a point that never moves — so caching it is exact
   * rather than an approximation, and this class draws every frame of a round.
   */
  private cone: CanvasGradient | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "minimap";
    // No inline size: the box is `--hud-map` in `minimap.css` and `resize`
    // below follows it. Writing one here would beat the stylesheet and pin the
    // map at its desktop size on every device.

    this.frame = document.createElement("div");
    this.frame.id = "minimap-frame";
    this.frame.className = "hidden";
    this.frame.innerHTML = `<div class="compass">↑ N</div>`;
    this.compass = this.frame.querySelector(".compass")!;
    this.frame.insertBefore(this.canvas, this.compass);
    document.getElementById("hud")!.appendChild(this.frame);
    this.ctx = this.canvas.getContext("2d")!;
    // Read after the append, so the cascade has already put `#hud`'s `--font`
    // on it.
    this.face = getComputedStyle(this.frame).fontFamily || "sans-serif";
    // The element is what is watched and not the window, so the map follows
    // `--hud-map` however it moved — a rotation, a resize, the on-screen
    // controls coming up and taking the trim with them. Setting `width` from
    // inside the callback does not change the element's LAYOUT size, so this
    // cannot feed itself.
    new ResizeObserver(() => this.resize()).observe(this.canvas);
    this.resize();
  }

  /**
   * Matches the backing store to the box the stylesheet gave the element, and
   * re-prerenders the backdrop at the new scale.
   *
   * **The context is left scaled by the device ratio**, so every line below is
   * written in CSS pixels and comes out crisp on a phone — which is the half of
   * this that is not about the phone being small. A canvas whose backing store
   * is its CSS size is drawn at a third of the resolution on a modern handset,
   * and this map is the finest line work on the HUD.
   *
   * A hidden frame measures zero and is ignored: `#minimap-frame.hidden` is
   * `display: none`, and a zero-sized canvas would rebuild the backdrop at a
   * scale of nothing and hand it back on the next round.
   */
  private resize(): void {
    const box = this.canvas.clientWidth;
    if (box < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const store = Math.round(box * dpr);
    // The BACKING STORE is what the early-out is measured against and not the
    // two fields, because those are seeded with the authored size so that `ppm`
    // and `k` are coherent before anything has been drawn: a first call on a
    // desktop, where the box IS the authored size, would otherwise agree with
    // itself and leave the canvas at its 300x150 default — a squashed map that
    // looks like a drawing bug rather than a sizing one.
    if (this.canvas.width === store && dpr === this.dpr) return;
    this.box = box;
    this.dpr = dpr;
    this.k = box / CONFIG.minimap.size;
    this.ppm = box / (2 * CONFIG.minimap.viewRange);
    this.canvas.width = store;
    this.canvas.height = store;
    // Resizing the backing store resets the context, so the ratio transform and
    // the cached cone both have to be put back — the gradient was built in the
    // old space and is a REACH rather than a shape (see the field).
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cone = null;
    if (this.lastMap && this.lastEnv) {
      this.buildBase(this.lastMap, this.lastTeam, this.lastEnv);
    }
  }

  setVisible(visible: boolean): void {
    this.frame.classList.toggle("hidden", !visible);
  }

  /**
   * Prerenders the static backdrop. `playerTeam` is baked in now (it never
   * changes mid-round) so the home-gate diamonds can use mine/theirs colours.
   *
   * The backdrop covers the PLAY SQUARE and stops there. On a map with a
   * borderland a player can legitimately be eighty metres outside it, and what
   * they get is the duller ground `update` paints the canvas with plus this
   * image's own edge — which is the boundary the leash is counting them down
   * against, and worth drawing for that alone.
   */
  setMap(map: GameMap, playerTeam: Team, env: EnvironmentSpec): void {
    this.mapSize = map.size;
    this.revealed.clear();
    this.lastMap = map;
    this.lastTeam = playerTeam;
    this.lastEnv = env;
    this.buildBase(map, playerTeam, env);
  }

  /**
   * The backdrop itself, split out of `setMap` because a RESIZE needs it too:
   * the scale it is prerendered at is the live view's, and the live view's
   * scale moves with the box.
   */
  private buildBase(
    map: GameMap,
    playerTeam: Team,
    env: EnvironmentSpec,
  ): void {
    /** The backdrop is the play square at the live view's own scale. */
    const dim = Math.round(map.size * this.ppm);
    const base = document.createElement("canvas");
    base.width = dim;
    base.height = dim;
    const c = base.getContext("2d")!;

    // Canvas Y grows downward and world +Z is north, so the projection flips
    // Z: the backdrop itself is drawn north-up and the turning is done once,
    // per frame, at draw time.
    const view: PlanView = { scale: this.ppm, ox: dim / 2, oy: dim / 2 };
    // The plan — the same one the deploy screen and the menu draw, at this
    // map's own magnification. LINES and no letters: the map turns under the
    // player, so a lettered square would be read upside down half the time,
    // and the grid is here for the sense of SPEED a moving lattice gives
    // rather than as a coordinate anybody quotes.
    paintPlan(c, planFromWorld(map, env), view, {
      bounds: { x: 0, y: 0, w: dim, h: dim },
      grid: "lines",
    });

    // Home gates, so both ends of the map read at a glance. Outlined rather
    // than filled, and for the reason the zone rings are: a gate is a PLACE on
    // the map, and three solid lozenges of the loudest colour the HUD owns
    // outshouted the flags, the friendlies and the player's own arrow.
    const r = Math.max(4, 3.4 * this.k);
    c.lineWidth = 1;
    for (const s of map.spawns) {
      if (s.team === null) continue; // flag spawns are drawn per frame
      const x = view.ox + s.pos.x * view.scale;
      const y = view.oy - s.pos.z * view.scale;
      const color = s.team === playerTeam ? COLOR_MINE : COLOR_THEIRS;
      c.beginPath();
      c.moveTo(x, y - r);
      c.lineTo(x + r, y);
      c.lineTo(x, y + r);
      c.lineTo(x - r, y);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = 0.16;
      c.fill();
      c.globalAlpha = 0.72;
      c.strokeStyle = color;
      c.stroke();
      c.globalAlpha = 1;
    }

    this.base = base;
  }

  /** Marks an enemy as visible for a while — wired to gunfire in Game. */
  reveal(who: Combatant): void {
    this.revealed.set(who, CONFIG.minimap.enemyRevealTime);
  }

  /**
   * The plate's outline: the DISC the map is drawn in, as a path in canvas
   * pixels. `inset` moves it inward, which is how one description of the shape
   * serves both the clip (0) and the hairline that closes it (0.5, so a 1 px
   * stroke lands wholly inside the clip instead of half outside it and half
   * antialiased away).
   *
   * **It is a circle, and that is not only a look — it is what makes the rim
   * markers a single number.** The boundary is now the same distance from the
   * player in every direction, so "off the map" is one Euclidean test and a
   * pin lands ON the edge rather than on a chamfered square's approximation of
   * it. It also takes the corners away, which is where the map reached 1.41x
   * `viewRange` and nothing else did — see that field in `config/hud.ts`.
   */
  private outline(c: CanvasRenderingContext2D, inset: number): void {
    const half = this.box / 2;
    c.beginPath();
    c.arc(half, half, half - inset, 0, Math.PI * 2);
    c.closePath();
  }

  /**
   * `bodies` is every combatant but the local player — the bot pool offline,
   * the roster's sixteen in a netplay round, chosen by `Game.mapBodies`. The
   * local player's own slot is in the netplay list and is deliberately never
   * alive there, so it draws nothing under the arrow that already stands for
   * them.
   */
  update(
    dt: number,
    playerPos: Vector3,
    playerYaw: number,
    points: ControlPoint[],
    bodies: readonly Combatant[],
    playerTeam: Team,
  ): void {
    if (!this.base) return;
    const c = this.ctx;
    // The BOX and not the backing store: the context is scaled by the device
    // ratio for the length of the canvas's life, so everything here is in CSS
    // pixels. See `resize`.
    const size = this.box;
    const half = size / 2;
    const k = this.k;
    const mr = CONFIG.minimap;
    const scale = this.ppm;
    const toX = (wx: number) => (wx + this.mapSize / 2) * scale;
    const toY = (wz: number) => (this.mapSize / 2 - wz) * scale;
    this.pulseT += dt;
    const pulse = 0.55 + 0.45 * Math.sin(this.pulseT * 9);

    // The plate is translucent, so a frame that merely painted over the last
    // one would stack its own alpha until the map was opaque. Cleared BEFORE
    // the clip, because the clip is the shape being cleared.
    c.clearRect(0, 0, size, size);
    c.save();
    this.outline(c, 0);
    c.clip();

    // Ground past the play square. The backdrop covers the square itself, so
    // this only ever shows on a map with a borderland — where it is the point.
    c.fillStyle = COLOR_OUTSIDE;
    c.fillRect(0, 0, size, size);

    // Every label on here is centred on the point it names — set once, and
    // OUTSIDE the save/restore the turned world layer is drawn inside, because
    // `restore` puts the text state back too and the rim markers are drawn
    // after it.
    c.textAlign = "center";
    c.textBaseline = "middle";

    // The player's spot on the north-up backdrop, and the turn that puts their
    // facing at the top of the canvas. World yaw 0 faces +Z (north), and the
    // backdrop is drawn north-up, so counter-rotating by the yaw is the whole
    // of it: `rotate(-yaw)` sends the facing direction to straight up.
    const px = toX(playerPos.x);
    const py = toY(playerPos.z);
    const cos = Math.cos(playerYaw);
    const sin = Math.sin(playerYaw);

    c.save();
    c.translate(half, half);
    c.rotate(-playerYaw);
    c.translate(-px, -py);
    // The plate's translucency, in one place: the plan is an opaque picture
    // and this is how much of the street behind it survives. See PLATE_ALPHA.
    c.globalAlpha = PLATE_ALPHA;
    c.drawImage(this.base, 0, 0);
    c.globalAlpha = 1;

    // --- flags ---
    for (const p of points) {
      const x = toX(p.def.pos.x);
      const y = toY(p.def.pos.z);
      const r = p.def.radius * scale;
      const ownerColor = flagColor(p, playerTeam);

      // The zone, the hexagon and the meter are `mapPaint.ts`'s, because the
      // flag a player reads off this corner map, off the deploy screen they
      // picked it on and off the strip along the top of the HUD has to be one
      // mark. What is this file's is the two things only a TURNING map has:
      // the contested pulse, and `twelve` — the layer is turned by -yaw, so an
      // angle written in it lands that much anticlockwise on the glass, and a
      // dial is read rather than steered. One that started at map north would
      // spin under a turning player and put "nearly taken" at eight o'clock.
      paintZone(c, x, y, r, ownerColor, {
        contested: p.contested,
        alpha: p.contested ? pulse : 1,
      });
      paintFlagIcon(c, x, y, Math.max(7 * k, MIN_GLYPH * 0.78), ownerColor, p.def.id, {
        meter: p.meter,
        meterColor:
          Math.sign(p.meter) === (playerTeam === 0 ? -1 : 1)
            ? COLOR_MINE
            : COLOR_THEIRS,
        twelve: playerYaw,
        contested: p.contested,
        face: this.face,
      });
    }

    // --- friendlies ---
    // A dot and the dark ring that separates it from whatever it is standing
    // on: over a pale footprint an unringed blip of much the same value simply
    // disappears, and the ring costs one stroke.
    c.strokeStyle = "rgba(6, 9, 14, 0.8)";
    c.lineWidth = 1;
    c.fillStyle = COLOR_MINE;
    const friendR = Math.max(mr.friendlyRadius * k, MIN_BLIP);
    const enemyR = Math.max(mr.enemyRadius * k, MIN_BLIP);
    for (const body of bodies) {
      if (!body.alive || body.team !== playerTeam) continue;
      c.beginPath();
      c.arc(toX(body.position.x), toY(body.position.z), friendR, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }

    // --- enemies, only while their gunfire gives them away ---
    for (const [body, t] of this.revealed) {
      const left = t - dt;
      if (left <= 0 || !body.alive) {
        this.revealed.delete(body);
        continue;
      }
      this.revealed.set(body, left);
      c.globalAlpha = Math.min(1, left / mr.enemyFadeTime);
      c.fillStyle = COLOR_THEIRS;
      c.beginPath();
      c.arc(toX(body.position.x), toY(body.position.z), enemyR, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.globalAlpha = 1;
    }

    c.restore();

    // --- control points the view does not reach ---
    //
    // A zoomed map is a map that has stopped showing the objectives, and the
    // objectives are the only reason to look at it. So every flag off the
    // drawn disc is pinned to the rim on the bearing it lies at, carrying
    // its letter and its owner's colour — the direction to walk, at the cost
    // of the distance to it, which the pin cannot express and the flag list
    // across the top of the HUD does not need to.
    //
    // The rim is the plate's own circle, so the pin is EUCLIDEAN — a flag is
    // off the map exactly when it is further from the centre than the clip is.
    // It used to be a Chebyshev test because the plate was a square and a
    // circle inscribed in one would have posted a marker for a flag the player
    // could already see sitting in a corner; there are no corners now, so the
    // two questions have become the same question.
    // The disc is sized off the LETTER it carries rather than given a floor of
    // its own: the glyph has one (`MIN_GLYPH`) because it has to be read, and a
    // disc that followed the box all the way down would end up smaller than the
    // letter standing in it. The authored pair is 9 px of type in a 7 px disc,
    // which is where the 0.78 comes from — at full size this is `edgeRadius`
    // to within a rounding error. The gutter is then measured out from whatever
    // the disc came to, so the chevron on its outer side clears the rim.
    const rimGlyph = Math.max(9 * k, MIN_GLYPH);
    const edgeR = Math.max(mr.edgeRadius * k, rimGlyph * 0.78);
    const lim = half - edgeR - Math.max((mr.edgePad - mr.edgeRadius) * k, 6);
    for (const p of points) {
      const bx = toX(p.def.pos.x) - px;
      const by = toY(p.def.pos.z) - py;
      const sx = bx * cos + by * sin;
      const sy = -bx * sin + by * cos;
      const m = Math.hypot(sx, sy);
      if (m <= lim) continue;
      const k = lim / m;
      const x = half + sx * k;
      const y = half + sy * k;
      const color = flagColor(p, playerTeam);

      // The chevron carries the bearing; the hexagon behind it carries the
      // name — and it is the SAME hexagon the flag itself wears when it is on
      // the drawn disc, which is the point. A marker that changed shape as
      // the player walked toward it would be a second alphabet.
      c.save();
      c.translate(x, y);
      c.rotate(Math.atan2(sy, sx));
      c.beginPath();
      c.moveTo(edgeR + 5 * k, 0);
      c.lineTo(edgeR + 1, -3.6 * k);
      c.lineTo(edgeR + 1, 3.6 * k);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = p.contested ? pulse : 0.8;
      c.fill();
      c.restore();

      paintFlagIcon(c, x, y, edgeR, color, p.def.id, {
        contested: p.contested,
        alpha: p.contested ? pulse : 1,
        face: this.face,
      });
    }

    // --- player: view cone + arrow ---
    // The map turns and the player does not, so this is the one marker with no
    // arithmetic behind it at all: dead centre, pointing up, every frame.
    c.save();
    c.translate(half, half);
    // The cone is a REACH and follows the box; the arrow is the player and is
    // floored with the blips, since it is the mark the eye goes to first.
    const coneLen = CONE_LENGTH * k;
    const ak = Math.max(k, 0.72);
    if (!this.cone) {
      // A flat wedge is a shape; a fade is a REACH. What the cone stands for
      // is how far the player can see, which has no edge in the world either.
      this.cone = c.createRadialGradient(0, 0, 0, 0, 0, coneLen);
      this.cone.addColorStop(0, "rgba(255, 255, 255, 0.2)");
      this.cone.addColorStop(1, "rgba(255, 255, 255, 0)");
    }
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, coneLen, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6);
    c.closePath();
    c.fillStyle = this.cone;
    c.fill();
    // A dark pad under the arrow, and it is not decoration: the plan under
    // the player is now a town drawn in pale grey mass rather than the flat
    // near-black plate this arrow was drawn for, and a white arrow standing on
    // a white roof is not a marker. The pad is what guarantees a value under
    // it whatever the player happens to be standing on.
    c.beginPath();
    c.arc(0, 0, 7.4 * ak, 0, Math.PI * 2);
    c.fillStyle = "rgba(6, 9, 14, 0.55)";
    c.fill();

    c.beginPath();
    c.moveTo(0, -6.5 * ak);
    c.lineTo(4.4 * ak, 4.6 * ak);
    c.lineTo(0, 2.2 * ak);
    c.lineTo(-4.4 * ak, 4.6 * ak);
    c.closePath();
    // A halo rather than a hard black outline: at this size a 1 px stroke is a
    // third of the arrow's own width, which is what made it read as a blob.
    c.shadowColor = "rgba(0, 0, 0, 0.9)";
    c.shadowBlur = 4;
    c.fillStyle = "#ffffff";
    c.fill();
    c.restore();

    // The plate's own edge, last and inside the clip: one hairline around the
    // rim, which is the whole of the frame now.
    this.outline(c, 0.5);
    c.strokeStyle = COLOR_EDGE;
    c.lineWidth = 1;
    c.stroke();
    c.restore();

    // North is what a turning map spends, and the frame's mark buys it back as
    // the bearing the top of the canvas is pointing at. World yaw IS a compass
    // bearing (0 = +Z = north, quarter turn = east), so this is a lookup — and
    // the arrow is what makes it a heading rather than a north pointer, which
    // is the one way a reader could take it the wrong way round.
    const deg = ((playerYaw * 180) / Math.PI) % 360;
    const label = CARDINALS[Math.round(((deg + 360) % 360) / 45) % 8];
    if (label !== this.compassLabel) {
      this.compassLabel = label;
      this.compass.textContent = `↑ ${label}`;
    }
  }
}

/** Mine, theirs or nobody's — the one ownership test, used twice per flag. */
function flagColor(p: ControlPoint, playerTeam: Team): string {
  if (p.owner === null) return COLOR_NEUTRAL;
  return p.owner === playerTeam ? COLOR_MINE : COLOR_THEIRS;
}
