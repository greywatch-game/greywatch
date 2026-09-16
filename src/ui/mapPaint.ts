/**
 * mapPaint.ts — The LOOK of a map in this interface: one painter, for the
 * menu's schematic, the deploy screen's plan and the corner minimap alike.
 * Owns: every colour, weight and layer order on all three, plus the two marks
 * that have to be the same mark on all three (a control point's zone and its
 * hexagon). Takes a `MapPlan` (`mapPlan.ts`) and a projection; knows nothing
 * about a round, a team or a cursor.
 * Invariants: it draws the GROUND and the things standing on it, in one fixed
 * order, and every layer is derived from the plan or from the map's own
 * `EnvironmentSpec` — there is no per-map table here and a seventh map is
 * coloured by the environment it ships with. Nothing here reads the DOM, holds
 * state or allocates per frame beyond the raster it is asked to build; all
 * three callers prerender the base and blit it.
 *
 * **It is a MILITARY PLAN and the whole of its discipline is that colour means
 * OWNERSHIP.** The ground, the water, the carriageways and the masses are a
 * value ramp off the map's own hue and nothing else, so the only saturated
 * things on any of these three surfaces are the flags, the bodies and the
 * cursor. That is the rule to hold if a layer is added: a drawing where the
 * town is as loud as the objective is a drawing a player has to search.
 *
 * **What it draws is the same at every magnification and NOT the same
 * drawing.** One plan is read at 0.15 px/m on the menu's dossier, 0.4 on
 * Cinderhaven's deploy map and 1.8 on the minimap — a factor of twelve — so
 * the layers gate themselves on `PlanView.scale`: contour interval is chosen
 * so the lines never crowd, fences appear when a fence is more than a smudge,
 * the rim light appears when a mass is wide enough to have one, and a wall is
 * grown to a legible thickness far out so a town reads as mass rather than
 * dissolving into the hairlines it is actually made of. **A layer that cannot
 * state what it does at 0.15 px/m does not belong here**; that was the old
 * deploy map's failure, where 3,700 flat grey boxes at Cinderhaven's scale
 * were one grey smear.
 */
import type { MapPlan, PlanMass, PlanPoly } from "./mapPlan";
import { CONFIG } from "../config";
import type { EnvironmentSpec } from "../world/environment";
import { isScatterRect } from "../world/layout";
import { waterY } from "../world/TerrainField";

/**
 * Where the world lands on the canvas: north-up, one scale on both axes.
 *
 * `oy` is the canvas row world z = 0 falls on and the Z axis runs UP the page
 * from it, which is the one thing every map in this game agrees on — the
 * layout diagram, the deploy screen, the minimap's prerendered backdrop (which
 * is turned afterwards, not drawn turned) and the editor.
 */
export interface PlanView {
  /** Canvas pixels per world metre. */
  scale: number;
  /** Canvas x of world x = 0. */
  ox: number;
  /** Canvas y of world z = 0. */
  oy: number;
}

/** The survey grid: off, lines only, or lines with their letters and numbers. */
export type GridMode = "none" | "lines" | "labelled";

export interface PaintOptions {
  /**
   * The rectangle the paper fills and everything is clipped to, in canvas
   * pixels. Every caller has one and none of them is the whole canvas: the
   * minimap's base IS the play square, the deploy map is letterboxed inside a
   * wider box, and the menu's panel is a different shape again.
   */
  bounds: { x: number; y: number; w: number; h: number };
  grid?: GridMode;
  /**
   * Draw the paper under everything. The minimap's plate is translucent and is
   * composited by the CALLER at its own alpha, so it wants the paper; a screen
   * that has already laid its own ground can turn it off.
   */
  paper?: boolean;
}

/**
 * Paints a plan. The layer order below is the drawing, and it is fixed:
 * ground, then what is cut into it, then what is laid on it, then what stands
 * on it, then the survey marks over the lot.
 */
export function paintPlan(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  opts: PaintOptions,
): void {
  const t = theme(plan.env);
  const b = opts.bounds;
  c.save();
  c.beginPath();
  c.rect(b.x, b.y, b.w, b.h);
  c.clip();
  if (opts.paper !== false) {
    c.fillStyle = t.paper;
    c.fillRect(b.x, b.y, b.w, b.h);
  }
  drawRelief(c, plan, view, t);
  drawContours(c, plan, view, t);
  drawWater(c, plan, view, t);
  drawScatter(c, plan, view);
  drawRoads(c, plan, view, t);
  drawFences(c, plan, view, t);
  drawMasses(c, plan, view, b);
  drawGrid(c, plan, view, t, opts.grid ?? "none");
  drawEdge(c, plan, view, t);
  c.restore();
}

// ---------------------------------------------------------------------------
// the palette
// ---------------------------------------------------------------------------

/**
 * Every colour on a map, derived from the map's own environment.
 *
 * Only two of them carry the map's HUE — the paper and the relief, which are
 * the ground — and the water carries the sky's. Everything built is neutral on
 * purpose: a town drawn in its own sand or its own basalt is a town that
 * changes value with the map and stops reading the same way, and the whole
 * point of one painter is that Hollowmere and Sarab are the same drawing of
 * two different places.
 */
interface PlanTheme {
  paper: string;
  /** The relief's hue, normalised to full value — see `hue`. */
  ground: [number, number, number];
  sky: [number, number, number];
  foam: [number, number, number];
  contour: string;
  contourIndex: string;
  road: string;
  roadCasing: string;
  fence: string;
  grid: string;
  gridIndex: string;
  label: string;
  edge: string;
}

function theme(env: EnvironmentSpec): PlanTheme {
  const ground = mute(hue(env.floorColor), GROUND_MUTE);
  return {
    paper: `rgb(${(ground[0] * 0.045) | 0}, ${(ground[1] * 0.05) | 0}, ${(ground[2] * 0.065) | 0})`,
    ground,
    sky: hue(env.skyColor),
    foam: env.water ? rgb(env.water.foamColor) : [210, 226, 236],
    contour: "rgba(214, 232, 255, 0.05)",
    contourIndex: "rgba(214, 232, 255, 0.105)",
    road: "rgba(222, 230, 242, 0.145)",
    roadCasing: "rgba(3, 5, 9, 0.34)",
    fence: "rgba(176, 194, 218, 0.30)",
    grid: "rgba(255, 255, 255, 0.05)",
    gridIndex: "rgba(255, 255, 255, 0.10)",
    label: "rgba(226, 238, 255, 0.30)",
    edge: "rgba(255, 255, 255, 0.17)",
  };
}

/** `#rrggbb` to its three channels. Every colour in an EnvironmentSpec is one. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * How far the ground's hue is pulled toward NEUTRAL before anything is
 * multiplied by it.
 *
 * A normalised map colour is a fully SATURATED one — Harrowmead's summer green
 * and Sarab's sand come back as the purest green and orange the drawing owns,
 * and at the values this plan is painted at that reads as a coloured
 * transparency rather than as paper. Worse, it makes the ground the loudest
 * hue on the sheet, which is this file's one rule broken: on Hollowmere every
 * gap between two buildings read as a warm tan lane somebody had drawn.
 *
 * Toward the channels' own MEAN and not toward white, which is the half of
 * this that had to be got right twice. Pulled to white a dark colour keeps its
 * saturation and merely lightens, so the ground came back paler and exactly as
 * yellow; pulled to its mean it desaturates and the value is left to `k` in
 * the relief, which is where the decision about how dark this drawing is
 * belongs. Just over half leaves enough hue to say which place this is.
 */
const GROUND_MUTE = 0.58;

/** A colour pulled toward its own grey by `k` — saturation down, value kept. */
function mute(
  [r, g, b]: [number, number, number],
  k: number,
): [number, number, number] {
  const grey = (r + g + b) / 3;
  return [r + (grey - r) * k, g + (grey - g) * k, b + (grey - b) * k];
}

/**
 * A map colour with its BRIGHTNESS taken off it, keeping the hue.
 *
 * The palettes these are read from are lit for the map they belong to:
 * Hollowmere's floor is a colour meant to be seen under moonlight and is
 * near-black on its own, Coldharbour's is a colour meant to be seen at dusk.
 * Multiplying those directly gives one plan with no relief in it and another
 * that glares — the drawing would be reporting the map's EXPOSURE rather than
 * its shape. Scaling each so its strongest channel is full is what makes the
 * ramps mean the same thing on every map: the hue is still the map's, and how
 * dark the drawing is, is this file's decision.
 */
function hue(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex);
  const peak = Math.max(r, g, b, 1);
  return [(r / peak) * 255, (g / peak) * 255, (b / peak) * 255];
}

// ---------------------------------------------------------------------------
// the ground
// ---------------------------------------------------------------------------

/**
 * The floor, as a hillshade at the HEIGHTFIELD's own resolution and blitted
 * up.
 *
 * It used to be one `fillRect` per cell, which is right on an 80 x 80 field
 * and is 62,500 of them on Cinderhaven's 250 — for a picture that at the
 * menu's size is 220 px across. A raster the size of the field carries every
 * bit of information the field has and no more, so upscaling it through the
 * canvas's own filter is not an approximation of the per-cell drawing: it is
 * the same data with the staircase taken off, and it costs the same on the
 * biggest map in the tree as on the smallest.
 *
 * Two terms, as every relief map since the nineteenth century: HEIGHT, which
 * separates high ground from low, and SLOPE against a light in the upper left,
 * which is what makes a bank read as a bank rather than as a gradient. A map
 * lit from below reads inside out.
 */
function drawRelief(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  const field = plan.terrain.field;
  if (!field) return;
  const { size: n, cell, heights } = field;
  const half = (n * cell) / 2;
  let sum = 0;
  for (const v of heights) sum += v;
  const datum = sum / heights.length;
  const at = (a: number, b: number) =>
    heights[Math.min(b, n) * (n + 1) + Math.min(a, n)] ?? 0;

  const img = new ImageData(n, n);
  const out = img.data;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const y = at(i, j);
      // Against the map's OWN MEAN over a fixed span, softly, rather than
      // normalised between its lowest point and its highest. Min-to-max is
      // what a relief map does when every map is a landscape, and half of
      // these are not: Hollowmere is a flat valley floor with three dug pits
      // in it, so the pits took the whole of the ramp and the village came out
      // as one mid-grey plain with three black holes in it. A tanh over
      // `RELIEF_SPAN` metres says the same thing about a bank on every map —
      // Cinderhaven's cone saturates, Hollowmere's creek bed barely moves —
      // and it cannot be blown out by one outlier.
      const rise = Math.tanh((y - datum) / RELIEF_SPAN);
      // The gradient in metres per metre, so the shading says the same thing
      // on a 3 m cell and a 6 m one. Clamped tight: this is texture under a
      // plan, not a terrain render.
      const dx = (at(i + 1, j) - y) / cell;
      const dz = (at(i, j + 1) - y) / cell;
      const shade = Math.max(-0.06, Math.min(0.06, (dx + dz) * -1));
      // FLOORED, and the floor is not a safety net: an escarpment's shade and
      // a low datum both subtract, and on Hollowmere the two together took the
      // bank above the bog to within a few points of black — a hole in the map
      // where a hillside is. Shading may say "this faces away"; it may not say
      // "there is nothing here".
      // FLOORED, and the floor is not a safety net: a slope facing away and
      // ground below the datum both subtract, and together they took the bank
      // above Hollowmere's bog to within a few points of black — a hole in the
      // map where a hillside is. Shading may say "this faces away"; it may not
      // say "there is nothing here".
      const k = Math.max(0.1, 0.185 + rise * 0.075 + shade);
      const o = (j * n + i) * 4;
      out[o] = t.ground[0] * k;
      out[o + 1] = t.ground[1] * k;
      out[o + 2] = t.ground[2] * k;
      out[o + 3] = 255;
    }
  }
  const tile = document.createElement("canvas");
  tile.width = n;
  tile.height = n;
  tile.getContext("2d")?.putImageData(img, 0, 0);
  c.save();
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  // Half a cell out on every side: a raster pixel is a CELL, and the samples
  // are the cells' own corners, so the image covers the field's extent and not
  // the lattice through its middles.
  const x0 = px(view, -half);
  const y0 = py(view, half);
  c.drawImage(tile, x0, y0, half * 2 * view.scale, half * 2 * view.scale);
  c.restore();
}

/**
 * How many metres of rise the relief's value ramp is spent over, either side
 * of a map's own mean height. Past it the shading saturates rather than
 * rescaling, which is the whole point — see `drawRelief`.
 */
const RELIEF_SPAN = 18;

/**
 * Contour lines, by marching squares over the heightfield.
 *
 * **The INTERVAL is chosen from what the drawing can hold, not from the
 * ground.** A fixed 2 m interval is a clean topographic map of Hollowmere's
 * creek and a solid wash over Cinderhaven's cone; what is constant across the
 * six maps is not a height but how far apart two lines may be on the GLASS
 * before they stop being lines. So the mean gradient decides it: the interval
 * is whatever puts the average pair about `MIN_CONTOUR_GAP` pixels apart,
 * rounded up to a figure a reader would recognise, and every fifth one is
 * drawn as an index line so the set can be counted.
 *
 * Nothing is drawn where the answer is coarser than the relief itself has —
 * a map whose whole span is one interval has no contours, which is the right
 * drawing of a flat field.
 */
function drawContours(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  const field = plan.terrain.field;
  if (!field) return;
  const { size: n, cell, heights } = field;
  const half = (n * cell) / 2;
  let lo = Infinity;
  let hi = -Infinity;
  let grad = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = heights[j * (n + 1) + i] ?? 0;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (i < n && j < n) {
        grad +=
          Math.abs((heights[j * (n + 1) + i + 1] ?? 0) - v) +
          Math.abs((heights[(j + 1) * (n + 1) + i] ?? 0) - v);
      }
    }
  }
  // Mean rise per metre of ground, over both axes.
  const mean = grad / (2 * n * n * cell);
  if (mean <= 1e-4) return;
  const step = nice((MIN_CONTOUR_GAP * mean) / view.scale);
  if (hi - lo < step) return;

  // **One pass over the CELLS, not one pass per level.** A level sweep visits
  // every cell once per contour, which on Cinderhaven's 250 x 250 field at a
  // dozen levels is 750,000 cell tests to draw a few thousand segments — and
  // all but a handful of those tests are of a cell no line crosses. Walking
  // the cells once and asking each which levels fall between its own lowest
  // and highest corner does the same drawing in the work the drawing is
  // actually worth. The two weights go into two paths and are stroked once
  // each at the end, which is what the level sweep was buying and is all it
  // was buying.
  const minor = new Path2D();
  const index = new Path2D();
  for (let j = 0; j < n; j++) {
    const z0 = -half + j * cell;
    for (let i = 0; i < n; i++) {
      const h00 = heights[j * (n + 1) + i] ?? 0;
      const h10 = heights[j * (n + 1) + i + 1] ?? 0;
      const h11 = heights[(j + 1) * (n + 1) + i + 1] ?? 0;
      const h01 = heights[(j + 1) * (n + 1) + i] ?? 0;
      const cmin = Math.min(h00, h10, h11, h01);
      const cmax = Math.max(h00, h10, h11, h01);
      const k0 = Math.ceil(cmin / step);
      const k1 = Math.floor(cmax / step);
      if (k1 < k0) continue;
      const x0 = -half + i * cell;
      for (let k = k0; k <= k1; k++) {
        // Index lines every fifth level ABOVE THE DATUM rather than every
        // fifth line drawn, so a map whose ground starts at 3 m and one whose
        // ground starts at 40 emphasise the same heights and the spacing does
        // not shift when the lowest line is or is not in shot.
        march(
          k % 5 === 0 ? index : minor,
          view,
          k * step,
          x0,
          z0,
          cell,
          h00,
          h10,
          h11,
          h01,
        );
      }
    }
  }
  c.save();
  c.lineWidth = 1;
  c.lineJoin = "round";
  c.strokeStyle = t.contour;
  c.stroke(minor);
  c.strokeStyle = t.contourIndex;
  c.stroke(index);
  c.restore();
}

/** How close two contour lines may come on the glass before the set thickens. */
const MIN_CONTOUR_GAP = 9;

/**
 * One cell of marching squares, appending its segments to a path.
 *
 * The corners are the cell's four heights anticlockwise from its low corner in
 * world terms — `(i, j)`, `(i+1, j)`, `(i+1, j+1)`, `(i, j+1)` — and the
 * crossings are linearly interpolated along each edge, which is the whole of
 * the accuracy a linearly-interpolated heightfield supports anyway. Saddles
 * (the two ambiguous cases) are resolved by the cell's mean, the standard
 * choice: it keeps a ridge joined and a col open rather than the other way
 * about, and at these intervals the difference is one pixel.
 *
 * **Nothing in here allocates.** It is called for every cell of every level a
 * cell spans — a few hundred thousand times on the biggest map — and the
 * version that read as arithmetic, with a closure per edge and a tuple per
 * crossing, was five allocations a call and most of this layer's cost.
 */
function march(
  path: Path2D,
  view: PlanView,
  level: number,
  x0: number,
  z0: number,
  cell: number,
  h00: number,
  h10: number,
  h11: number,
  h01: number,
): void {
  const code =
    (h00 >= level ? 1 : 0) |
    (h10 >= level ? 2 : 0) |
    (h11 >= level ? 4 : 0) |
    (h01 >= level ? 8 : 0);
  if (code === 0 || code === 15) return;
  // The four edge crossings, as canvas coordinates. Each is only meaningful
  // for the cases that name it, and computing all four unconditionally is
  // cheaper than branching to pick two.
  const bx = px(view, x0 + cell * lerp(h00, h10, level));
  const by = py(view, z0);
  const rx = px(view, x0 + cell);
  const ry = py(view, z0 + cell * lerp(h10, h11, level));
  const tx = px(view, x0 + cell * lerp(h01, h11, level));
  const ty = py(view, z0 + cell);
  const lx = px(view, x0);
  const ly = py(view, z0 + cell * lerp(h00, h01, level));
  switch (code) {
    case 1:
    case 14:
      seg(path, lx, ly, bx, by);
      break;
    case 2:
    case 13:
      seg(path, bx, by, rx, ry);
      break;
    case 3:
    case 12:
      seg(path, lx, ly, rx, ry);
      break;
    case 4:
    case 11:
      seg(path, rx, ry, tx, ty);
      break;
    case 6:
    case 9:
      seg(path, bx, by, tx, ty);
      break;
    case 7:
    case 8:
      seg(path, lx, ly, tx, ty);
      break;
    case 5:
    case 10: {
      const mid = (h00 + h10 + h11 + h01) / 4 >= level;
      if (code === 5 ? mid : !mid) {
        seg(path, lx, ly, bx, by);
        seg(path, rx, ry, tx, ty);
      } else {
        seg(path, lx, ly, tx, ty);
        seg(path, bx, by, rx, ry);
      }
      break;
    }
  }
}

function seg(
  path: Path2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): void {
  path.moveTo(ax, ay);
  path.lineTo(bx, by);
}

/** Where `level` crosses between two corner heights, as a 0..1 along the edge. */
function lerp(a: number, b: number, level: number): number {
  const d = b - a;
  return Math.abs(d) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (level - a) / d));
}

/** 1, 2, 5, 10, 20, 50… — the intervals a reader counts in. */
function nice(v: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-6))));
  const k = v / mag;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * mag;
}

/**
 * The pools, the creek and the sea, clipped to where the ground is actually
 * UNDER them.
 *
 * **A `WaterRect` is an EXTENT, not a shape.** The real surface is one flat
 * plane per rect and the world is opaque, so what a player sees is the part of
 * that plane the floor does not stand in front of: dig a basin and the pool is
 * the basin, and every metre of the rect above the waterline is dry bank. Two
 * of the maps state that plainly — Greyfen's flood is a single 250 m rect over
 * the whole valley and Harrowmead's leat is 404 m by 100 — so a plan that
 * filled the rects would draw those two as open water end to end. That is not
 * a simplification of the place; it is a different place.
 *
 * So the waterline is derived here exactly as it is in the world: the depth
 * under every sample, against the same `waterY` the WaterSystem's plane sits
 * at and the same `surfaceAt` its bed map is baked from. ONE mask over the
 * union of the rects rather than one per rect — pools are free to overlap, and
 * a union takes the deeper of two where they do rather than laying one wash
 * over another — carrying the DEPTH rather than a yes, which is what grades a
 * shore into a channel and what the alpha feathers the waterline over.
 */
function drawWater(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  const rects = plan.water;
  if (rects.length === 0 || !plan.hasFloor) return;
  const terrain = plan.terrain;
  const half = plan.size / 2 + plan.margin;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x - r.width / 2);
    x1 = Math.max(x1, r.x + r.width / 2);
    z0 = Math.min(z0, r.z - r.depth / 2);
    z1 = Math.max(z1, r.z + r.depth / 2);
  }
  x0 = Math.max(x0, -half);
  x1 = Math.min(x1, half);
  z0 = Math.max(z0, -half);
  z1 = Math.min(z1, half);
  if (x1 <= x0 || z1 <= z0) return;

  // The mask's resolution is the DRAWING's rather than the world's, because
  // what it is up against is a pixel and not a metre: the bank of a dug
  // channel goes from dry to ankle-deep inside one canvas pixel, so a mask
  // baked at canvas resolution has nothing left to feather the waterline with
  // and draws it as a staircase. Two samples a pixel is enough to hand the
  // filter an edge; the budget is what keeps a large plan from paying
  // megasamples for it, and past it the mask is simply upscaled, which is soft
  // rather than wrong.
  const dw = (x1 - x0) * view.scale;
  const dh = (z1 - z0) * view.scale;
  const ss = Math.min(2, Math.sqrt(SAMPLE_BUDGET / Math.max(1, dw * dh)));
  const nx = Math.max(2, Math.round(dw * ss));
  const nz = Math.max(2, Math.round(dh * ss));
  const stepX = (x1 - x0) / nx;
  const stepZ = (z1 - z0) / nz;

  const depth = new Float32Array(nx * nz);
  for (const r of rects) {
    const surfaceY = waterY(r, terrain);
    const rx0 = r.x - r.width / 2;
    const rx1 = r.x + r.width / 2;
    const rz0 = r.z - r.depth / 2;
    const rz1 = r.z + r.depth / 2;
    const i0 = Math.max(0, Math.floor((rx0 - x0) / stepX));
    const i1 = Math.min(nx - 1, Math.ceil((rx1 - x0) / stepX));
    const j0 = Math.max(0, Math.floor((rz0 - z0) / stepZ));
    const j1 = Math.min(nz - 1, Math.ceil((rz1 - z0) / stepZ));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * stepZ;
      if (z < rz0 || z > rz1) continue;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * stepX;
        if (x < rx0 || x > rx1) continue;
        const d = surfaceY - terrain.surfaceAt(x, z);
        const k = j * nx + i;
        if (d > depth[k]) depth[k] = d;
      }
    }
  }

  const mask = document.createElement("canvas");
  mask.width = nx;
  mask.height = nz;
  const mctx = mask.getContext("2d");
  if (!mctx) return;
  const img = mctx.createImageData(nx, nz);
  const out = img.data;

  // The body is the sky's hue at a fraction of its strength, over a slate
  // floor — straight multiples of the normalised colour give a night sky's
  // pure blue, which against the relief is the most saturated thing on the
  // plan, and the pools are the one part of it nobody needs to find first. The
  // shore lifts off it toward the map's own FOAM, which is the one colour in a
  // `WaterEnvSpec` that is not a statement about what the surface is
  // reflecting: it is white water at the bank, and it is what makes a margin
  // read as a margin rather than as the fill running out.
  // The constants are a FLOOR and the sky is what is added to it: half these
  // maps are lit by a moon, and a body that is purely a fraction of the sky
  // comes out black at night — which is a hole in the plan rather than deep
  // water. Water has to read as water on a night village and on a noon desert
  // alike, and what varies between them is the hue and not whether there is
  // any.
  const deep = [24 + t.sky[0] * 0.08, 36 + t.sky[1] * 0.1, 58 + t.sky[2] * 0.14];
  const shore = deep.map((ch, i) => ch + (t.foam[i] - ch) * 0.45);

  for (let k = 0; k < depth.length; k++) {
    const d = depth[k];
    if (d <= 0) continue;
    // Beer-Lambert, as in the shader and for the shader's reason: a fade that
    // clamps draws the bed's own contour line across the water, and a flood
    // meadow is nothing but scattered pockets either side of one.
    const body = 1 - Math.exp(-d / CONFIG.water.depthFade);
    const o = k * 4;
    out[o] = shore[0] + (deep[0] - shore[0]) * body;
    out[o + 1] = shore[1] + (deep[1] - shore[1]) * body;
    out[o + 2] = shore[2] + (deep[2] - shore[2]) * body;
    // Faded out over the same few centimetres the real surface stops showing
    // its bed through, so the waterline arrives rather than being cut.
    out[o + 3] = Math.min(1, d / CONFIG.water.bedDepth) * 242;
  }
  mctx.putImageData(img, 0, 0);
  c.save();
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
  c.drawImage(
    mask,
    px(view, x0),
    py(view, z1),
    (x1 - x0) * view.scale,
    (z1 - z0) * view.scale,
  );
  c.restore();
}

/** How many floor samples the waterline may cost, whatever size it is drawn at. */
const SAMPLE_BUDGET = 250_000;

/**
 * Which props read as vegetation. Scatter regions are drawn as soft masses
 * rather than as individual props — Greyfen's canopy is ~1,390 trees and a dot
 * each is a noise field — so what a region needs is one colour, and the only
 * distinction that matters at this size is whether the mass is green or grey.
 */
const FOLIAGE = new Set([
  "pine",
  "ashTree",
  "jungleTree",
  "fernClump",
  "buttressLog",
  "bramble",
  "log",
  "fungus",
  "deadTree",
  "palm",
]);

/**
 * The dressing, as masses — and ONLY on a plan with no collider bake behind
 * it, which is the menu's first pass. See `MapPlan.scatter`.
 *
 * Opacity follows DENSITY — the count over the region's area — so a belt of
 * forty trees down a road reads lighter than the block of four hundred that is
 * Greyfen's canopy. Composited NORMALLY: Greyfen's regions are authored to
 * overlap and there are a great many of them, so an additive blend accumulates
 * without bound and the whole square comes out one flat wash with the relief
 * buried under it. Blending toward the colour saturates instead — the canopy
 * reaches canopy green and stops, which is what a canopy does.
 */
function drawScatter(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
): void {
  if (plan.scatter.length === 0) return;
  c.save();
  for (const s of plan.scatter) {
    const area = isScatterRect(s)
      ? s.width * s.depth
      : Math.PI * s.radius * s.radius;
    const density = Math.min(1, s.count / Math.max(1, area * 0.09));
    // Kept low because these BLEND: a map whose regions blanket it (Hollowmere
    // is ~20 overlapping ones) converges on whatever colour is painted here,
    // however dark the relief underneath was. The ceiling is what a dozen
    // layers reach, not what one is worth.
    const a = 0.03 + density * 0.095;
    c.fillStyle = FOLIAGE.has(s.prop)
      ? `rgba(58, 96, 52, ${a})`
      : `rgba(92, 96, 104, ${a * 0.7})`;
    if (isScatterRect(s)) {
      c.save();
      c.translate(px(view, s.x), py(view, s.z));
      c.rotate(-(s.rotY ?? 0));
      c.fillRect(
        (-s.width / 2) * view.scale,
        (-s.depth / 2) * view.scale,
        s.width * view.scale,
        s.depth * view.scale,
      );
      c.restore();
    } else {
      c.beginPath();
      c.arc(px(view, s.x), py(view, s.z), s.radius * view.scale, 0, TAU);
      c.fill();
    }
  }
  c.restore();
}

/**
 * The carriageways: a casing under a lighter body, both over the whole network
 * at once.
 *
 * **One path for every piece and two passes over it, rather than a stroke per
 * piece.** A path road is cut into dozens of convex slices and a junction into
 * several more, so outlining each one draws the seams BETWEEN them — a lattice
 * of hairlines down the middle of every street. Stroking the combined path
 * once puts the casing on the internal seams too, and then the body fill over
 * it covers exactly those and leaves the outer edge alone. The grown stroke is
 * what gives a road an edge at all: a flat fill against relief at this value
 * has no line on it, and a road with no line is a stain.
 */
function drawRoads(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  if (plan.roads.length === 0) return;
  c.save();
  c.beginPath();
  for (const poly of plan.roads) path(c, view, poly);
  c.lineJoin = "round";
  // The casing is a RING and not a bed: stroked, the grown outline shows only
  // where it sticks out past the carriageway, and the body fill covers the
  // half of it that lies inside. Filling the casing colour as well — which is
  // what this did first — laid the whole street in near-black and then lifted
  // it 17%, so a road came out DARKER than the field it crossed.
  c.lineWidth = 2 * Math.max(0.6, Math.min(1.1, view.scale * 0.7));
  c.strokeStyle = t.roadCasing;
  c.stroke();
  c.fillStyle = t.road;
  c.fill();
  c.restore();
}

function path(
  c: CanvasRenderingContext2D,
  view: PlanView,
  poly: PlanPoly,
): void {
  c.moveTo(px(view, poly.xs[0]), py(view, poly.zs[0]));
  for (let i = 1; i < poly.xs.length; i++) {
    c.lineTo(px(view, poly.xs[i]), py(view, poly.zs[i]));
  }
  c.closePath();
}

/**
 * The fences, hedges and railings: a LINE along the run, which is both what
 * one looks like from above and what it means — a thing you cannot cross and
 * can see over.
 *
 * Gated on magnification rather than drawn faintly, because a fence far out is
 * not a fainter fence: Hollowmere's yards carry a hundred short runs, and at
 * the menu's scale they are a stipple over the village that reads as texture
 * nobody put there. Below the gate the drawing simply says nothing about
 * fences, which is honest — the masses are what a plan at that size is for.
 */
function drawFences(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  if (view.scale < FENCE_SCALE || plan.fences.length === 0) return;
  c.save();
  c.strokeStyle = t.fence;
  c.lineWidth = 1;
  c.lineCap = "butt";
  c.beginPath();
  for (const f of plan.fences) {
    // The run's long axis in the box's own frame, taken out to world.
    const along = f.w >= f.d ? f.w / 2 : f.d / 2;
    const [lx, lz] = f.w >= f.d ? [along, 0] : [0, along];
    const cos = Math.cos(f.rot);
    const sin = Math.sin(f.rot);
    const dx = lx * cos + lz * sin;
    const dz = -lx * sin + lz * cos;
    c.moveTo(px(view, f.cx - dx), py(view, f.cz - dz));
    c.lineTo(px(view, f.cx + dx), py(view, f.cz + dz));
  }
  c.stroke();
  c.restore();
}

/** Below this many pixels per metre a fence is a stipple and is left out. */
const FENCE_SCALE = 0.75;

/**
 * The built mass: every structure on the map, closed into silhouettes, laddered
 * by how far it rises, with its own wall lines drawn back over it and one drop
 * shadow under the lot.
 *
 * **A building here is not a box — it is eight or ten WALLS**, and that one
 * fact is what every version of this layer has had to answer. Drawn honestly,
 * a 0.25 m wall is a quarter of a pixel at the menu's scale and an eighth at
 * Cinderhaven's deploy scale, so the town vanishes; drawn thickened, the same
 * walls become a field of disconnected four-pixel dashes, which is what the
 * village read as — confetti, not a plan. Neither drawing is wrong about the
 * geometry and both are wrong about the PLACE.
 *
 * So the masses are CLOSED before they are drawn: every rectangle is grown by
 * `CLOSE_M` metres a side into an offscreen sheet, which welds a building's
 * own walls into one shape and leaves the street between two buildings open,
 * because a room is metres across and a street is more. Then the true
 * rectangles are drawn back over that silhouette a shade brighter, so the wall
 * lines are still there to read at a magnification that can hold them and
 * simply disappear into the mass at one that cannot. One sheet, composited
 * once at one alpha, is also what keeps the drawing honest where shapes
 * overlap: painted straight onto the plan, two translucent walls crossing
 * would be brighter than either, and a dense quarter would glow.
 *
 * **The bands are the HEIGHT and they are drawn low to high**, so a warehouse
 * stands over the yard wall beside it and a three-storey block on Coldharbour
 * over its own forecourt. That ladder is the one cue a flat plan has for
 * massing, and its absence is what made the old deploy map a single grey.
 *
 * The shadow is the SHEET's, thrown by the canvas off the finished silhouette
 * in one call rather than accumulated box by box — a per-box shadow falls on
 * the next box along and turns the inside of every building dark.
 */
function drawMasses(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  b: PaintOptions["bounds"],
): void {
  if (plan.masses.length === 0) return;
  const sheet = document.createElement("canvas");
  sheet.width = Math.max(1, Math.ceil(b.w));
  sheet.height = Math.max(1, Math.ceil(b.h));
  const s = sheet.getContext("2d");
  if (!s) return;
  s.translate(-b.x, -b.y);

  // How much a rectangle is grown by, in canvas pixels: `CLOSE_M` metres, with
  // a floor so that a plan drawn small enough still welds at all. And the
  // thinnest a wall may be drawn once it is grown, which is what stops a long
  // run from being dropped by the rasteriser entirely.
  const close = Math.max(CLOSE_FLOOR, CLOSE_M * view.scale);
  const thin = Math.max(1, view.scale * 0.35);

  // Bands by rise, in metres: a wall or a low outbuilding, a single storey, a
  // two-storey block, and everything taller.
  const bands: PlanMass[][] = [[], [], [], []];
  for (const m of plan.masses) {
    bands[m.rise < 2.6 ? 0 : m.rise < 5 ? 1 : m.rise < 9 ? 2 : 3].push(m);
  }
  for (let k = 0; k < bands.length; k++) {
    if (bands[k].length === 0) continue;
    s.fillStyle = MASS_BODY[k];
    blob(s, view, bands[k], close, close * 2 + thin);
    s.fillStyle = MASS_WALL[k];
    blob(s, view, bands[k], 0, thin);
  }

  c.save();
  c.globalAlpha = MASS_ALPHA;
  c.shadowColor = MASS_SHADOW;
  c.shadowBlur = Math.min(3, view.scale * 1.6);
  c.shadowOffsetX = MASS_DROP * Math.max(0.7, Math.min(2, view.scale));
  c.shadowOffsetY = c.shadowOffsetX;
  c.drawImage(sheet, b.x, b.y);
  c.restore();
}

/** One pass over a band, every rectangle grown by `grow` pixels a side. */
function blob(
  c: CanvasRenderingContext2D,
  view: PlanView,
  band: readonly PlanMass[],
  grow: number,
  thin: number,
): void {
  for (const b of band) {
    const w = Math.max(b.w * view.scale + grow * 2, thin);
    const d = Math.max(b.d * view.scale + grow * 2, thin);
    c.save();
    c.translate(px(view, b.cx), py(view, b.cz));
    // The `rotateY` convention every structure is placed with. A centred
    // rectangle is symmetric about both local axes, so the canvas frame's own
    // Z flip costs nothing here — see `mapPlan.ts`'s road corners for the
    // case where it does.
    c.rotate(-b.rot);
    c.fillRect(-w / 2, -d / 2, w, d);
    c.restore();
  }
}

/**
 * How far a wall is grown, in METRES, to weld a building shut.
 *
 * A metre and a half a side closes anything under three metres, which is a
 * room, a stair and a passage, and leaves anything over it open, which is a
 * yard, a lane and a street. Stated in the world rather than in pixels
 * precisely so that the same buildings close at every magnification: a plan
 * that welded by pixels would show Hollowmere's rooms on the minimap and weld
 * its whole terrace on the menu.
 */
const CLOSE_M = 1.5;
/** …with a floor, for a plan drawn so small that 1.5 m is nothing. */
const CLOSE_FLOOR = 1.1;
const MASS_ALPHA = 0.8;
const MASS_SHADOW = "rgba(0, 0, 0, 0.62)";
const MASS_DROP = 1.4;
/**
 * The value ladder, low band to high — the silhouette, and then the true walls
 * a shade over it. Opaque: the sheet is composited once at `MASS_ALPHA`, so
 * these are what the mass IS and not what it is worth against the ground.
 */
const MASS_BODY = ["#454f5d", "#5e6b7d", "#717f93", "#8492a8"];
const MASS_WALL = ["#6d7a8b", "#8b99ad", "#a3b2c6", "#bccbdf"];

/**
 * The survey grid: a lattice on a round number of metres, with its letters
 * down one edge and its numbers along the other when there is room.
 *
 * **The cell is a distance and the count follows**, which is the opposite of
 * the eight equal divisions this replaced. Eight divisions of Hollowmere is 30
 * m and eight of Cinderhaven is 187, so the same drawing said two different
 * things and neither of them was a distance — a grid a player can count in has
 * to be the same square on every map, or the six maps cannot be compared at
 * all. So the cell is a round number near a tenth of the extent, and
 * Cinderhaven simply has more of them than Hollowmere does, which is the
 * truth about the two maps.
 */
function drawGrid(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
  mode: GridMode,
): void {
  if (mode === "none") return;
  const half = plan.size / 2;
  const cell = nice(plan.size / 9);
  const n = Math.ceil(plan.size / cell);
  const side = cell * view.scale;
  c.save();
  c.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    const w = -half + i * cell;
    if (w > half + 0.01) break;
    // Every fifth line, counted from the map's own edge.
    c.strokeStyle = i % 5 === 0 ? t.gridIndex : t.grid;
    c.beginPath();
    const at = Math.round(px(view, w)) + 0.5;
    c.moveTo(at, py(view, half));
    c.lineTo(at, py(view, -half));
    const down = Math.round(py(view, w)) + 0.5;
    c.moveTo(px(view, -half), down);
    c.lineTo(px(view, half), down);
    c.stroke();
  }
  // Letters across and numbers down, in the cells' own corners. Only where a
  // cell is wide enough to hold one without it touching the next.
  if (mode === "labelled" && side >= 34) {
    c.fillStyle = t.label;
    c.font = `600 ${Math.min(11, side * 0.24).toFixed(1)}px ${FACE}`;
    c.textBaseline = "top";
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * cell;
      if (x > half) break;
      c.textAlign = "center";
      c.fillText(LETTERS[i] ?? "", px(view, x), py(view, half) + 3);
      const z = half - (i + 0.5) * cell;
      if (z < -half) continue;
      c.textAlign = "left";
      c.fillText(String(i + 1), px(view, -half) + 3, py(view, z) - 5);
    }
  }
  c.restore();
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

/**
 * The play square's own edge — the boundary the leash measures on a map with a
 * borderland, and the line everything countable about a map is stated inside.
 */
function drawEdge(
  c: CanvasRenderingContext2D,
  plan: MapPlan,
  view: PlanView,
  t: PlanTheme,
): void {
  const half = plan.size / 2;
  c.save();
  c.strokeStyle = t.edge;
  c.lineWidth = 1;
  c.strokeRect(
    Math.round(px(view, -half)) + 0.5,
    Math.round(py(view, half)) + 0.5,
    Math.round(plan.size * view.scale) - 1,
    Math.round(plan.size * view.scale) - 1,
  );
  c.restore();
}

// ---------------------------------------------------------------------------
// the marks every one of the three maps carries
// ---------------------------------------------------------------------------

/**
 * A control point's ZONE: the capture radius, to scale, as a wash inside a
 * ring.
 *
 * To scale and not to a drawn size, because how far apart the flags are and
 * how big the ground you have to hold is are most of what a Conquest map IS —
 * and because `ControlPointDef.radius` is exactly what `pointAt` tests, so the
 * line is the boundary rather than an illustration of one. The icon that names
 * it is a separate call: the zone is a place on the ground and the hexagon is
 * a label, and only one of them scales with the map.
 */
export function paintZone(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  opts: { contested?: boolean; alpha?: number } = {},
): void {
  const a = opts.alpha ?? 1;
  c.save();
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fillStyle = withAlpha(color, 0.1 * a);
  c.fill();
  c.strokeStyle = withAlpha(color, (opts.contested ? 0.95 : 0.68) * a);
  c.lineWidth = opts.contested ? 1.8 : 1.2;
  c.stroke();
  c.restore();
}

/**
 * A control point's ICON: the same flattened hexagon the HUD's flag strip is
 * built out of (`--hex` in `hud.css`), its letter, and the capture meter as an
 * arc round it.
 *
 * **It is the same mark on all three maps and the same mark as the strip along
 * the top of the HUD**, which is the whole of why it lives here. A player
 * reads B off the flag strip, off the deploy map they picked it on and off the
 * minimap in the corner, and three shapes for one flag is three things to
 * learn. It is sized in PIXELS rather than in metres for the same reason: it
 * is a label, and a label that shrinks with the map stops being one.
 */
export function paintFlagIcon(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  label: string,
  opts: {
    /** -1..1 as `ControlPoint.meter`; drawn as an arc from twelve o'clock. */
    meter?: number;
    meterColor?: string;
    /** Radians the arc's zero is rotated by, for a map that turns. */
    twelve?: number;
    contested?: boolean;
    alpha?: number;
    face?: string;
  } = {},
): void {
  const a = opts.alpha ?? 1;
  c.save();
  c.translate(x, y);
  // The hexagon `hud.css` clips its flag chips to, in canvas coordinates:
  // half-width at 26% and 74% of the height, points at the top and bottom.
  c.beginPath();
  c.moveTo(0, -r);
  c.lineTo(r * 0.86, -r * 0.48);
  c.lineTo(r * 0.86, r * 0.48);
  c.lineTo(0, r);
  c.lineTo(-r * 0.86, r * 0.48);
  c.lineTo(-r * 0.86, -r * 0.48);
  c.closePath();
  c.fillStyle = `rgba(8, 11, 16, ${0.88 * a})`;
  c.fill();
  c.strokeStyle = withAlpha(color, (opts.contested ? 1 : 0.85) * a);
  c.lineWidth = Math.max(1, r * 0.16);
  c.stroke();

  const meter = opts.meter ?? 0;
  if (meter !== 0) {
    // Twelve o'clock is the SCREEN's, and `twelve` is what keeps it there on a
    // map that turns under the player: a dial is read, not steered, and one
    // that started at map north would put "nearly taken" at eight o'clock.
    const from = -Math.PI / 2 + (opts.twelve ?? 0);
    c.beginPath();
    c.arc(0, 0, r * 1.42, from, from + Math.abs(meter) * TAU);
    c.strokeStyle = withAlpha(opts.meterColor ?? color, 0.95 * a);
    c.lineWidth = Math.max(1.4, r * 0.3);
    // Round caps: the dial is the one moving line on the map, and a
    // squared-off end reads as a tick mark rather than as a level.
    c.lineCap = "round";
    c.stroke();
  }

  c.rotate(-(opts.twelve ?? 0));
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `700 ${(r * 1.22).toFixed(1)}px ${opts.face ?? FACE}`;
  c.fillStyle = `rgba(238, 241, 246, ${a})`;
  c.fillText(label, 0, r * 0.06);
  c.restore();
}

/** The HUD's own face, for a canvas that has not been handed the element's. */
const FACE = '"Bahnschrift", "DIN Alternate", "Roboto Condensed", sans-serif';

const TAU = Math.PI * 2;

/** A `#rrggbb` or `rgb()` colour with an alpha channel put on it. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  const nums = color.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return color;
  return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
}

/** World x to canvas x. */
export function px(view: PlanView, x: number): number {
  return view.ox + x * view.scale;
}

/** World z to canvas y — the axis flip, in the one place that owns it. */
export function py(view: PlanView, z: number): number {
  return view.oy - z * view.scale;
}
