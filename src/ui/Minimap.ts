/**
 * Minimap.ts — Corner minimap: prerendered static backdrop (per map), flags,
 * friendlies, player. Canvas redrawn each frame.
 * Invariants: enemies are NEVER shown live — only briefly via reveal() when
 * they fire. That's a deliberate information-rule, not a missing feature.
 * setMap() must be called once per round to rebuild the backdrop.
 * The view is PLAYER-CENTRED and HEADING-UP: the player sits at the canvas
 * centre and the world turns under them, so a control point off the drawn
 * square owes an edge marker or it is simply gone.
 * The bodies it draws are `Combatant`s and nothing narrower: offline they are
 * `Bot`s and in a netplay round they are the roster's `NetSoldier`s, and this
 * class must never be able to tell which — a remote human is a body on the map
 * exactly as a bot is.
 * **The map's SHAPE and its PLATE are this file's, not the stylesheet's**: the
 * chamfer is a canvas clip and the edge is a canvas stroke, because the plate
 * is translucent and a CSS edge layer behind a translucent canvas is a lit
 * rectangle rather than a line. `minimap.css` positions the box and styles the
 * one piece of text outside it; everything inside the rectangle is drawn here.
 */
import "./minimap.css";
import type { Vector3 } from "@babylonjs/core";
import { CONFIG } from "../config";
import type { Combatant, Team } from "../entities/Combatant";
import type { ControlPoint } from "../systems/ConquestSystem";
import type { GameMap } from "../world/MapBuilder";

// The "mine/theirs" palette the rest of the HUD uses. Those live in CSS,
// but canvas drawing needs them here.
const COLOR_MINE = "#ffc46b";
const COLOR_THEIRS = "#ff5a4f";
const COLOR_NEUTRAL = "#9aa4b2";
const COLOR_TEXT = "#eef1f6";
/**
 * The play square's ground, and everything past it — **translucent, and that
 * is the whole of the plate**. The HUD's own house rule is that legibility
 * comes from a scrim rather than from an opaque panel over a moving scene
 * (`base.css`), and this map was the last gameplay chrome still painting a
 * solid rectangle over the village. They are dense enough that a lamp-lit
 * street behind them cannot take a footprint off the map, and thin enough that
 * the map sits IN the scene rather than on top of it.
 */
const COLOR_GROUND = "rgba(10, 13, 19, 0.84)";
const COLOR_OUTSIDE = "rgba(4, 6, 10, 0.62)";
/**
 * A building footprint, stated as WHITE over the plate rather than as a flat
 * slate, and both reasons are the line above: the mass has to lift off
 * whatever the plate is standing on rather than off one authored ground
 * colour, and over a translucent plate an opaque grey block is the one thing
 * on the map that does not let the scene through.
 */
const COLOR_BUILDING = "rgba(158, 176, 200, 0.28)";
/** The hairline the plate is closed with, drawn along the chamfer. */
const COLOR_EDGE = "rgba(255, 255, 255, 0.2)";
/** How far the player's view cone reaches, at the authored size. */
const CONE_LENGTH = 32;
/**
 * The corner cut — the same two-cut plate `.frame` draws in CSS, and the reason
 * the number is HERE is that the shape is clipped and stroked in canvas
 * coordinates rather than by the stylesheet.
 *
 * Like everything else on this plate it is stated at the AUTHORED size and
 * multiplied by `Minimap.k`; a chamfer held at twelve pixels while the box came
 * down to a phone's would be an eighth of the map cut off each corner.
 */
const CHAMFER = 12;
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
 * the mid-edge, and the world turns under a player who stays put at the centre
 * pointing up, so a bearing read off the map is the bearing the picture above
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
   * says how much smaller the plate has become. Shapes on it — the chamfer, the
   * view cone, the rim gutter — are stated at the authored size and multiplied
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
    if (this.lastMap) this.buildBase(this.lastMap, this.lastTeam);
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
  setMap(map: GameMap, playerTeam: Team): void {
    this.mapSize = map.size;
    this.revealed.clear();
    this.lastMap = map;
    this.lastTeam = playerTeam;
    this.buildBase(map, playerTeam);
  }

  /**
   * The backdrop itself, split out of `setMap` because a RESIZE needs it too:
   * the scale it is prerendered at is the live view's, and the live view's
   * scale moves with the box.
   */
  private buildBase(map: GameMap, playerTeam: Team): void {
    /** The backdrop is the play square at the live view's own scale. */
    const dim = Math.round(map.size * this.ppm);
    const scale = this.ppm;
    const toX = (wx: number) => (wx + map.size / 2) * scale;
    // Canvas Y grows downward and world +Z is north — flip, so the backdrop
    // itself is north-up and the turning is done once, at draw time.
    const toY = (wz: number) => (map.size / 2 - wz) * scale;

    const base = document.createElement("canvas");
    base.width = dim;
    base.height = dim;
    const c = base.getContext("2d")!;

    c.fillStyle = COLOR_GROUND;
    c.fillRect(0, 0, dim, dim);

    // Building footprints, from the same collider data the deploy map draws.
    c.fillStyle = COLOR_BUILDING;
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

    // Home gates, so both ends of the map read at a glance. Outlined rather
    // than filled, and for the reason the zone rings are: a gate is a PLACE on
    // the map, and three solid lozenges of the loudest colour the HUD owns
    // outshouted the flags, the friendlies and the player's own arrow.
    c.lineWidth = 1;
    for (const s of map.spawns) {
      if (s.team === null) continue; // flag spawns are drawn per frame
      const x = toX(s.pos.x);
      const y = toY(s.pos.z);
      const color = s.team === playerTeam ? COLOR_MINE : COLOR_THEIRS;
      c.beginPath();
      c.moveTo(x, y - 5);
      c.lineTo(x + 5, y);
      c.lineTo(x, y + 5);
      c.lineTo(x - 5, y);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = 0.16;
      c.fill();
      c.globalAlpha = 0.72;
      c.strokeStyle = color;
      c.stroke();
      c.globalAlpha = 1;
    }

    // The play square's own edge, baked in rather than stroked per frame:
    // the one line on this map that is the boundary the leash measures.
    c.strokeStyle = "rgba(255, 255, 255, 0.13)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, dim - 1, dim - 1);

    this.base = base;
  }

  /** Marks an enemy as visible for a while — wired to gunfire in Game. */
  reveal(who: Combatant): void {
    this.revealed.set(who, CONFIG.minimap.enemyRevealTime);
  }

  /**
   * The plate's outline: the two-cut chamfer `.frame` draws in CSS, as a path
   * in canvas pixels. `inset` moves it inward, which is how one description of
   * the shape serves both the clip (0) and the hairline that closes it (0.5,
   * so a 1 px stroke lands wholly inside the clip instead of half outside it
   * and half antialiased away).
   */
  private outline(c: CanvasRenderingContext2D, inset: number): void {
    const a = inset;
    const b = this.box - inset;
    const cham = CHAMFER * this.k;
    c.beginPath();
    c.moveTo(a + cham, a);
    c.lineTo(b, a);
    c.lineTo(b, b - cham);
    c.lineTo(b - cham, b);
    c.lineTo(a, b);
    c.lineTo(a, a + cham);
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
    c.drawImage(this.base, 0, 0);

    // --- flags ---
    for (const p of points) {
      const x = toX(p.def.pos.x);
      const y = toY(p.def.pos.z);
      const r = p.def.radius * scale;
      const ownerColor = flagColor(p, playerTeam);

      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = hexA(ownerColor, 0.12);
      c.fill();
      c.strokeStyle = ownerColor;
      c.lineWidth = p.contested ? 1.6 : 1;
      c.lineWidth *= Math.max(k, 0.8);
      // A contested flag pulses so it reads from the corner of the eye.
      c.globalAlpha = p.contested ? pulse : 0.7;
      c.stroke();
      c.globalAlpha = 1;

      // The meter as an arc from twelve o'clock: a full circle is owned
      // outright. Its colour is the team the meter belongs to, so a flag
      // being flipped shows the attacker's colour eating the defender's.
      //
      // Twelve o'clock is the SCREEN's, and `+ playerYaw` is what keeps it
      // there: this layer is turned by -yaw, so an angle written in it lands
      // that much anticlockwise on the glass. A dial is read, not steered —
      // one that started at map north would spin under a turning player and
      // put "nearly taken" at eight o'clock.
      if (p.meter !== 0) {
        const meterColor =
          Math.sign(p.meter) === (playerTeam === 0 ? -1 : 1)
            ? COLOR_MINE
            : COLOR_THEIRS;
        const from = -Math.PI / 2 + playerYaw;
        c.beginPath();
        c.arc(x, y, r + 3 * k, from, from + Math.abs(p.meter) * Math.PI * 2);
        c.strokeStyle = meterColor;
        c.lineWidth = Math.max(2 * k, 1.2);
        // Round caps: the dial is the one moving line on the map, and a
        // squared-off end reads as a tick mark rather than as a level.
        c.lineCap = "round";
        c.stroke();
        c.lineCap = "butt";
      }

      // Upright, whichever way the map is turned: the one thing on here that
      // has to be READ rather than merely seen. The halo is what lets it be
      // read over a footprint as well as over open ground, which a plain fill
      // could only manage by being heavy enough to shout on both.
      c.save();
      c.translate(x, y);
      c.rotate(playerYaw);
      c.font = `700 ${Math.max(10 * k, MIN_GLYPH).toFixed(1)}px ${this.face}`;
      c.shadowColor = "rgba(0, 0, 0, 0.9)";
      c.shadowBlur = 3;
      c.fillStyle = COLOR_TEXT;
      c.fillText(p.def.id, 0, 0);
      c.restore();
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
    // drawn square is pinned to the rim on the bearing it lies at, carrying
    // its letter and its owner's colour — the direction to walk, at the cost
    // of the distance to it, which the pin cannot express and the flag list
    // across the top of the HUD does not need to.
    //
    // The rim is the SQUARE's, not a circle inscribed in it: the corners are
    // drawn map like everywhere else, and a circular rim would post a marker
    // for a flag the player can already see sitting in one.
    // The disc is sized off the LETTER it carries rather than given a floor of
    // its own: the glyph has one (`MIN_GLYPH`) because it has to be read, and a
    // disc that followed the box all the way down would end up smaller than the
    // letter standing in it. The authored pair is 9 px of type in a 7 px disc,
    // which is where the 0.78 comes from — at full size this is `edgeRadius`
    // to within a rounding error. The gutter is then measured out from whatever
    // the disc came to, so the chevron on its outer side clears the chamfer.
    const rimGlyph = Math.max(9 * k, MIN_GLYPH);
    const edgeR = Math.max(mr.edgeRadius * k, rimGlyph * 0.78);
    const lim = half - edgeR - Math.max((mr.edgePad - mr.edgeRadius) * k, 6);
    for (const p of points) {
      const bx = toX(p.def.pos.x) - px;
      const by = toY(p.def.pos.z) - py;
      const sx = bx * cos + by * sin;
      const sy = -bx * sin + by * cos;
      const m = Math.max(Math.abs(sx), Math.abs(sy));
      if (m <= lim) continue;
      const k = lim / m;
      const x = half + sx * k;
      const y = half + sy * k;
      const color = flagColor(p, playerTeam);

      // The chevron carries the bearing; the disc behind it carries the name.
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

      c.beginPath();
      c.arc(x, y, edgeR, 0, Math.PI * 2);
      c.fillStyle = "rgba(8, 11, 16, 0.9)";
      c.globalAlpha = 1;
      c.fill();
      c.strokeStyle = color;
      c.lineWidth = 1;
      c.globalAlpha = p.contested ? pulse : 0.85;
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = COLOR_TEXT;
      c.font = `700 ${rimGlyph.toFixed(1)}px ${this.face}`;
      c.fillText(p.def.id, x, y);
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

    // The plate's own edge, last and inside the clip: one hairline along the
    // chamfer, which is the whole of the frame now.
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

/** Hex colour with an alpha channel, for the zone fills. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
