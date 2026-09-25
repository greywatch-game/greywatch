/**
 * textures.ts — Runtime-generated canvas textures: the three carriageways a
 * road may be paved with and the valley floor's own surfaces, painted per texel
 * out of deterministic noise and cached per scene. Zero asset files.
 * Owns: the tiling noise primitives, one field recipe per surface, and the two
 * painters that turn a field into an albedo and into a height map.
 * Invariants: SIZE must stay a power of two for mipmaps AND must stay 512 —
 * `CelShader`'s bump tap is a hard-coded `1.0 / 512.0` and reads the albedo and
 * the height map as the same size; every field is periodic over the tile, so
 * nothing may sample a lattice or a cell grid without wrapping; and
 * anisotropicFilteringLevel stays 8 or the ground shimmers at grazing angles.
 *
 * **A surface is a FIELD, not a scatter of shapes.** Every tone and every
 * height here is a function evaluated at a texel, and the pixels are written
 * once through `putImageData`. The version this replaced drew each surface as a
 * few hundred filled ellipses, and it failed for a reason worth keeping: an
 * ellipse has a silhouette, and at any tile scale that keeps the repeat
 * invisible (4 m for `dirt`) its grains land at 10–30 cm — coin-sized, in front
 * of a camera 1.55 m up. The eye reads a circle at that size as an OBJECT, so
 * the valley floor came back as a heap of pancakes rather than as soil, and the
 * matching height map turned every one of them into a raised disc with a hard
 * rim, which is what the light bands then traced. No amount of retuning the
 * radii fixes that: the shape is the problem.
 *
 * So the shapes that survive here come from **cellular noise over a warped
 * domain** — Voronoi cells, which are irregular polygons, which tile the plane
 * with nothing showing between them, and whose distance-to-border is exactly
 * the groove a height map wants. A clod is a cell, a sett is a cell, a gravel
 * stone is a cell. Nothing in this file draws a disc any more.
 *
 * Style rules (what keeps these cel-shaded rather than gritty):
 * - the albedo is POSTERIZED — the tone field is quantized into a handful of
 *   flat levels before it becomes a colour, which is how "flat tones only, no
 *   gradients" survives a generator that works per texel. The fine grain is
 *   added BEFORE the quantization on purpose: it breaks the level boundaries
 *   into a stipple instead of leaving contour lines across the ground;
 * - the relief carries the detail and the albedo stays quiet. The shader's
 *   quantized bands ripple over the height map, and that read is free; the same
 *   detail spent on albedo contrast is what made the old surfaces spotty;
 * - low contrast between levels, and the darkest tone belongs in the grooves;
 * - **a height map is a DEPTH now, not only a slope**, so what is carved has to
 *   be a shape that reads carved: the highest features sit near 1 (the mesh is
 *   the top of the relief and everything is cut down from it), nothing small
 *   stands proud of what surrounds it (a pebble that does drops a shadow
 *   speck), and nothing sinks to the floor of the range unless it is a hole.
 *   `docs/rendering.md`, "A slope is not a depth", has what each recipe was
 *   before and what carving it did.
 *
 * Textures are authored in display space and sampled raw, matching the
 * no-image-processing pipeline (same convention as the player skin).
 */
import { DynamicTexture, Scene, Texture } from "@babylonjs/core";
import { clamp01, smoothstep } from "../core/math";
import type { RoadSurface } from "./roads";

/** The 2D context a `DynamicTexture` hands back. */
type Ctx = ReturnType<DynamicTexture["getContext"]>;

/**
 * Cobblestone world scale: one texture repeat spans this many metres. The
 * cells below land 5 setts across it, so one cobble is ~0.30 m — right for a
 * village street read at eye height.
 */
export const COBBLE_METERS_PER_TILE = 1.5;
/** Value for the cel shader's `texScale` uniform (repeats per metre). */
export const COBBLE_TEX_SCALE = 1 / COBBLE_METERS_PER_TILE;

/**
 * Canvas size, and it is not free to change.
 *
 * 512 over a 1.5 m tile is ~340 texels per metre, which is what a first-person
 * camera needs: the eye is 1.55 m above the street and the ground directly
 * underfoot is magnified about 1.3x at that height. At the 256 this was
 * authored at — fine for a camera 3.3 m back over the shoulder — looking down
 * at your own feet turned the setts into blobs.
 *
 * It is also written into the shader: `perturbNormal` takes its three taps one
 * texel apart at a hard-coded `1.0 / 512.0`. Moving this number without moving
 * that one silently rescales every surface's relief.
 */
const SIZE = 512;
const TEXELS = SIZE * SIZE;

/** Deterministic PRNG — the ground should look identical on every boot. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Push a value away from 0.5 and clamp. Value noise is a sum of uniforms and
 * therefore piles up around the middle: three octaves land inside 0.5 ± 0.13,
 * which posterizes into two of the six levels a ramp offers. Every recipe
 * spreads its noise before using it as a tone, and the factor is tuned per
 * surface rather than shared — how much of the ramp a surface should actually
 * use is an art decision, not a property of the noise.
 */
function spread(v: number, k: number): number {
  return clamp01(0.5 + (v - 0.5) * k);
}

/* ------------------------------------------------------------------------ *
 * Tiling noise primitives
 *
 * Both of these are PERIODIC BY CONSTRUCTION: the lattice wraps its cell
 * indices and the cell grid wraps its neighbour search, so a field built from
 * them meets itself at the tile edge exactly. That is what replaced the old
 * generator's nine-times wrapped stamping, and it is stronger than it was —
 * stamping made a shape that crossed an edge appear on the far side, but every
 * *field* underneath it (a base fill, a gradient) still had to be flat to
 * survive the seam.
 * ------------------------------------------------------------------------ */

/** A periodic value-noise lattice: `n` cells across the tile. */
interface Lattice {
  n: number;
  v: Float32Array;
}

function lattice(n: number, seed: number): Lattice {
  const rng = mulberry32(seed);
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rng();
  return { n, v };
}

/**
 * Bilinear value noise with a smoothstep fade, sampled in tile units. `u` and
 * `v` may run outside 0..1 — a caller that stretches one axis to draw streaks
 * relies on it, and the wrap makes it legal.
 */
function latticeAt(l: Lattice, u: number, v: number): number {
  const n = l.n;
  const fx = u * n;
  const fy = v * n;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const xa = (((x0 % n) + n) % n) | 0;
  const ya = (((y0 % n) + n) % n) | 0;
  const xb = (xa + 1) % n;
  const yb = (ya + 1) % n;
  const a = l.v[ya * n + xa];
  const b = l.v[ya * n + xb];
  const c = l.v[yb * n + xa];
  const d = l.v[yb * n + xb];
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

/** `count` lattices at doubling frequency, for fBm. */
function octaves(seed: number, count: number, base: number): Lattice[] {
  const out: Lattice[] = [];
  for (let i = 0; i < count; i++) out.push(lattice(base << i, seed + i * 977));
  return out;
}

/** Sum of the octaves at halving amplitude, normalized to 0..1. */
function fbmAt(ls: Lattice[], u: number, v: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < ls.length; i++) {
    sum += amp * latticeAt(ls[i], u, v);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * The same sum with each octave folded about its middle (`|2n-1|`), which
 * turns the smooth hills of value noise into LUMPS with creases between them.
 *
 * This is what a soil relief is made of. Plain fBm is a landscape — everything
 * rolls, nothing has an edge — and a cell field is crazy paving, every clod
 * ringed by a groove that goes all the way round. Folded noise is neither: it
 * gives crumb at every octave, joined where the folds meet, and it has no
 * silhouette at any scale, which is the property the old disc scatter could
 * never have.
 */
function billowAt(ls: Lattice[], u: number, v: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < ls.length; i++) {
    sum += amp * Math.abs(2 * latticeAt(ls[i], u, v) - 1);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * A periodic jittered-lattice cell grid: `n` cells across the tile, one site
 * placed anywhere inside each. Each site carries its own roll, which is what a
 * recipe reads to give one clod, one sett or one stone a height and a tone of
 * its own.
 */
interface Cells {
  n: number;
  /** Site offsets inside their cell, 0..1. */
  sx: Float32Array;
  sy: Float32Array;
  /** Per-cell roll, 0..1. */
  roll: Float32Array;
}

function cells(n: number, seed: number, jitter = 1): Cells {
  const rng = mulberry32(seed);
  const sx = new Float32Array(n * n);
  const sy = new Float32Array(n * n);
  const roll = new Float32Array(n * n);
  const lo = (1 - jitter) * 0.5;
  for (let i = 0; i < sx.length; i++) {
    sx[i] = lo + rng() * jitter;
    sy[i] = lo + rng() * jitter;
    roll[i] = rng();
  }
  return { n, sx, sy, roll };
}

/**
 * What a cell lookup answers. Reused rather than returned, because a fresh
 * object per texel is 262,144 of them per surface.
 */
interface Hit {
  /** Distance to the nearest site, in cell widths. */
  f1: number;
  /** Distance to the second nearest. `f2 - f1` is 0 exactly on a border. */
  f2: number;
  /** The nearest site's own roll. */
  roll: number;
  /**
   * Where the texel sits relative to that site, in cell widths — what a recipe
   * reads to TILT a cell, so one clod faces the light and its neighbour turns
   * away from it. Continuous inside a cell, which is all a tilt needs: the
   * border it jumps across is the groove.
   */
  dx: number;
  dy: number;
}

const hitA: Hit = { f1: 0, f2: 0, roll: 0, dx: 0, dy: 0 };
const hitB: Hit = { f1: 0, f2: 0, roll: 0, dx: 0, dy: 0 };

/**
 * Nearest and second-nearest site over the 3x3 neighbourhood, wrapped. Three
 * by three is exhaustive only while sites stay inside their own cell, which is
 * why `jitter` is capped at 1 and never scales the offset beyond it.
 */
function cellsAt(c: Cells, u: number, v: number, out: Hit): void {
  const n = c.n;
  const fx = u * n;
  const fy = v * n;
  const cx = Math.floor(fx);
  const cy = Math.floor(fy);
  let f1 = 1e9;
  let f2 = 1e9;
  let roll = 0;
  let nx = 0;
  let ny = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const gy = cy + dy;
    const wy = (((gy % n) + n) % n) | 0;
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const wx = (((gx % n) + n) % n) | 0;
      const i = wy * n + wx;
      const px = gx + c.sx[i] - fx;
      const py = gy + c.sy[i] - fy;
      const d = Math.sqrt(px * px + py * py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        roll = c.roll[i];
        nx = -px;
        ny = -py;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.roll = roll;
  out.dx = nx;
  out.dy = ny;
}

/* ------------------------------------------------------------------------ *
 * Fields, and the two painters
 * ------------------------------------------------------------------------ */

/**
 * One surface, evaluated. Two planes over the same texels: what the albedo is
 * about to be posterized out of, and what the height map is.
 *
 * **The pair is built together and never separately**, which is the structural
 * form of the rule the old generator kept by convention (same seed, same draw
 * order, and a warning not to disturb either). A dome that does not sit on the
 * grain it belongs to lights the gaps and sinks the lumps; here it cannot,
 * because both come out of one pass.
 */
interface Field {
  tone: Float32Array;
  height: Float32Array;
}

function blankField(): Field {
  return { tone: new Float32Array(TEXELS), height: new Float32Array(TEXELS) };
}

/**
 * The last field built, kept so the albedo and the height map are one pass
 * rather than two.
 *
 * A SINGLE entry, deliberately. `floorSurfaces.floorMaterial` asks for the
 * albedo and the bump one line apart and the kit's street does the same, so a
 * one-deep memo hits every time it matters; a map keyed by surface would hold
 * 2 MB of Float32 per pattern for the life of the page against no further
 * hits. It is keyed by pattern and carries no colour, for the same reason the
 * height texture's own cache key does not: a field is the grain, and the grain
 * is what every tint of one surface shares.
 */
let lastField: { key: string; field: Field } | null = null;

function fieldOf(key: string, build: () => Field): Field {
  if (lastField && lastField.key === key) return lastField.field;
  const field = build();
  lastField = { key, field };
  return field;
}

/** A colour as channels, 0..255. */
type Rgb = [number, number, number];

function rgbOf(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * A tone derived from a base colour: `mul` scales it toward white or black,
 * `warm` pushes it toward red-brown (positive) or blue-green (negative), in
 * fractions of full scale.
 *
 * Derivation rather than authored tones is what lets one pattern serve every
 * map — the same clods over Greyfen's loam and over a grey silt read as the
 * same ground in two different soils.
 */
function shadeRgb(hex: string, mul: number, warm = 0): Rgb {
  const [r, g, b] = rgbOf(hex);
  const w = warm * 255;
  const c = (v: number, d: number) =>
    Math.round(Math.min(255, Math.max(0, v * mul + d)));
  return [c(r, w), c(g, 0), c(b, -w)];
}

/**
 * A tone derived from a base colour by scaling each channel on its own, then
 * the whole by `mul`. `shadeRgb`'s warm axis trades red against blue and
 * leaves green alone, which reaches rust and slate but never OLIVE — and a
 * surface whose ladder has to hold moss as well as soil needs the green
 * channel moved.
 */
function tintRgb(hex: string, mul: number, [kr, kg, kb]: Rgb): Rgb {
  const [r, g, b] = rgbOf(hex);
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return [c(r * kr * mul), c(g * kg * mul), c(b * kb * mul)];
}

/**
 * A tone placed inside one BAND of a ladder that is several ladders laid end
 * to end: `t` (0..1) picks a level among `count` starting at `first`, of
 * `total` in the whole palette. What `paintAlbedo` does with it is exactly
 * `first + floor(t * count)`, so a texel given a band can never posterize
 * into its neighbour's — the grain that stipples a band's own boundaries
 * stays inside it.
 */
function inBand(t: number, first: number, count: number, total: number): number {
  return (first + clamp01(t) * count * 0.999) / total;
}

/**
 * The posterized ladder a tone field is quantized onto: `levels` flat tones
 * running from `lo` to `hi` times the base colour, warming (or cooling) as
 * they lighten.
 *
 * Six is the usual count. Fewer reads as a poster and shows the level
 * boundaries as shapes; more stops reading as flat tones at all, which is the
 * whole point of quantizing rather than writing the field straight out.
 */
function ramp(
  base: string,
  levels: number,
  lo: number,
  hi: number,
  warmLo = 0,
  warmHi = 0,
): Rgb[] {
  const out: Rgb[] = [];
  for (let i = 0; i < levels; i++) {
    const t = levels === 1 ? 0 : i / (levels - 1);
    out.push(shadeRgb(base, lo + (hi - lo) * t, warmLo + (warmHi - warmLo) * t));
  }
  return out;
}

/** Quantize the tone field onto a ramp and write it out. */
function paintAlbedo(ctx: Ctx, tone: Float32Array, palette: Rgb[]): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const levels = palette.length;
  const last = levels - 1;
  for (let i = 0; i < TEXELS; i++) {
    let k = (tone[i] * levels) | 0;
    if (k < 0) k = 0;
    else if (k > last) k = last;
    const p = palette[k];
    const o = i << 2;
    d[o] = p[0];
    d[o + 1] = p[1];
    d[o + 2] = p[2];
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Write the height field out as grey. Not posterized — the shader reads the
 * red channel and differences it, and a quantized height map is a staircase of
 * flat plates with vertical walls between them. The "flat tones" rule governs
 * albedo; it is the shader's band quantization that keeps the lit result toon,
 * not the height data.
 */
function paintHeight(ctx: Ctx, height: Float32Array): void {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < TEXELS; i++) {
    const c = (clamp01(height[i]) * 255) | 0;
    const o = i << 2;
    d[o] = c;
    d[o + 1] = c;
    d[o + 2] = c;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------------ *
 * The village street
 *
 * The cobbles are a PLACE — a village street, painted in the village's own
 * colours, next to the palette in BuildingKit. That is what separates them
 * from the valley floor's surfaces below, which have no colour of their own.
 * The other two carriageways in between are places on the same terms; what
 * makes the street the odd one of the three is that it is FIVE stone tones
 * rather than a ladder over one, which is why it alone is authored here.
 * ------------------------------------------------------------------------ */

/** Mortar sits just below the darkest timber; the setts jitter around it. */
const MORTAR = "#2c2822";
/** The sett ladder, dark to light. A stone is one of these, flat. */
const SETTS = ["#413b31", "#4a4438", "#514b3e", "#57534a", "#5d5747"];
/** Grit worked into the mortar, so the gaps are not one dead colour. */
const MORTAR_GRIT = "#37322a";

/**
 * The street's field. Setts are cells over a warped domain: irregular, packed,
 * every one a different polygon.
 *
 * The version this replaced laid rounded rectangles on a 4x5 running bond,
 * which is a real paving pattern and read as none of it — every stone the same
 * size to within a tenth, every row the same height, and a strict two-row
 * alternation the eye locks onto at a glance.
 *
 * **The jitter is the whole argument, and it is set at just over half a cell.**
 * At a full cell the sites land anywhere and the cells come out as wildly
 * different polygons — which is crazy paving, a real surface and the wrong one:
 * a street is LAID, one sett at a time, by someone who wanted them to fit. At
 * half a cell they stay roughly square and roughly equal, and what varies is
 * which way each one leans. Five cells over the 1.5 m tile puts a sett at
 * ~30 cm, which is the size a boot reads as a cobble rather than as a flagstone.
 */
const COBBLE_CELLS = 5;

function cobbleField(): Field {
  const field = blankField();
  const { tone, height } = field;
  const warpU = lattice(6, 0xc0b1);
  const warpV = lattice(6, 0xc0b2);
  const grit = octaves(0xc0b3, 2, 96);
  const setts = cells(COBBLE_CELLS, 0xc0bb1e, 0.55);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = y * SIZE + x;

      // Warping the lookup is what turns straight Voronoi borders into the
      // wandering joint of a laid street. Small — a twentieth of a tile — but
      // it is the difference between masonry and a crystal lattice.
      const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.045;
      const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.045;
      cellsAt(setts, wu, wv, hitA);
      const g = fbmAt(grit, u, v);

      // The joint: `f2 - f1` is zero on the border between two setts and grows
      // inward, so this is a mortar groove of a fixed width whatever shape the
      // stones came out.
      const border = hitA.f2 - hitA.f1;
      const stone = smoothstep(0.03, 0.07, border);

      // **A sett is a PILLOW: a rounded shoulder all the way up to a crown that
      // is still very slightly domed.** The version before the relief had a
      // depth reached its crown a quarter of the way in, which was invisible
      // while the street was only a slope — and the moment the shader could
      // carve it, the street came back as flat-topped TILES standing on
      // vertical sides. The shoulder is an ease-out over most of the stone's
      // radius, so a raking sun lands a lit rim on the side toward it and the
      // shadow falls off the far one.
      //
      // One stone in twenty is sunk — a street that has been relaid a few
      // times — and it is sunk by a third, not to the mortar: sunk further, a
      // carved sett is a HOLE the relief's own shadow fills black, and at two
      // or three per tile those holes were the most repeated thing on the
      // street.
      const sunk = hitA.roll < 0.05;
      const peak = sunk ? 0.58 : 0.78 + hitA.roll * 0.22;
      const shoulder = smoothstep(0.03, 0.34, border);
      const dome = 1 - (1 - shoulder) * (1 - shoulder);
      const mortar = 0.16 + g * 0.08;
      height[i] = clamp01(mortar + (peak - mortar) * dome + (g - 0.5) * 0.04 * stone);

      // Tone is the sett's own roll, quantized by the ramp into one of five
      // stone colours — flat, as a painted sett should be — with the mortar
      // taking everything under the joint threshold.
      // A sett is ONE FLAT TONE, and the grit term is a twentieth of a level
      // for a reason: at a tenth it crossed a palette boundary inside a single
      // stone often enough to speckle it, which reads as stucco rather than as
      // stone. What little it does is soften the boundary between two setts
      // that happen to land on adjacent tones.
      tone[i] =
        stone < 0.5
          ? g * 0.28 // mortar band: the ramp's bottom two entries
          : 0.34 + hitA.roll * 0.64 + (g - 0.5) * 0.04 - (sunk ? 0.1 : 0);
    }
  }
  return field;
}

/** The street's palette: two mortar tones, then the five setts. */
const COBBLE_PALETTE: Rgb[] = [
  rgbOf(MORTAR),
  rgbOf(MORTAR_GRIT),
  ...SETTS.map(rgbOf),
];

/* ------------------------------------------------------------------------ *
 * The other two carriageways
 *
 * The cobbles above are a laid street and carry their own five stone tones.
 * These two are the same KIND of thing — a place, with a colour of its own out
 * of the kit's palette (`DIRT`, `ASPHALT`) — and not the floor patterns below,
 * which have no colour at all and take whatever soil the map is standing on.
 * The base is passed in for the floor's reason nonetheless: a road's colour is
 * already stated once in `kit/core.ts` and is what the untextured slab used to
 * be, so a ladder centred on it changes the grain without changing what colour
 * a road is.
 *
 * **A road is not the ground it crosses, and on two maps that is not a matter
 * of taste.** Hollowmere and Greyfen both state `floorSurface: "dirt"`, and
 * every ground texture in this file is sampled at `vPosW.xz` — so a track
 * painted with the floor's own field at the floor's own scale would be in
 * PHASE with the soil under it, grain for grain, and the carriageway would read
 * as a tint laid over the ground rather than as a surface laid on it. Hence a
 * field of its own at a tile size no floor pattern uses; and it wants one
 * anyway, because a track is a different material from the soil beside it. It
 * is COMPACTED: the clods are crushed out of it, the stones are pressed flush
 * instead of standing proud, and what is left is hardpan under a fine dust.
 *
 * **Neither is glossy, and for asphalt that is a rule rather than a taste.**
 * `getGroundTextured`'s spec is the map's own `groundSpec`, which is the wet
 * *cobble* sheen — and Coldharbour's is tuned at 24 degrees of sun elevation on
 * the stated premise that it reaches 432 m² of civic path and none of the
 * avenues (see that map's `environment.ts`). The term explodes as the key light
 * drops, so a spec'd carriageway there would be a sheet of white. Soil is not
 * wet stone either, which is the argument `floorSurfaces.ts` already makes for
 * the floor.
 * ------------------------------------------------------------------------ */

/**
 * Which road surfaces are painted from a base colour — every one but the
 * street, which is five authored stone tones and not a tint of anything.
 * Derived from `RoadSurface` so a fourth carriageway is a compile error here
 * until it has been given a field, a palette and a tile.
 */
export type RoadPatternId = Exclude<RoadSurface, "cobble">;

/** One carriageway's world scale and relief, exactly as `FloorSurface` is. */
interface RoadPattern {
  /**
   * Metres spanned by one texture repeat. Both are deliberately unequal to
   * every floor pattern's (`floorSurfaces.ts`: 2.5, 4, 4.5, 5 and 5.5) so a road can
   * never come into phase with the ground it is lying on.
   */
  metersPerTile: number;
  /**
   * Metres of relief at height 1.0 — the slope's scale AND, since the ground
   * was given a depth, how deep the shader carves (`CONFIG.graphics.relief`).
   * The two stopped being separable, which is why the track's went UP when it
   * was carved: at 2.6 cm a worn hollow and a pressed-in stone were real
   * slopes and no depth at all, so the lane read as a flat sheet beside a
   * floor that had become cracked ground. Blacktop is a bound surface and
   * stays the shallowest thing that is not sand.
   */
  bumpScale: number;
}

/** Both carriageways' tuning, next to the recipes their cell counts are in. */
export const ROAD_PATTERNS: Record<RoadPatternId, RoadPattern> = {
  dirt: { metersPerTile: 3.5, bumpScale: 0.05 },
  asphalt: { metersPerTile: 3, bumpScale: 0.024 },
};

/**
 * Each carriageway's field. Read by both painters, and by neither with a
 * colour in hand — the height map is one texture per surface however many
 * tints ask for it, exactly as the floor's is.
 */
const ROAD_FIELDS: Record<RoadPatternId, () => Field> = {
  /**
   * A scraped track: hardpan, a fine dust over it, shallow hollows worn into
   * it and stones pressed flush.
   *
   * **What separates this from the valley's own `dirt` is the RELIEF, not the
   * tint**, and that is the whole point of the surface. The floor's soil is
   * folded octaves at 20, 10 and 5 cm — crumb, with a groove where every fold
   * meets — plus a stone in a quarter of its cells standing proud. A track has
   * been driven over: there is no crumb left, the stones are trodden into it,
   * and the only relief above a grain is the DIPS, which are what actually
   * catches a band of light on a lane at night.
   */
  dirt: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    // Dust and fine grit. Three octaves at 110, 220 and 440 cells over the
    // 3.5 m tile land at 3.2, 1.6 and 0.8 cm — grain, which is what is left
    // when the crumb has been crushed out.
    const dust = octaves(0xd18a1, 3, 110);
    // The hollows: nine cells over the tile is a 39 cm dip, which is the size
    // that reads as somewhere a puddle sat rather than as a pothole.
    const hollows = octaves(0xd18a2, 2, 9);
    // Where the track is scraped down to bare hardpan and where the loose
    // stuff has gathered. Weak on purpose — the `dirt` floor's own note on
    // posterizing a smooth low-frequency field applies verbatim: at any real
    // weight this comes out as flat patches with hard edges, at the size of
    // this field's own features, which is a contour map and not a road.
    const bare = octaves(0xd18a3, 2, 3);
    // A stone every few cells, PRESSED IN. 44 cells over 3.5 m is an 8 cm
    // stone; what makes it a track's stone rather than the floor's is that it
    // is mostly tone and barely any height.
    const stones = cells(44, 0xd18a4);
    // Where the loose stones have gathered — the floor's `drifts` argument: a
    // cell grid is evenly spaced, and grit spread evenly is a pattern.
    const drifts = octaves(0xd18a5, 2, 6);
    const warpU = lattice(8, 0xd18a6);
    const warpV = lattice(8, 0xd18a7);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const g = fbmAt(dust, u, v);
        const dip = spread(fbmAt(hollows, u, v), 1.7);
        const scrape = spread(fbmAt(bare, u, v), 1.5);

        // **The hollows are WORN IN, with an edge**, which is what a carved
        // track needs that a bumped one did not. A smooth dip is a slope and
        // nothing else; given a depth it is a soft saucer nobody can see. The
        // deepest third of the field is cut down to a floor with a lip round
        // it, so a low sun lands a shadow inside the near rim and a lit face on
        // the far one — somewhere a puddle sat.
        const hollow = smoothstep(0.64, 0.84, dip);
        let h = 0.62 + (dip - 0.5) * 0.18 + (g - 0.5) * 0.16 - hollow * 0.2;

        // Stones, PRESSED IN and standing a little proud of it: a rounded
        // crown a wheel has been over, which under a raking light is a lit
        // cap with a shadow off the far side. At no depth they were pale DOTS
        // on the track, and a dot is a sprinkle rather than a stone.
        const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.02;
        const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.02;
        cellsAt(stones, wu, wv, hitA);
        let stone = 0;
        const gritty = 0.95 - smoothstep(0.45, 0.72, fbmAt(drifts, u, v)) * 0.14;
        if (hitA.roll > gritty) {
          const r = 0.16 + (hitA.roll - gritty) * 1.6;
          const t = clamp01(1 - hitA.f1 / r);
          stone = Math.sqrt(t);
          h = Math.max(h, 0.6 + 0.3 * stone * (0.6 + hitA.roll * 0.4) - hollow * 0.2);
        }

        height[i] = clamp01(h);
        // The dips hold the damp and the crowns dry out pale, which is the
        // correlation that makes this one material rather than a bump map and
        // a colour that happen to share a tile. Kept inside half a level, per
        // the `bare` note above; the fine grain is what carries the read
        // through the quantization. The stones take only a little of the
        // ramp: their relief is what shows them now.
        tone[i] =
          0.42 +
          (scrape - 0.5) * 0.18 +
          (g - 0.5) * 0.42 +
          (h - 0.5) * 0.3 -
          hollow * 0.12 +
          (stone > 0 ? 0.1 : 0);
      }
    }
    return field;
  },

  /**
   * Blacktop: a bound surface with its aggregate showing through, crazed where
   * it has been standing longest.
   *
   * **The cracks are a Voronoi BORDER and nothing is drawn for them**, which is
   * the same trick the mortar between two setts is: fatigue cracking in asphalt
   * genuinely fails in polygons, and `f2 - f1` over a coarse cell field already
   * IS the seam between two of them. What that buys over a noise field is that
   * a crack is continuous and closes on itself — a crack drawn as thresholded
   * noise is a scatter of dashes, which reads as dirt on the lens.
   *
   * There is no repair patch and no wheel polish here, and both are absences on
   * purpose. A patch is a low-frequency feature, so it would arrive with the
   * tile's own period stamped on it (the file header's rule: no feature larger
   * than a quarter of the tile); what varies a carriageway at that scale is
   * `graphics.groundVariation`, in world space, which has no period. And polish
   * runs ALONG the road, which a world-mapped texture cannot know the direction
   * of — the lane markings are where a road says which way it goes.
   */
  asphalt: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    // Aggregate. 76 cells over the 3 m tile is a 3.9 cm chip — deliberately
    // half of `gravel`'s 8 cm, because gravel is stones you walk on and this is
    // stones held in bitumen with most of them still under it.
    const chips = cells(76, 0xa5b17);
    // The crazing, at 14 cells over 3 m: a 21 cm plate, which is the size
    // alligator cracking actually comes in — see the note at the seam below.
    const plates = cells(14, 0xa5b27);
    // WHERE it has crazed at all. Without this the whole carriageway is one
    // continuous crack network, which is a road at the end of its life rather
    // than a road.
    const fatigue = octaves(0xa5b37, 2, 3);
    // The binder's own grain, at 128 cells: 2.3 cm.
    const grain = octaves(0xa5b47, 2, 128);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const g = fbmAt(grain, u, v);
        let h = 0.78 + (g - 0.5) * 0.12;

        // A chip in the top third of the rolls is one that has come through the
        // binder. The rest are still under it and say nothing — and the ones
        // that show stand barely proud, because a carved chip that stands up
        // drops a shadow speck, and a road of those is pepper.
        cellsAt(chips, u, v, hitA);
        let chip = 0;
        if (hitA.roll > 0.66) {
          chip = smoothstep(0.36, 0.2, hitA.f1);
          h = h * (1 - chip) + (0.84 + hitA.roll * 0.08) * chip;
        }

        // 1 on the plate, falling to 0 in the crack between two of them.
        //
        // **Both numbers here were photographed down an avenue and both were
        // wrong the loud way round the first time.** A crack that closed over
        // 0.055 of a cell is 2 cm of dark at this tile, and a `crazed` gate
        // opening at 0.52 of a spread field puts some of it nearly everywhere:
        // the near field came back as a bed of dried mud, and because the cells
        // were 43 cm the polygons read as FLAGSTONES laid in the road. The
        // crack has to be a line and the crazing has to be a patch — so the
        // plate is half the size, the seam is a third the width, and the gate
        // now opens in the top tail of the field rather than across the middle
        // of it.
        cellsAt(plates, u, v, hitB);
        const plate = smoothstep(0.0, 0.035, hitB.f2 - hitB.f1);
        const crazed = smoothstep(0.58, 0.9, spread(fbmAt(fatigue, u, v), 1.3));
        const crack = (1 - plate) * crazed;
        // A crack is CUT, not scored: with the relief carved, a shallow one is
        // a line that no light can find, and a deep one is a dark seam with a
        // shadow in it. Where the crazing is worst the plates between the
        // cracks have SETTLED as well, each to its own depth, which is what
        // turns alligator cracking from a line drawing on the road into a
        // surface that has moved.
        h -= crack * 0.7 + crazed * hitB.roll * 0.22;

        height[i] = clamp01(h);
        // Asphalt is very nearly one tone and the read is the relief catching
        // the light — sand's argument, in a darker material. What moves at all
        // is the exposed aggregate, which is stone and therefore paler than the
        // binder, and the cracks, which are the dark and belong in the grooves.
        //
        // The chips are worth a SIXTH of what they were. At a third of a level
        // every one of them crossed a palette boundary on its own, and a road
        // full of pale specks read as a noise pattern printed on a sheet; with
        // the relief carved, the chip is a cap catching the light instead.
        tone[i] =
          0.44 +
          (g - 0.5) * 0.3 +
          chip * 0.06 +
          (h - 0.5) * 0.18 -
          crack * 0.24;
      }
    }
    return field;
  },
};

/**
 * Each carriageway's ladder, centred on the road's own colour for the reason
 * the floor's are centred on the soil's: switching a road from a flat tone to a
 * textured one has to change its grain and not what colour it is. Both are
 * narrow — a track is one soil and blacktop is very nearly one tone — and what
 * has to read is the LOCAL step from binder to chip or from hardpan to dust,
 * not the range.
 */
const ROAD_PALETTES: Record<RoadPatternId, (base: string) => Rgb[]> = {
  dirt: (base) => ramp(base, 6, 0.74, 1.24, -0.01, 0.028),
  asphalt: (base) => ramp(base, 6, 0.76, 1.26, 0, 0.014),
};

/* ------------------------------------------------------------------------ *
 * The valley floor's surfaces
 *
 * The cobbles above are a place. These are the opposite: a PATTERN with no
 * colour of its own, painted from whatever `EnvironmentSpec.floorColor` the map
 * states. That split is the whole reason a map can pick one.
 *
 * **The colour stays one fact.** `floorColor` is already what the untextured
 * floor is, what `ridgeScreeColor` is asked to melt into and what a grass
 * field's roots are matched against; a surface that carried its own palette
 * would be a second answer to the same question, and the two would drift the
 * first time a map was re-tinted. So every tone here is DERIVED from the base —
 * `ramp` lightens, darkens and warms it — and the ladder is centred on the base
 * so switching a map from `flat` to `dirt` changes the grain without changing
 * the colour of the ground.
 *
 * **Albedo and height share one field, and the height map is cached without the
 * colour.** The recipes read no colour at all, so the height map for `dirt` is
 * one texture however many maps ask for it in however many tints.
 * ------------------------------------------------------------------------ */

/**
 * Every surface's field. Read by both painters, and by neither with a colour
 * in hand.
 *
 * The scales in each are stated against that surface's own `metersPerTile` in
 * `floorSurfaces.ts` — a cell count is only a size once the tile has a size.
 * Move one and the other is what says what it did.
 */
const FIELDS = {
  /**
   * Crumb, grit and a scatter of small stones. The tile is 4 m, so the folded
   * octaves below land their lumps at 20, 10 and 5 cm — under the size the eye
   * reads as an object, which is the whole trick. What carries the surface is
   * the RELIEF; the albedo does little except mottle damp against dry.
   *
   * **The cracks are masked, and that mask is the difference between cracked
   * ground and a dry lake bed.** A cell field applied everywhere rings every
   * clod with a groove, and the whole floor becomes one crazed sheet. Here the
   * plates are let through only where a low-frequency mask says so — most of
   * the ground, since the relief could carve them — the rest is crumb, and the
   * boundary between the two is a crack fading out rather than a shape.
   */
  dirt: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    const warpU = lattice(8, 0xd1a1);
    const warpV = lattice(8, 0xd1a2);
    const damp = octaves(0xd1a3, 3, 14);
    const crumb = octaves(0xd1a7, 3, 20);
    const grit = octaves(0xd1a4, 2, 96);
    // Ten plates across the 4 m tile is a 40 cm slab, the size dried ground
    // breaks into when it has had a summer to do it.
    const cracks = cells(10, 0xd1a5);
    const crackMask = octaves(0xd1a8, 2, 5);
    const stones = cells(72, 0xd1a6);
    const drifts = octaves(0xd1a9, 2, 7);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.06;
        const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.06;

        const wet = spread(fbmAt(damp, u, v), 1.8);
        const lump = billowAt(crumb, wu, wv);
        const g = fbmAt(grit, u, v);

        // Soil is crumb first: three folded octaves, none of them big enough
        // to be a thing.
        const crumbH = 0.16 + lump * 0.62 + g * 0.07;

        // Then the cracks, where there are any — and where there are, the
        // ground between them is a PLATE rather than crumb with a groove
        // scored through it. **That is what the relief's depth asked of this
        // recipe.** Scored crumb is a line drawn on the soil, and carved it
        // reads as one; a crack is where dried ground has pulled APART, so
        // what stands either side of it is a slab with a rounded lip, each one
        // settled at its own tilt. The tilt is the loud part under a low sun:
        // one plate turns its face to the light and its neighbour turns away,
        // which is what makes a cracked flat read as ground with a shape
        // rather than as a pattern on a sheet.
        cellsAt(cracks, wu, wv, hitA);
        const border = hitA.f2 - hitA.f1;
        const cracked = smoothstep(0.36, 0.6, fbmAt(crackMask, u, v));
        const lip = smoothstep(0.0, 0.2, border);
        const edge = 1 - (1 - lip) * (1 - lip);
        const lean = hitA.roll * Math.PI * 2;
        const plateH =
          0.58 +
          (hitA.roll - 0.5) * 0.14 +
          (hitA.dx * Math.cos(lean) + hitA.dy * Math.sin(lean)) * 0.26 +
          (lump - 0.5) * 0.22 +
          g * 0.05;
        const groove = (1 - smoothstep(0.012, 0.07, border)) * cracked;
        let h =
          crumbH * (1 - cracked) + (0.1 + (plateH - 0.1) * edge) * cracked;

        // Grit worked through the soil: one small cell in eight carries a
        // stone, and at a 5.5 cm cell that is a pebble rather than a pea.
        //
        // **They are kept small and quiet on purpose.** The first pass here put
        // a 9 cm stone in every fifth cell of a coarser grid, lit them a fifth
        // of a level brighter than the soil and stood them a third of the
        // relief proud — and forty of them across the screen, evenly spaced
        // because a cell grid is evenly spaced, read as scattered beans. A
        // pebble is allowed to be found by someone looking at their feet; it is
        // not allowed to be the first thing anyone sees.
        //
        // They also gather in DRIFTS rather than falling on a grid. The cell
        // field is evenly spaced by construction, and grit spread evenly over
        // a floor is the one arrangement no weather produces: it reads as a
        // pattern, which is exactly what a texture must not do. The mask lets
        // roughly a quarter of the cells carry a stone where the soil is
        // washed and almost none where it is not.
        cellsAt(stones, wu, wv, hitB);
        let stone = 0;
        const gritty = 0.94 - smoothstep(0.42, 0.72, fbmAt(drifts, u, v)) * 0.2;
        if (hitB.roll > gritty) {
          const size = 0.2 + (hitB.roll - gritty) * 2.2;
          stone = smoothstep(size, size * 0.55, hitB.f1);
          // Level with a plate's face rather than proud of it: carved, a stone
          // standing over the soil drops a shadow speck behind it, and a drift
          // of them read as ground peppered black.
          h = h * (1 - stone) + (0.5 + hitB.roll * 0.12) * stone;
        }

        height[i] = clamp01(h);
        // Tone follows the relief a little — a crumb that stands proud is the
        // dry side of it and a hollow holds the damp — and that correlation is
        // most of why this reads as one material rather than as a colour and a
        // bump map that happen to share a tile.
        //
        // **The damp/dry term is deliberately weaker than the fine grain, and
        // that ordering is the whole difference between soil and blotches.** A
        // posterized ramp turns any smooth low-frequency field into flat
        // patches with hard edges — a contour map, not a texture — and the
        // patches are exactly the size of that field's features. At a 0.46
        // weight over a spread of 2.1 this one swung nearly a level and a half
        // across 0.7 m, so the ground read as a scatter of dark spots that then
        // repeated with the tile. Keeping it inside half a level leaves damp
        // and dry legible as a tendency rather than as shapes, and the slow
        // change that is actually worth seeing across a valley is
        // `graphics.groundVariation` in world space, which has no period.
        //
        // The fine grain is what makes that survive quantization: it has to be
        // worth a good fraction of a level (a sixth of the ramp) on its own, or
        // the boundaries it is meant to break up stay clean lines.
        tone[i] =
          0.29 +
          wet * 0.36 +
          (h - 0.5) * 0.3 +
          (g - 0.5) * 0.44 -
          groove * 0.26 +
          stone * 0.08;
      }
    }
    return field;
  },

  /**
   * Packed stones with no soil left showing. Cells rather than a scatter is
   * what fixes the version this replaced: 1,020 discs over the tile still left
   * most of the base colour visible between them, so `gravel` read as bubbles
   * on tar. Voronoi covers the plane by definition — every texel belongs to
   * some stone, and what separates them is the seam, not the ground.
   *
   * Thirty-two cells over the 2.5 m tile is an 8 cm stone. At the 22 this was
   * first cut at they were 11 cm and the surface read as rubble, which is a
   * different material: gravel is what you walk on, rubble is what you climb.
   */
  gravel: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    const warpU = lattice(10, 0x9a41);
    const warpV = lattice(10, 0x9a42);
    const grit = octaves(0x9a43, 2, 96);
    const stones = cells(32, 0x9a4e1);
    const damp = octaves(0x9a44, 2, 3);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.03;
        const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.03;
        cellsAt(stones, wu, wv, hitA);
        const g = fbmAt(grit, u, v);
        const wet = spread(fbmAt(damp, u, v), 1.6);

        const seam = hitA.f2 - hitA.f1;
        const body = smoothstep(0.02, 0.14, seam);
        // Harder and rounder than soil: most of the stone is crown, and it
        // drops away over the last of its radius.
        const peak = 0.5 + hitA.roll * 0.5;
        height[i] = clamp01(body * peak + g * 0.05);
        tone[i] =
          0.25 +
          hitA.roll * 0.62 + // stones genuinely differ; this is the read
          (wet - 0.5) * 0.16 +
          (g - 0.5) * 0.22 -
          (1 - body) * 0.34; // the seams are the dark
      }
    }
    return field;
  },

  /**
   * Wind ripples over fine grain. The ripples run DIAGONALLY and are warped by
   * noise, which is two fixes to one problem: the old bands ran along the tile
   * axis at a fixed wavelength, so the surface read as corduroy and the tile's
   * own repeat was the most legible thing in it. A diagonal phase built from
   * whole numbers of cycles in each axis (2 and 1) still meets itself at both
   * seams.
   */
  sand: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    const meander = octaves(0x5a41, 2, 4);
    const grain = octaves(0x5a42, 2, 110);
    const drift = octaves(0x5a43, 2, 3);
    const stones = cells(30, 0x5a44);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        // Sixteen cycles along the diagonal — a ~31 cm ripple over the 5 m tile
        // — pushed off-course by a couple of cycles of low-frequency noise so no
        // two crests stay parallel for long. At five cycles the wavelength was a
        // metre, which is a dune's, drawn at a ripple's amplitude.
        const phase = (2 * u + v) * 16 + (fbmAt(meander, u, v) - 0.5) * 2.2;
        const wave = Math.sin(phase * Math.PI * 2);
        const g = fbmAt(grain, u, v);
        const dune = spread(fbmAt(drift, u, v), 1.5);

        // Ripples are shallow: a crest is a few centimetres over a metre of
        // trough, which is why `bumpScale` for sand is half of dirt's.
        let h = 0.45 + wave * 0.26 + g * 0.08 + (dune - 0.5) * 0.12;

        // A stone in every twelfth cell, half buried.
        cellsAt(stones, u, v, hitB);
        let stone = 0;
        if (hitB.roll > 0.92) {
          stone = smoothstep(0.3, 0.14, hitB.f1);
          h = h * (1 - stone) + 0.8 * stone;
        }

        height[i] = clamp01(h);
        // Sand's albedo barely moves — it is nearly all one tone, and the read
        // comes from the relief catching the light. The crest gets the lighter
        // level, the trough the darker, and the grain stipples between them.
        tone[i] =
          0.5 + wave * 0.16 + (dune - 0.5) * 0.3 + (g - 0.5) * 0.3 + stone * 0.2;
      }
    }
    return field;
  },

  /**
   * Ground cover: clumps with litter in the gaps and a blade grain running
   * through them.
   *
   * **This is the surface Hollowmere's environment gave up on**, and the note
   * there was right about the cause — 22-unit discs at a 4.5 m tile put
   * half-metre pale scales under the player. What it needed was not smaller
   * discs but a different shape: clumps that meet each other, no silhouette,
   * and most of the variation at blade scale rather than at clump scale.
   */
  turf: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    const warpU = lattice(8, 0x70f1);
    const warpV = lattice(8, 0x70f2);
    const clumps = cells(16, 0x70f13);
    const blades = lattice(34, 0x70f14);
    const patch = octaves(0x70f15, 3, 6);
    const litter = octaves(0x70f16, 2, 90);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.07;
        const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.07;
        cellsAt(clumps, wu, wv, hitA);

        // **Blades, and which way they lie.** One lattice sampled six times
        // finer across the grain than along it comes out as streaks rather than
        // as blobs, and each clump gets one of three directions — so the grass
        // changes its lie at a clump boundary the way a field does, instead of
        // combing the whole valley one way.
        //
        // The three are integer combinations of u and v, and that is not
        // decoration: the lattice wraps by whole cells, so it stays periodic
        // under any coordinate whose value shifts by a whole number when u or v
        // does. Integer combinations are exactly that set, which is why a
        // diagonal lie is free here and an arbitrary rotation would tear the
        // seam open.
        const lie = hitA.roll * 3;
        const grain =
          lie < 1
            ? latticeAt(blades, (u - v) * 6, (u + v) * 1)
            : lie < 2
              ? latticeAt(blades, (u + v) * 6, (u - v) * 1)
              : latticeAt(blades, u * 6, v * 1);
        const broad = spread(fbmAt(patch, u, v), 1.9);
        const dead = fbmAt(litter, u, v);

        // The clump is relief and almost nothing else; a meadow seen from
        // standing height has no silhouettes in it, only a change of lie.
        const body = smoothstep(0.01, 0.3, hitA.f2 - hitA.f1);
        height[i] = clamp01(
          body * (0.26 + hitA.roll * 0.24) + grain * 0.3 + dead * 0.08,
        );
        tone[i] =
          0.32 +
          broad * 0.34 + // where the field is greener
          (grain - 0.5) * 0.62 + // the blades themselves — the loudest term
          (dead - 0.5) * 0.16 +
          (hitA.roll - 0.5) * 0.08 -
          (1 - body) * 0.14; // litter and shade between the clumps
      }
    }
    return field;
  },

  /**
   * A woodland floor under maples: soft earth, moss in the damp, and the
   * leaves that fell last week gone to rust in drifts across it.
   *
   * **There is no cell field in the SOIL, and that is the surface.** `dirt`
   * is ground that has dried and pulled apart into plates, and under a low
   * sun those plates are what a player sees — a cracked pan, which is not
   * what the ground under a canopy is. Earth that is shaded, damp and
   * covered every autumn stays soft: its relief is smooth undulation with a
   * fine crumb over it, and nothing in it has an edge.
   *
   * **The ladder is three ladders end to end** (`inBand`): five levels of
   * soil, two of moss, two of litter, each derived from the map's own
   * `floorColor` — a surface still owns no colour, only which way each of its
   * three materials moves away from the one it is given. So the tone written
   * here is a band first and a level inside it second.
   *
   * The tile is 5.5 m, so the scales below read against ~1.07 cm per texel.
   */
  loam: (): Field => {
    const field = blankField();
    const { tone, height } = field;
    const warpU = lattice(8, 0x10a1);
    const warpV = lattice(8, 0x10a2);
    // The undulation: six cells over the tile is a ~90 cm swell, three
    // octaves down to ~23 cm. Plain fBm, not folded — folding is what creases
    // soil into crumb with a groove round every lump, and this has none.
    const swell = octaves(0x10a3, 3, 6);
    // The CLODS: twelve cells over the tile, three octaves, lands them at 46,
    // 23 and 11 cm — turned earth that has settled, which is the relief this
    // surface is carved from. See where it is shaped, below, for why these
    // are mounds and not plates.
    const clods = octaves(0x10aa, 3, 12);
    // The crumb over it, folded and quiet: 11 and 6 cm.
    const crumb = octaves(0x10a4, 2, 48);
    // Grain for the stipple, 4 and 2 cm.
    const grit = octaves(0x10a5, 2, 128);
    // Where the moss is: a ~80 cm field, so a cushion is a patch at the
    // player's feet and a mottle across a court. At 1.4 m the cushions were
    // a scatter of same-sized spots that advertised the tile from anywhere
    // further than ten metres off: a tile cannot carry a feature much past a
    // sixth of itself on open ground.
    const mossField = octaves(0x10a6, 3, 7);
    // The moss's own nap, 3 and 1.5 cm — velvet rather than crumb.
    const nap = octaves(0x10a7, 2, 180);
    // Leaves — the one place this file draws a SHAPE on purpose, because a
    // leaf is an object and is meant to be read as one; the no-silhouettes
    // rule is about soil that came back as pancakes, not about litter.
    // Forty cells over the tile is a 14 cm cell, and a leaf fills
    // most of one: a maple leaf is 8–12 cm across, and at this tile that is
    // ~20 texels, which is enough for the five lobes to survive filtering at
    // the player's feet. The jitter is held under 1 so neighbouring sites keep
    // their distance and a leaf is not clipped by the next cell's border more
    // than an overlap would clip it anyway.
    const leaves = cells(40, 0x10a8, 0.7);
    // Where they have DRIFTED: leaves on a floor are wind-sorted into
    // windrows and pockets, and an even scatter is the one arrangement no
    // autumn produces — the argument `dirt` makes about its grit.
    const drift = octaves(0x10a9, 2, 5);

    for (let y = 0; y < SIZE; y++) {
      const v = y / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = x / SIZE;
        const i = y * SIZE + x;

        const wu = u + (latticeAt(warpU, u, v) - 0.5) * 0.05;
        const wv = v + (latticeAt(warpV, u, v) - 0.5) * 0.05;

        const soft = spread(fbmAt(swell, wu, wv), 1.5);
        const lump = billowAt(crumb, wu, wv);
        const g = fbmAt(grit, u, v);

        // **The soil is MOUNDS, and their shape is the whole difference from
        // `dirt`.** A clod field is gently spread fBm bent by a smoothstep,
        // which has no slope at EITHER end: a crest is a rounded shoulder and
        // a hollow is a rounded dish between two of them — lumps a low sun
        // lights on one side and shades on the other, with nothing in it that
        // runs on as a groove. `dirt` gets the same read out of tilted PLATES,
        // and a plate has an edge; a mound does not, which is what keeps this
        // earth rather than a dried pan.
        //
        // **The dish is load-bearing.** Bent by `1 - (1 - m)^2` instead —
        // round on top, steep at the bottom — and spread hard enough to clamp,
        // every minimum of the noise became a narrow flat-floored pit, and the
        // relief's own shadow and cavity filled each one black: a lawn of
        // holes. A hollow may be deep; it may not be narrow at the bottom.
        //
        // The range is spent deliberately all the same. The relief is carved
        // as a DEPTH (`CONFIG.graphics.relief`), so a field held in a narrow
        // band in the middle — which this first was — is a centimetre of
        // parallax at any `bumpScale`: the crests here reach ~0.85, the moss's
        // crowns above them ~0.9, and the hollows bottom out near 0.3.
        const m = spread(fbmAt(clods, wu, wv), 1.45);
        const mound = m * m * (3 - 2 * m);
        const bed = 0.3 + mound * 0.52 + (soft - 0.5) * 0.12;
        let h = bed + (lump - 0.5) * 0.09 + (g - 0.5) * 0.04;

        // MOSS holds the damp, so it favours the hollows: the mask is biased
        // by how low the swell is. Its edge is dithered by the grain, which is
        // what turns the band boundary into a stipple rather than a contour.
        // The crumb frays the edge, so no two cushions share a silhouette.
        const damp =
          fbmAt(mossField, wu, wv) + (0.5 - soft) * 0.22 + (lump - 0.5) * 0.14;
        const mossy = damp + (g - 0.5) * 0.06 > 0.6;
        // The cushion rises softly over its last few centimetres rather than
        // standing up as a step, which carved would read as a kerb.
        //
        // A cushion is a PILLOW over the clods rather than a coat on them: it
        // fills the hollows and rounds over the crests, crowning just over the
        // highest soil so the moss is the top of the relief wherever it grows
        // and its edge is a soft shoulder the self-shadow can find.
        const cushion = smoothstep(0.55, 0.68, damp);
        const velvet = fbmAt(nap, u, v);
        const pillow = Math.max(
          0.8 + (soft - 0.5) * 0.14 + (velvet - 0.5) * 0.06,
          bed + 0.06,
        );
        h = h * (1 - cushion) + pillow * cushion;

        // A LEAF: a five-lobed star about its site, turned by its own roll.
        // Only a share of the cells carry one, set by the drift — a quarter in
        // a windrow, almost none on the open floor.
        cellsAt(leaves, u, v, hitB);
        const drifted = smoothstep(0.42, 0.7, fbmAt(drift, u, v));
        const keep = 0.996 - drifted * 0.24;
        let leaf = 0;
        let leafLevel = 0;
        if (hitB.roll > keep) {
          // The one roll is spent three ways; the fractions of its multiples
          // are as good as three draws for a pattern nobody inspects that
          // closely, and they stay tied to the cell by construction.
          const r2 = (hitB.roll * 7.31) % 1;
          const r3 = (hitB.roll * 13.7) % 1;
          const turn = r2 * Math.PI * 2;
          const ang = Math.atan2(hitB.dy, hitB.dx) - turn;
          // Pointed lobes with deep sinuses between them: a rounded lobe
          // reads as a PETAL, and a floor of those is a flower bed.
          const lobes = 0.5 + 0.5 * Math.abs(Math.cos(2.5 * ang)) ** 1.6;
          const reach = (0.28 + r3 * 0.18) * lobes;
          leaf = smoothstep(reach, reach - 0.06, hitB.f1);
          leafLevel = (hitB.roll * 29.3) % 1;
          // A leaf lies ON the soil: it covers the crumb under it and stands
          // no higher than the bed does, so it drops no shadow speck.
          const under = bed * (1 - cushion) + pillow * cushion;
          h = h * (1 - leaf) + (under + 0.02) * leaf;
        }

        height[i] = clamp01(h);

        if (leaf > 0.5) {
          tone[i] = inBand(leafLevel + (g - 0.5) * 0.3, 7, 2, 9);
        } else if (mossy) {
          tone[i] = inBand(
            0.5 + (velvet - 0.5) * 1.1 + (soft - 0.5) * 0.4,
            5,
            2,
            9,
          );
        } else {
          // The soil keeps `dirt`'s ordering for `dirt`'s reason: the grain
          // is the loudest term, and the mound only tips it — dark in the
          // hollows, dry on the crowns — so damp and dry read as a tendency
          // rather than as blotches.
          tone[i] = inBand(
            0.46 + (mound - 0.5) * 0.36 + (lump - 0.5) * 0.2 + (g - 0.5) * 0.7,
            0,
            5,
            9,
          );
        }
      }
    }
    return field;
  },
} as const;

/**
 * Which floor patterns exist, derived from the recipes above so the id is
 * declared exactly once. `floorSurfaces.ts` keys its tuning table off this,
 * which is what makes a new pattern a compile error until it is tuned.
 */
export type FloorPatternId = keyof typeof FIELDS;

/**
 * Each surface's ladder. Levels, spread and warmth are the surface's own
 * argument about what it is made of — soil dries warm and damps cool, gravel
 * is stone and swings wider than it warms, sand is nearly one tone, turf
 * greens as it lightens (a negative warm, which is the blue-green end).
 *
 * **Every ladder tops out at or under 1.3, and that is now a description of
 * these numbers rather than a rule binding the next one.** What set it was the
 * old screen-space shafts: their luminance threshold WAS the whole occlusion
 * test and it was calibrated against the cobbled street, so a floor brighter
 * than that street stopped being an occluder and started shedding shafts off
 * open ground. `Volumetrics` asks the shadow map, so nothing in the world can
 * radiate any more and that pressure is off. The values have not been raised,
 * because they were also chosen to look right — but a new surface that wants a
 * brighter top has only the look to answer to.
 */
const PALETTES: Record<FloorPatternId, (base: string) => Rgb[]> = {
  dirt: (base) => ramp(base, 6, 0.72, 1.26, -0.012, 0.03),
  gravel: (base) => ramp(base, 6, 0.58, 1.3),
  sand: (base) => ramp(base, 5, 0.86, 1.22, 0, 0.02),
  turf: (base) => ramp(base, 6, 0.68, 1.24, 0.01, -0.05),
  // Soil, then moss (green up, blue down: olive, not teal), then litter
  // (red up, green and blue down: rust). Nine levels, banded by the field.
  loam: (base) => [
    ...ramp(base, 5, 0.74, 1.2, -0.01, 0.025),
    tintRgb(base, 0.9, [0.94, 1.18, 0.72]),
    tintRgb(base, 1.04, [0.94, 1.18, 0.72]),
    tintRgb(base, 0.92, [1.6, 0.96, 0.72]),
    tintRgb(base, 1.08, [1.6, 0.96, 0.72]),
  ],
};

/* ------------------------------------------------------------------------ *
 * Textures
 * ------------------------------------------------------------------------ */

/** Generated textures are per-scene and built once, on first use. */
const cache = new WeakMap<Scene, Map<string, DynamicTexture>>();

function getGenerated(
  scene: Scene,
  key: string,
  draw: (ctx: Ctx) => void,
): DynamicTexture {
  let byKey = cache.get(scene);
  if (!byKey) {
    byKey = new Map();
    cache.set(scene, byKey);
  }
  let tex = byKey.get(key);
  if (!tex) {
    tex = new DynamicTexture(key, { width: SIZE, height: SIZE }, scene, true);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    // Ground textures are viewed at grazing angles constantly; without
    // anisotropy the pattern shimmers and there is no post AA to hide it.
    tex.anisotropicFilteringLevel = 8;
    tex.hasAlpha = false;
    draw(tex.getContext());
    tex.update();
    byKey.set(key, tex);
  }
  return tex;
}

/** The village street cobblestone: irregular setts in dark mortar. */
export function getCobblestoneTexture(scene: Scene): DynamicTexture {
  return getGenerated(scene, "cobblestone", (ctx) =>
    paintAlbedo(ctx, fieldOf("cobble", cobbleField).tone, COBBLE_PALETTE),
  );
}

/**
 * Matching height map for the cobblestone albedo — the same field, so every
 * crown sits on the sett it belongs to and the mortar stays a groove.
 */
export function getCobblestoneBumpTexture(scene: Scene): DynamicTexture {
  return getGenerated(scene, "cobblestone-bump", (ctx) =>
    paintHeight(ctx, fieldOf("cobble", cobbleField).height),
  );
}

/**
 * A carriageway's albedo in the road palette's own colour for that surface.
 *
 * The base is a module constant in `kit/core.ts` rather than the map's, so
 * unlike the floor's this key would be one string however it were written — it
 * carries the colour anyway, because the day a map is allowed to re-tint its
 * own streets the cache is the one place that would go quietly wrong.
 */
export function getRoadTexture(
  scene: Scene,
  id: RoadPatternId,
  baseHex: string,
): DynamicTexture {
  return getGenerated(scene, `road-${id}-${baseHex}`, (ctx) =>
    paintAlbedo(
      ctx,
      fieldOf(`road-${id}`, ROAD_FIELDS[id]).tone,
      ROAD_PALETTES[id](baseHex),
    ),
  );
}

/**
 * The height map matching that albedo, keyed WITHOUT the colour for the floor's
 * reason: the field reads none, so every tint of one carriageway shares one
 * bump map.
 */
export function getRoadBumpTexture(
  scene: Scene,
  id: RoadPatternId,
): DynamicTexture {
  return getGenerated(scene, `road-${id}-bump`, (ctx) =>
    paintHeight(ctx, fieldOf(`road-${id}`, ROAD_FIELDS[id]).height),
  );
}

/**
 * A floor pattern's albedo in this map's own floor colour.
 *
 * The cache key carries the colour, so two maps on the same pattern in
 * different soils are two textures rather than whichever asked first — the trap
 * `CelMaterialFactory`'s spec registry documents from the other side.
 */
export function getFloorTexture(
  scene: Scene,
  id: FloorPatternId,
  baseHex: string,
): DynamicTexture {
  return getGenerated(scene, `floor-${id}-${baseHex}`, (ctx) =>
    paintAlbedo(ctx, fieldOf(id, FIELDS[id]).tone, PALETTES[id](baseHex)),
  );
}

/**
 * The height map matching that albedo. Keyed WITHOUT the colour: the field is
 * seeded per surface and reads none, so every tint of one pattern shares one
 * bump map.
 */
export function getFloorBumpTexture(
  scene: Scene,
  id: FloorPatternId,
): DynamicTexture {
  return getGenerated(scene, `floor-${id}-bump`, (ctx) =>
    paintHeight(ctx, fieldOf(id, FIELDS[id]).height),
  );
}
