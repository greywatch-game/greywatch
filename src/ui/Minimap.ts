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
const COLOR_NEUTRAL = "#8b8f96";
const COLOR_TEXT = "#e8e8ea";
/** The play square's ground, and everything past it. */
const COLOR_GROUND = "#0b0e12";
const COLOR_OUTSIDE = "#05070a";
/** How far the player's view cone reaches, in canvas pixels. */
const CONE_LENGTH = 30;
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
 * The static village backdrop is prerendered once per round straight from the
 * collider boxes — the same source the deploy screen draws from, so the two
 * maps can never disagree, and a layout change updates both for free. It is
 * rendered at the SAME pixels-per-metre the canvas is drawn at, so scrolling
 * and turning it is a 1:1 blit and nothing blurs; the backdrop is therefore as
 * many pixels across as the play square is metres times that scale — 733 px on
 * Harrowmead's 400 m — and that is the reason the scale is a fixed number rather
 * than something a zoom control moves.
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
   * The chrome around the canvas — chamfered hull and heading mark. A canvas
   * cannot carry those itself (a pseudo-element needs a container), and the
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
   * Canvas pixels per world metre — the ONE scale in this file. The backdrop
   * is prerendered at it and the live view is drawn at it, which is what makes
   * the per-frame blit 1:1.
   */
  private readonly ppm = CONFIG.minimap.size / (2 * CONFIG.minimap.viewRange);
  /** Enemies currently given away by their gunfire, seconds remaining. */
  private readonly revealed = new Map<Combatant, number>();
  /** Accumulator driving the contested-flag pulse. */
  private pulseT = 0;

  constructor() {
    const size = CONFIG.minimap.size;
    this.canvas = document.createElement("canvas");
    this.canvas.id = "minimap";
    this.canvas.width = size;
    this.canvas.height = size;
    // Keep the CSS box and the backing store the same size, or the canvas
    // is scaled and every blip blurs.
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;

    this.frame = document.createElement("div");
    this.frame.id = "minimap-frame";
    this.frame.className = "hidden";
    this.frame.innerHTML = `<div class="hull"></div><div class="compass">↑ N</div>`;
    // The hull is sized off the canvas, so the canvas has to be inside it.
    this.compass = this.frame.querySelector(".compass")!;
    this.frame.insertBefore(this.canvas, this.compass);
    document.getElementById("hud")!.appendChild(this.frame);
    this.ctx = this.canvas.getContext("2d")!;
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

    // Home gates, so both ends of the map read at a glance.
    for (const s of map.spawns) {
      if (s.team === null) continue; // flag spawns are drawn per frame
      const x = toX(s.pos.x);
      const y = toY(s.pos.z);
      const color = s.team === playerTeam ? COLOR_MINE : COLOR_THEIRS;
      c.beginPath();
      c.moveTo(x, y - 6);
      c.lineTo(x + 6, y);
      c.lineTo(x, y + 6);
      c.lineTo(x - 6, y);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = 0.65;
      c.fill();
      c.globalAlpha = 1;
    }

    // The play square's own edge, baked in rather than stroked per frame:
    // the one line on this map that is the boundary the leash measures.
    c.strokeStyle = "rgba(255, 255, 255, 0.16)";
    c.lineWidth = 2;
    c.strokeRect(1, 1, dim - 2, dim - 2);

    this.base = base;
  }

  /** Marks an enemy as visible for a while — wired to gunfire in Game. */
  reveal(who: Combatant): void {
    this.revealed.set(who, CONFIG.minimap.enemyRevealTime);
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
    const size = this.canvas.width;
    const half = size / 2;
    const mr = CONFIG.minimap;
    const scale = this.ppm;
    const toX = (wx: number) => (wx + this.mapSize / 2) * scale;
    const toY = (wz: number) => (this.mapSize / 2 - wz) * scale;
    this.pulseT += dt;
    const pulse = 0.55 + 0.45 * Math.sin(this.pulseT * 9);

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
      c.fillStyle = hexA(ownerColor, 0.16);
      c.fill();
      c.strokeStyle = ownerColor;
      c.lineWidth = p.contested ? 2 : 1.25;
      // A contested flag pulses so it reads from the corner of the eye.
      c.globalAlpha = p.contested ? pulse : 1;
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
        c.arc(x, y, r + 2.5, from, from + Math.abs(p.meter) * Math.PI * 2);
        c.strokeStyle = meterColor;
        c.lineWidth = 2;
        c.stroke();
      }

      // Upright, whichever way the map is turned: the one thing on here that
      // has to be READ rather than merely seen.
      c.save();
      c.translate(x, y);
      c.rotate(playerYaw);
      c.fillStyle = COLOR_TEXT;
      c.font = "bold 11px system-ui, sans-serif";
      c.fillText(p.def.id, 0, 0);
      c.restore();
    }

    // --- friendlies ---
    c.fillStyle = COLOR_MINE;
    for (const body of bodies) {
      if (!body.alive || body.team !== playerTeam) continue;
      c.beginPath();
      c.arc(toX(body.position.x), toY(body.position.z), mr.friendlyRadius, 0, Math.PI * 2);
      c.fill();
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
      c.arc(toX(body.position.x), toY(body.position.z), mr.enemyRadius, 0, Math.PI * 2);
      c.fill();
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
    const lim = half - mr.edgePad;
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
      c.moveTo(mr.edgeRadius + 6, 0);
      c.lineTo(mr.edgeRadius + 0.5, -4.5);
      c.lineTo(mr.edgeRadius + 0.5, 4.5);
      c.closePath();
      c.fillStyle = color;
      c.globalAlpha = p.contested ? pulse : 0.9;
      c.fill();
      c.restore();

      c.beginPath();
      c.arc(x, y, mr.edgeRadius, 0, Math.PI * 2);
      c.fillStyle = "rgba(11, 14, 18, 0.85)";
      c.globalAlpha = 1;
      c.fill();
      c.strokeStyle = color;
      c.lineWidth = p.contested ? 2 : 1.25;
      c.globalAlpha = p.contested ? pulse : 1;
      c.stroke();
      c.globalAlpha = 1;
      c.fillStyle = COLOR_TEXT;
      c.font = "bold 9px system-ui, sans-serif";
      c.fillText(p.def.id, x, y);
    }

    // --- player: view cone + arrow ---
    // The map turns and the player does not, so this is the one marker with no
    // arithmetic behind it at all: dead centre, pointing up, every frame.
    c.save();
    c.translate(half, half);
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, CONE_LENGTH, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    c.closePath();
    c.fillStyle = "rgba(255, 255, 255, 0.10)";
    c.fill();
    c.beginPath();
    c.moveTo(0, -5.5);
    c.lineTo(4, 4.5);
    c.lineTo(0, 2);
    c.lineTo(-4, 4.5);
    c.closePath();
    c.fillStyle = "#ffffff";
    c.strokeStyle = "rgba(0, 0, 0, 0.8)";
    c.lineWidth = 1;
    c.fill();
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
