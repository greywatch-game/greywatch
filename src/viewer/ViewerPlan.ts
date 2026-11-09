/**
 * viewer/ViewerPlan.ts — The viewer's overlays, as a 2D PLAN in its panel
 * (`BABYLON_EXIT.md` X5.3b, row "X5.3, the viewer's overlays"): the round's
 * map painted the way the deploy screen and the minimap paint it, the nav
 * graph's verdict over it, the layout's marks, and the camera.
 * Owns: one canvas element (the panel hangs it), its two prerendered layers,
 * and the projection between them and the world.
 *
 * **It is the fourth surface `ui/mapPlan.ts` foresaw, and so a projection and
 * a call rather than a fourth dialect**: the ground, the water, the roads and
 * the masses are `planFromWorld` painted by `paintPlan` over the play square,
 * north up, as the deploy screen does, and the flags are `mapPaint`'s own zone
 * and hexagon. What is the viewer's alone goes over it — the nav buckets
 * (green, red, amber, at one pixel a cell, scaled without smoothing so a
 * cell stays a cell) and the proxies' shapes (`marks.ts`) — in the editor's
 * colours, which is a dev tool's licence and not the interface's: COLOUR
 * MEANS OWNERSHIP on the three maps a player reads, and no player reads this.
 *
 * **It is the whole of the overlay, and that is the decision**: the editor
 * drew the nav graph and the proxies as Babylon meshes in the world, which
 * would put a Babylon draw back in a round, so here there is no draw and no
 * pipeline of OURS either — no WGSL, nothing on the warm-up's list or under its
 * seal. A canvas the compositor shows and the CPU rasters.
 *
 * The base (the map) is painted once per session and the layer above it (the
 * nav and the marks) once per toggle; a frame blits the two and draws the
 * camera's mark, and only when the camera has moved.
 *
 * Never: reads the DOM beyond its own canvas, touches the scene, or writes to
 * the map.
 */
import type { EnvironmentSpec } from "../world/environment";
import type { GameMap } from "../world/MapBuilder";
import { planFromWorld } from "../ui/mapPlan";
import { paintFlagIcon, paintPlan, paintZone, px, py, type PlanView } from "../ui/mapPaint";
import type { PlanMarks } from "./marks";
import { NAV_ISLAND, NAV_UNROUTED, NAV_WALKABLE } from "./navPlan";
import type { NavSnapshot } from "./validate";
import { VIEWER } from "./tuning";

export class ViewerPlan {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly store: number;
  private readonly view: PlanView;
  private readonly base: HTMLCanvasElement;
  private readonly layer: HTMLCanvasElement;
  /** What the last frame drew the camera at, so a still camera draws nothing. */
  private lastX = NaN;
  private lastZ = NaN;
  private lastYaw = NaN;
  /** A click on the plan, in world metres on the ground plane. */
  onPick: ((x: number, z: number) => void) | null = null;

  constructor(map: GameMap, env: EnvironmentSpec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.store = Math.round(VIEWER.planSize * dpr);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = this.store;
    this.canvas.className = "vw-plan";
    this.ctx = this.canvas.getContext("2d")!;
    // The play square, north up, centred — the deploy screen's projection.
    const scale = this.store / map.size;
    this.view = { scale, ox: this.store / 2, oy: this.store / 2 };
    this.base = blank(this.store);
    paintPlan(this.base.getContext("2d")!, planFromWorld(map, env), this.view, {
      bounds: { x: 0, y: 0, w: this.store, h: this.store },
      grid: "lines",
    });
    this.layer = blank(this.store);
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.onPick) return;
      e.stopPropagation();
      const r = this.canvas.getBoundingClientRect();
      const cx = ((e.clientX - r.left) / r.width) * this.store;
      const cy = ((e.clientY - r.top) / r.height) * this.store;
      this.onPick((cx - this.view.ox) / this.view.scale, (this.view.oy - cy) / this.view.scale);
    });
  }

  /**
   * Repaints the layer over the map: the nav buckets per cell (`cells`, from
   * `navPlan.cellsOf`, or null for none) under the marks (or null for none).
   */
  paintLayer(snap: NavSnapshot, cells: Uint8Array | null, marks: PlanMarks | null): void {
    const c = this.layer.getContext("2d")!;
    c.clearRect(0, 0, this.store, this.store);
    if (cells) this.paintNav(c, snap, cells);
    if (marks) this.paintMarks(c, marks);
    this.lastX = NaN;
  }

  /** The camera's mark over both layers; a no-op while it has not moved. */
  draw(x: number, z: number, yaw: number): void {
    if (x === this.lastX && z === this.lastZ && yaw === this.lastYaw) return;
    this.lastX = x;
    this.lastZ = z;
    this.lastYaw = yaw;
    const c = this.ctx;
    c.clearRect(0, 0, this.store, this.store);
    c.drawImage(this.base, 0, 0);
    c.drawImage(this.layer, 0, 0);
    // Held to the plate's edge when the camera is out past the play square, so
    // it is never lost — the borderland and the sky are both places to fly.
    const k = this.store / VIEWER.planSize;
    const m = 4 * k;
    const cx = Math.min(this.store - m, Math.max(m, px(this.view, x)));
    const cy = Math.min(this.store - m, Math.max(m, py(this.view, z)));
    // Facing: world (sin yaw, cos yaw) on the ground plane, Z up the page.
    const fx = Math.sin(yaw);
    const fy = -Math.cos(yaw);
    const spread = 0.42;
    const len = 16 * k;
    c.save();
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(cx + len * (fx * Math.cos(spread) - fy * Math.sin(spread)), cy + len * (fy * Math.cos(spread) + fx * Math.sin(spread)));
    c.lineTo(cx + len * (fx * Math.cos(-spread) - fy * Math.sin(-spread)), cy + len * (fy * Math.cos(-spread) + fx * Math.sin(-spread)));
    c.closePath();
    c.fillStyle = "rgba(255, 255, 255, 0.28)";
    c.fill();
    c.beginPath();
    c.arc(cx, cy, 3 * k, 0, Math.PI * 2);
    c.fillStyle = VIEWER.colors.camera;
    c.fill();
    c.lineWidth = 1.5 * k;
    c.strokeStyle = "rgba(0, 0, 0, 0.8)";
    c.stroke();
    c.restore();
  }

  /** One pixel a cell, then scaled up unsmoothed over the plan. */
  private paintNav(c: CanvasRenderingContext2D, snap: NavSnapshot, cells: Uint8Array): void {
    const { dim, cellSize, origin } = snap;
    const img = new ImageData(dim, dim);
    const px8 = img.data;
    const col = VIEWER.colors;
    const a = VIEWER.navAlpha;
    const rgba: Record<number, [number, number, number, number]> = {
      [NAV_WALKABLE]: [...hex(col.navWalkable), a.walkable],
      [NAV_ISLAND]: [...hex(col.navIsland), a.island],
      [NAV_UNROUTED]: [...hex(col.navUnrouted), a.unrouted],
    };
    for (let cell = 0; cell < dim * dim; cell++) {
      const v = rgba[cells[cell]];
      if (!v) continue;
      // `cell = cz * dim + cx` (NavGrid's convention); the image's rows run
      // DOWN the page and the world's Z runs up it, so row 0 is the top cell.
      const cx = cell % dim;
      const cz = Math.floor(cell / dim);
      const o = ((dim - 1 - cz) * dim + cx) * 4;
      px8[o] = v[0];
      px8[o + 1] = v[1];
      px8[o + 2] = v[2];
      px8[o + 3] = v[3];
    }
    const grid = blank(dim);
    grid.getContext("2d")!.putImageData(img, 0, 0);
    const span = dim * cellSize;
    c.save();
    c.imageSmoothingEnabled = false;
    c.drawImage(grid, px(this.view, origin), py(this.view, origin + span), span * this.view.scale, span * this.view.scale);
    c.restore();
  }

  private paintMarks(c: CanvasRenderingContext2D, marks: PlanMarks): void {
    const v = this.view;
    const k = this.store / VIEWER.planSize;
    c.save();
    c.lineWidth = Math.max(1, 1.2 * k);
    for (const o of marks.outlines) {
      c.beginPath();
      o.xs.forEach((x, i) => (i ? c.lineTo(px(v, x), py(v, o.zs[i])) : c.moveTo(px(v, x), py(v, o.zs[i]))));
      c.closePath();
      if (o.fill > 0) {
        c.globalAlpha = o.fill;
        c.fillStyle = o.color;
        c.fill();
        c.globalAlpha = 1;
      }
      c.strokeStyle = o.color;
      c.stroke();
    }
    for (const r of marks.rings) {
      c.beginPath();
      c.arc(px(v, r.x), py(v, r.z), Math.max(1, r.r * v.scale), 0, Math.PI * 2);
      c.strokeStyle = r.color;
      c.stroke();
    }
    for (const a of marks.arrows) {
      // The proxy's flat triangle along the spawn's facing.
      const x = px(v, a.x);
      const y = py(v, a.z);
      const fx = Math.sin(a.yaw);
      const fy = -Math.cos(a.yaw);
      const s = 5 * k;
      c.beginPath();
      c.moveTo(x + fx * s * 1.4, y + fy * s * 1.4);
      c.lineTo(x - fx * s + fy * s * 0.8, y - fy * s - fx * s * 0.8);
      c.lineTo(x - fx * s - fy * s * 0.8, y - fy * s + fx * s * 0.8);
      c.closePath();
      c.fillStyle = a.color;
      c.fill();
    }
    c.restore();
    for (const f of marks.flags) {
      const x = px(v, f.x);
      const y = py(v, f.z);
      paintZone(c, x, y, f.r * v.scale, VIEWER.colors.controlPoint);
      paintFlagIcon(c, x, y, 7 * k, VIEWER.colors.controlPoint, f.id);
    }
  }
}

function blank(side: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = side;
  return c;
}

function hex(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
