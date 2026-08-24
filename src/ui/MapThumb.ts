/**
 * MapThumb.ts — The top-down schematic of a map, drawn from its LAYOUT rather
 * than from a built world.
 * Owns: the canvas painting behind the menu's map row and nothing else. Takes
 * a `MapDef` and a 2D context; holds no state, keeps no cache, and is called
 * again whenever the row changes.
 * Invariants: it reads a map's layout DATA ONLY — the heightfield, the water
 * rects, the scatter regions, the placements' positions, the control points
 * and the spawns. It never touches `GameMap`, `MapBuilder` or the scene. The
 * one thing it does not read straight off the layout is where the water's EDGE
 * is, which is not in the layout at all: it is the heightfield against the
 * pool's own surface, so `drawWater` samples a `TerrainField` for it exactly as
 * the WaterSystem does. That is still layout data — a field over a heightfield
 * builds nothing and knows nothing about a scene.
 *
 * That restriction is the whole reason this file can exist. The deploy screen
 * draws its map out of the finished collider set, which is the honest way to
 * draw a map you are standing in — the two can never disagree — but it needs a
 * BUILT map, and the main menu is the one screen in the game where there is no
 * such thing: on a cold boot nothing has been built yet, and building one to
 * illustrate a row costs the ~0.7 s the building card exists to cover. Every
 * field this reads is a module constant that was in the bundle before the
 * player pressed anything.
 *
 * So it is a SCHEMATIC and is drawn as one — a relief, some water, the blocks
 * of dressing, a scatter of footprints, and the five flags lettered. It is not
 * claiming to be the map, and the one thing it must never do is imply a
 * fidelity it does not have: no building outlines (a placement is a point and
 * a kit name, not a footprint), no roads (they are visual-only and not in the
 * layout as shapes), no rim.
 *
 * **Claiming LESS than the map is the same mistake as claiming more**, and the
 * water is where that showed: a rect is an extent rather than a shape, so the
 * rects drawn as rectangles reported Greyfen and Harrowmead as valleys under
 * open water. See `drawWater` — a body is where the floor is below it, and
 * nowhere else.
 *
 * The palette is the MAP'S OWN, out of its `EnvironmentSpec`. A night village,
 * a jungle morning and a city at dusk get three different-coloured thumbnails
 * for free, and a fourth map is coloured by the environment it ships with
 * rather than by a table here that somebody has to remember to extend.
 */
import { CONFIG } from "../config";
import type { MapDef } from "../world/maps";
import { isScatterRect } from "../world/layout";
import { TerrainField, waterY } from "../world/TerrainField";

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
]);

/**
 * How many floor samples `drawWater`'s waterline may cost, whatever size the
 * panel it is drawn into is.
 *
 * A quarter of a million is a few milliseconds and it is a ceiling rather than
 * a target: it binds only on a panel over about 500 px a side, and what
 * happens past it is that the mask is upscaled a little further, which is a
 * softer shoreline and not a wrong one. Measured on Greyfen, whose flood is
 * the worst case on any shipped map — every one of these samples is inside a
 * rect, over the whole play square: 38 ms for the mask this was first written
 * at, 14 for this one, and the two are indistinguishable at 5x magnification.
 */
const SAMPLE_BUDGET = 250_000;

/** `#rrggbb` to its three channels. Every colour in an EnvironmentSpec is one. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba()` from a hex and an alpha, so the callers below read as colours. */
function tint(hex: string, a: number, mul = 1): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${Math.round(r * mul)}, ${Math.round(g * mul)}, ${Math.round(b * mul)}, ${a})`;
}

/**
 * A map colour with its BRIGHTNESS taken off it, keeping the hue.
 *
 * The palettes these are read from are lit for the map they belong to:
 * Hollowmere's floor is a colour meant to be seen under moonlight and is
 * near-black on its own, Coldharbour's is a colour meant to be seen at dusk.
 * Multiplying those directly gives one thumbnail with no relief in it and
 * another that glares — the schematic would be reporting the map's EXPOSURE
 * rather than its shape. Scaling each so its strongest channel is full is what
 * makes the ramps below mean the same thing on every map: the hue is still
 * the map's, and how dark the drawing is, is this file's decision.
 */
function hue(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex);
  const peak = Math.max(r, g, b, 1);
  return [(r / peak) * 255, (g / peak) * 255, (b / peak) * 255];
}

/**
 * Paints one map into a canvas, filling it edge to edge.
 *
 * The canvas's backing store is sized here from its CSS box and the device
 * pixel ratio: this is a schematic of straight lines and 1 px rules, and a
 * canvas left at its attribute size and stretched by CSS is the one thing on
 * these screens that would come out visibly soft.
 */
export function drawMapThumb(canvas: HTMLCanvasElement, def: MapDef): void {
  const box = canvas.getBoundingClientRect();
  if (box.width < 4 || box.height < 4) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(box.width * dpr);
  const h = Math.round(box.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const layout = def.layout;
  const env = def.environment;
  const size = layout.size ?? CONFIG.map.size;
  // The map is square and the panel it sits in is not, so it is fitted rather
  // than stretched: one scale for both axes, centred on whatever is left.
  const scale = Math.min(w, h) / size;
  const ox = (w - size * scale) / 2;
  const oz = (h - size * scale) / 2;
  /** World metres to canvas pixels. The map is centred on the origin. */
  const px = (x: number) => ox + (x + size / 2) * scale;
  const pz = (z: number) => oz + (z + size / 2) * scale;

  const paper = hue(env.floorColor);
  ctx.fillStyle = `rgb(${(paper[0] * 0.07) | 0}, ${(paper[1] * 0.07) | 0}, ${(paper[2] * 0.07) | 0})`;
  ctx.fillRect(ox, oz, size * scale, size * scale);

  drawRelief(ctx, def, px, pz, scale);
  drawWater(ctx, def, px, pz, size);
  drawScatter(ctx, def, px, pz, scale);
  drawPlacements(ctx, def, px, pz, scale);
  drawGrid(ctx, ox, oz, size * scale);
  drawSpawns(ctx, def, px, pz, scale);
  drawFlags(ctx, def, px, pz, scale);

  // The edge, last, so nothing is drawn over it.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + 0.5, oz + 0.5, size * scale - 1, size * scale - 1);
}

type Proj = (v: number) => number;

/**
 * The floor, shaded by height and by slope.
 *
 * A flat fill says nothing about a map, and the heightfield is 81x81 vertices
 * that are already in the bundle — the terrace the chapel stands on, the
 * sunken lane the creek runs down and the basin under the bog are the shape of
 * the place. Two terms: height, which separates high ground from low, and the
 * WESTWARD slope, which is what makes a bank read as a bank rather than as a
 * gradient. The light comes from the upper left because every relief map since
 * the nineteenth century has lit from there and a map lit from below reads
 * inside out.
 *
 * Cells are drawn one pixel oversized. They are placed at fractional
 * coordinates, and abutting fills at fractional edges leave a seam of
 * background between them that reads as a grid nobody drew.
 */
function drawRelief(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  scale: number,
): void {
  const field = def.layout.terrain;
  if (!field) return;
  const { size: n, cell, heights } = field;
  const half = (n * cell) / 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of heights) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const base = hue(def.environment.floorColor);
  const step = cell * scale + 1;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const at = (a: number, b: number) => heights[b * (n + 1) + a] ?? 0;
      const y = at(i, j);
      const t = (y - lo) / span;
      // Slope along X against slope along Z, which is a hillshade with the
      // light in the upper left. Clamped tight: this is texture, not terrain.
      const dx = at(Math.min(i + 1, n), j) - y;
      const dz = at(i, Math.min(j + 1, n)) - y;
      const shade = Math.max(-0.055, Math.min(0.055, (dx + dz) * -0.24));
      const k = 0.085 + t * 0.15 + shade;
      ctx.fillStyle = `rgb(${Math.round(base[0] * k)}, ${Math.round(base[1] * k)}, ${Math.round(base[2] * k)})`;
      ctx.fillRect(px(-half + i * cell), pz(-half + j * cell), step, step);
    }
  }
}

/**
 * The pools and the creek, clipped to where the ground is actually UNDER them.
 *
 * **A `WaterRect` is an EXTENT, not a shape.** The real surface is one flat
 * plane per rect and the world is opaque, so what a player sees is the part of
 * that plane the floor does not stand in front of: dig a basin and the pool is
 * the basin, and every metre of the rect above the waterline is dry bank the
 * terrain draws. Two of the maps state that plainly — Greyfen's flood is a
 * single 250 m rect over the whole valley and Harrowmead's leat is 404 m by
 * 100 — so a schematic that filled the rects painted those two as open water
 * end to end. That is not a simplification of the place; it is a different
 * place.
 *
 * So the waterline is DERIVED here exactly as it is in the world: the depth
 * under every sample, against the same `waterY` the WaterSystem's plane sits
 * at and the same `surfaceAt` its bed map is baked from, and nothing at all is
 * drawn where that depth is not positive. A map with no `WaterEnvSpec` draws
 * none either, because `WaterSystem.build` returns on the same test — the
 * schematic can then be wrong about a pool only by being wrong about the
 * floor, which is the one thing it is already reading.
 *
 * What that costs is a bake of its own, so it is ONE mask over the union of
 * the rects rather than one per rect: pools are free to overlap, and a union
 * takes the deeper of two where they do rather than laying one wash over
 * another. The mask carries the DEPTH and not a yes — it is what grades the
 * body from a shore to a channel, and it is what the alpha feathers the
 * waterline over — and it is drawn through the canvas's own filter, which is
 * the last edge on this schematic that is not a straight line and the only one
 * that had to be antialiased rather than merely snapped.
 */
function drawWater(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  size: number,
): void {
  const rects = def.layout.water;
  const colors = def.environment.water;
  if (!rects || rects.length === 0 || !colors) return;
  // No margin and no roll: the mask is clipped to the play square below, and
  // the borderland's undulation is zero everywhere inside it — so this field
  // answers what MapBuilder's answers anywhere anything is drawn.
  const terrain = new TerrainField(def.layout.terrain);

  const half = size / 2;
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
  // Clipped to the play square, which is all the relief under it covers and
  // all this canvas holds: a rect is allowed to run out past the ridge, and
  // Greyfen's does, by five metres a side.
  x0 = Math.max(x0, -half);
  x1 = Math.min(x1, half);
  z0 = Math.max(z0, -half);
  z1 = Math.min(z1, half);
  if (x1 <= x0 || z1 <= z0) return;

  // The mask's resolution is the CANVAS's rather than the world's, because
  // what it is up against is a pixel and not a metre: the bank of a dug
  // channel goes from dry to ankle-deep inside one canvas pixel, so a mask
  // baked at canvas resolution has nothing left to feather the waterline with
  // and draws it as a staircase. Two samples a pixel is enough to hand the
  // filter an edge; the budget is what keeps a full-screen panel on a 2x
  // display from paying four megasamples for it, and past it the mask is
  // simply upscaled, which is soft rather than wrong.
  const dw = px(x1) - px(x0);
  const dh = pz(z1) - pz(z0);
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
  // pure blue, which against the relief's khaki is the most saturated thing on
  // the schematic, and the pools are the one part of it nobody needs to find
  // first. The shore lifts off it toward the map's own FOAM, which is the one
  // colour in a `WaterEnvSpec` that is not a statement about what the surface
  // is reflecting: it is white water at the bank, and it is what makes a
  // margin read as a margin rather than as the fill running out.
  const [sr, sg, sb] = hue(def.environment.skyColor);
  const deep = [20 + sr * 0.09, 30 + sg * 0.11, 44 + sb * 0.15];
  const foam = rgb(colors.foamColor);
  const shore = deep.map((c, i) => c + (foam[i] - c) * 0.45);

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
  // The filter IS the shoreline; the mask is a fifth of the canvas across.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mask, px(x0), pz(z0), px(x1) - px(x0), pz(z1) - pz(z0));
}

/**
 * The dressing, as masses.
 *
 * Opacity follows DENSITY — the count over the region's area — so a belt of
 * forty trees down a road reads lighter than the block of four hundred that is
 * Greyfen's canopy, and a map whose character is its scatter says so at a
 * glance.
 *
 * Composited NORMALLY, which is the second thing this was tried as. Greyfen's
 * regions are authored to overlap and there are a great many of them, so an
 * additive blend accumulates without bound: every region contributed and the
 * whole square came out one flat wash a stop brighter than the panel, with the
 * relief and the flag rings buried under it. Blending toward the colour rather
 * than adding to it saturates instead — the canopy reaches canopy green and
 * stops, which is what a canopy does.
 */
function drawScatter(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  scale: number,
): void {
  ctx.save();
  for (const s of def.layout.scatter) {
    const area = isScatterRect(s)
      ? s.width * s.depth
      : Math.PI * s.radius * s.radius;
    const density = Math.min(1, s.count / Math.max(1, area * 0.09));
    // Kept low because these BLEND: a map whose regions blanket it (Hollowmere
    // is ~20 overlapping ones) converges on whatever colour is painted here,
    // however dark the relief underneath was — at 0.2 a side the whole square
    // came out the scatter's own grey and the hillshade was gone under it. The
    // ceiling is what a dozen layers reach, not what one is worth.
    const a = 0.03 + density * 0.095;
    ctx.fillStyle = FOLIAGE.has(s.prop)
      ? `rgba(58, 96, 52, ${a})`
      : `rgba(92, 96, 104, ${a * 0.7})`;
    if (isScatterRect(s)) {
      ctx.save();
      ctx.translate(px(s.x), pz(s.z));
      ctx.rotate(s.rotY ?? 0);
      ctx.fillRect(
        (-s.width / 2) * scale,
        (-s.depth / 2) * scale,
        s.width * scale,
        s.depth * scale,
      );
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(px(s.x), pz(s.z), s.radius * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The built structures, one mark per placement.
 *
 * A square and not a footprint, because a `Placement` is a point, a kit name
 * and a rotation — the shape is the builder's and only exists once the map is
 * built. What the marks are for is the SETTLEMENT pattern: where the village
 * is dense, where the city's blocks run, and how much of the map is empty.
 */
function drawPlacements(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  scale: number,
): void {
  const s = Math.max(2, 3.2 * scale * 0.5);
  ctx.fillStyle = "rgba(214, 226, 245, 0.62)";
  for (const p of def.layout.placements) {
    ctx.fillRect(px(p.x) - s / 2, pz(p.z) - s / 2, s, s);
  }
}

/** A survey grid over the lot — eight divisions, whatever the map's extent. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oz: number,
  side: number,
): void {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 8; i++) {
    const at = Math.round(ox + (side * i) / 8) + 0.5;
    ctx.moveTo(at, oz);
    ctx.lineTo(at, oz + side);
    const down = Math.round(oz + (side * i) / 8) + 0.5;
    ctx.moveTo(ox, down);
    ctx.lineTo(ox + side, down);
  }
  ctx.stroke();
}

/**
 * The two home spawn lines, in the colours the sides are WORN in.
 *
 * Home spawns only — the ones with a team. Every control point carries a spawn
 * of its own, and drawing those puts a second mark inside each flag ring
 * saying nothing the ring does not.
 */
function drawSpawns(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  scale: number,
): void {
  for (const sp of def.layout.spawns) {
    if (sp.team === null || sp.team === undefined) continue;
    const c = CONFIG.teams[sp.team]?.color ?? "#ffffff";
    ctx.fillStyle = tint(c, 0.9);
    const r = Math.max(1.6, 1.5 * scale);
    ctx.beginPath();
    ctx.arc(px(sp.pos.x), pz(sp.pos.z), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The control points: a ring at the real capture radius, and the letter.
 *
 * The radius is the layout's own, so the rings are to scale with everything
 * else — which is the one fact on this thumbnail a player can act on, since
 * how far apart the flags are is most of what a Conquest map IS.
 */
function drawFlags(
  ctx: CanvasRenderingContext2D,
  def: MapDef,
  px: Proj,
  pz: Proj,
  scale: number,
): void {
  const font = Math.max(8, Math.min(13, 7 * scale));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const cp of def.layout.controlPoints) {
    const x = px(cp.pos.x);
    const z = pz(cp.pos.z);
    const r = Math.max(7, cp.radius * scale);
    ctx.fillStyle = "rgba(255, 230, 128, 0.12)";
    ctx.beginPath();
    ctx.arc(x, z, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 230, 128, 0.8)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = "#ffe680";
    ctx.font = `700 ${font}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(cp.id, x, z + 0.5);
  }
}
