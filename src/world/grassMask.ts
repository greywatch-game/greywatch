/**
 * grassMask.ts — Where grass grows, how thick and how tall, and the ground it
 * grows from, baked once per map into one texture's worth of bytes.
 * Owns: rasterising a map's GrassRects into a density/height/ground grid, the
 * frayed EDGE of the fields they make together, the refusals a field makes (a
 * carriageway, the inside of a collider) and what water makes of it (reeds),
 * and the per-PATCH summary the GrassSystem culls with.
 * Invariants: pure — no scene, no Babylon, no randomness — so every client
 * bakes the same field off the same layout. The ground height is
 * `TerrainField.heightAt` plus the rect's `y`, sampled at texel centres; the
 * patch grid is anchored on multiples of `CONFIG.grass.patch` in WORLD space,
 * so a blade's position does not move when the mask's extent does.
 * Must never: be read by anything that decides gameplay. Grass is visual
 * only; a ray, a bot and the authority have never heard of this file.
 *
 * WHY A MASK AND NOT A LIST OF TUFTS. The field used to be one instance
 * matrix per tuft, scattered over every rect at load and drawn every frame
 * wherever the camera stood — so its cost was its AREA, and every map's grass
 * was a budget spread as thin as its ground was wide (0.1 tufts per m² on the
 * island). A mask costs a byte quad per half-metre whatever is drawn over it,
 * and the blades are placed on the GPU around the eye, so a hillside costs
 * what can be SEEN of it and no more.
 */
import { CONFIG } from "../config";
import { type LocalXZ, rotateToLocalXZ } from "./boxGeometry";
import type { GrassRect, WaterRect, WorldBox } from "./MapBuilder";
import { onRoad, type RoadFootprint } from "./roads";
import { type TerrainField, waterY } from "./TerrainField";

/** How high an encoded height channel goes: two bytes. */
const HEIGHT_STEPS = 65535;
/** The largest `GrassRect.height` the alpha channel can carry. */
export const MAX_HEIGHT_SCALE = 2;
/** The alpha channel's steps for the height multiplier; its top bit is WET. */
const SCALE_STEPS = 127;
const WET_BIT = 128;

/**
 * The baked field.
 *
 * `data` is RGBA8, row-major from the min-Z edge: R and G are the ground's
 * height as a 16-bit fixed-point number over `yMin..yMax` (high byte first),
 * B is density 0..1, and A's low seven bits are the height multiplier over
 * `0..MAX_HEIGHT_SCALE` while its top bit says the ground is UNDER WATER —
 * where blades grow as reeds and the turf does not grow at all. A texel's
 * value is its CENTRE's.
 */
export interface GrassMask {
  /** World position of the grid's min corner, and metres per texel. */
  x0: number;
  z0: number;
  texel: number;
  nx: number;
  nz: number;
  data: Uint8Array;
  yMin: number;
  yMax: number;
  /** One entry per patch, row-major; `patch` metres a side from (x0, z0). */
  patches: {
    nx: number;
    nz: number;
    /** The densest texel that can reach the patch, 0 for a bare one. */
    cover: Float32Array;
    /** The lowest and highest ground under it, and its tallest multiplier. */
    yLo: Float32Array;
    yHi: Float32Array;
    tall: Float32Array;
  };
}

/** Scratch for the box-frame transform below; the bake runs it per texel per box. */
const localScratch: LocalXZ = { lx: 0, lz: 0 };

/** A lattice hash, 0..1 — integer arithmetic, so every client bakes the same edge. */
function hash2(ix: number, iz: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1, one lattice cell per unit. */
function valueNoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Bakes the field. Null when there is nothing to grow — no rects, or rects
 * that lie wholly outside the ground.
 *
 * `extent` is how far the ground runs from the origin on each axis (half the
 * map plus its borderland margin): a rect is clipped to it rather than
 * growing grass over nothing.
 */
export function bakeGrassMask(
  rects: readonly GrassRect[],
  water: readonly WaterRect[],
  boxes: readonly WorldBox[],
  roads: RoadFootprint,
  terrain: TerrainField,
  extent: number,
): GrassMask | null {
  const g = CONFIG.grass;
  const P = g.patch;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const r of rects) {
    if ((r.density ?? 1) <= 0) continue;
    minX = Math.min(minX, r.x - r.width / 2);
    maxX = Math.max(maxX, r.x + r.width / 2);
    minZ = Math.min(minZ, r.z - r.depth / 2);
    maxZ = Math.max(maxZ, r.z + r.depth / 2);
  }
  minX = Math.max(minX, -extent);
  minZ = Math.max(minZ, -extent);
  maxX = Math.min(maxX, extent);
  maxZ = Math.min(maxZ, extent);
  if (!(maxX > minX && maxZ > minZ)) return null;

  // Snapped OUT to whole patches, in world space: every patch is then a whole
  // number of patches from the origin, which is what keeps the blade pattern
  // pinned to the ground when a rect is added somewhere else on the map.
  const x0 = Math.floor(minX / P) * P;
  const z0 = Math.floor(minZ / P) * P;
  const px = Math.ceil((maxX - x0) / P);
  const pz = Math.ceil((maxZ - z0) / P);
  const w = px * P;
  const d = pz * P;
  const texel = Math.max(g.texel, Math.max(w, d) / g.maxTexels);
  const nx = Math.ceil(w / texel);
  const nz = Math.ceil(d / texel);

  const density = new Float32Array(nx * nz);
  const tall = new Float32Array(nx * nz);
  const wet = new Uint8Array(nx * nz);
  const pools = water.map((r) => ({ r, y: waterY(r, terrain) }));
  const ground = new Float32Array(nx * nz);
  const lift = new Float32Array(nx * nz);
  const edgeOf = new Float32Array(nx * nz);

  // 1. The rects: density adds where they overlap, capped at 1, and the
  //    tallest and highest-standing rect over a texel is the one it grows as.
  for (const r of rects) {
    const dens = r.density ?? 1;
    if (dens <= 0) continue;
    const i0 = Math.max(0, Math.floor((r.x - r.width / 2 - x0) / texel));
    const i1 = Math.min(nx - 1, Math.ceil((r.x + r.width / 2 - x0) / texel));
    const j0 = Math.max(0, Math.floor((r.z - r.depth / 2 - z0) / texel));
    const j1 = Math.min(nz - 1, Math.ceil((r.z + r.depth / 2 - z0) / texel));
    const hx = r.width / 2;
    const hz = r.depth / 2;
    const scale = Math.min(MAX_HEIGHT_SCALE, Math.max(0, r.height ?? 1));
    const edge = Math.max(0, r.edge ?? g.edge);
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * texel;
      if (Math.abs(z - r.z) > hz || Math.abs(z) > extent) continue;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * texel;
        if (Math.abs(x - r.x) > hx || Math.abs(x) > extent) continue;
        const k = j * nx + i;
        density[k] = Math.min(1, density[k] + dens);
        tall[k] = Math.max(tall[k], scale);
        lift[k] = Math.max(lift[k], r.y ?? 0);
        edgeOf[k] = Math.max(edgeOf[k], edge);
      }
    }
  }

  // 1b. The field's EDGE. A rect is a rectangle and no field is, so the
  //     ground the rects cover is thinned toward where it ends, along a line
  //     that wanders — `edge` metres deep, on a wave `edgeWave` long.
  //
  //     **It is the UNION's edge and never a rect's**, and that is the whole
  //     of the design: two fields laid edge to edge are one field, and a
  //     feather per rect would open a bare seam down every join. So what is
  //     measured is each texel's distance to the nearest texel NO rect covers
  //     (a two-pass chamfer over the grid, the grid's own border counting as
  //     bare), and a carriageway or a wall is not in that test — the grass
  //     stops against those as sharply as it ever did.
  // Only distances up to twice the deepest edge are ever read, so the passes
  // clamp there: past it a texel's answer is "deep inside", whatever it is.
  let deepest = 0;
  for (let k = 0; k < edgeOf.length; k++) deepest = Math.max(deepest, edgeOf[k]);
  const far = Math.ceil((2 * deepest) / texel) + 2;
  const dist = new Float32Array(nx * nz);
  for (let k = 0; k < dist.length; k++) dist[k] = density[k] > 0 ? far : 0;
  const D = Math.SQRT2;
  // Forward: left, up, and the two diagonals above. Off the grid is bare.
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
      const k = row + i;
      let v = dist[k];
      if (v === 0) continue;
      const l = i > 0 ? dist[k - 1] : 0;
      if (l + 1 < v) v = l + 1;
      if (j === 0) {
        v = Math.min(v, 1);
      } else {
        const u = dist[k - nx];
        if (u + 1 < v) v = u + 1;
        const ul = i > 0 ? dist[k - nx - 1] : 0;
        if (ul + D < v) v = ul + D;
        const ur = i < nx - 1 ? dist[k - nx + 1] : 0;
        if (ur + D < v) v = ur + D;
      }
      dist[k] = v;
    }
  }
  // Backward: right, down, and the two diagonals below.
  for (let j = nz - 1; j >= 0; j--) {
    const row = j * nx;
    for (let i = nx - 1; i >= 0; i--) {
      const k = row + i;
      let v = dist[k];
      if (v === 0) continue;
      const r = i < nx - 1 ? dist[k + 1] : 0;
      if (r + 1 < v) v = r + 1;
      if (j === nz - 1) {
        v = Math.min(v, 1);
      } else {
        const b = dist[k + nx];
        if (b + 1 < v) v = b + 1;
        const br = i < nx - 1 ? dist[k + nx + 1] : 0;
        if (br + D < v) v = br + D;
        const bl = i > 0 ? dist[k + nx - 1] : 0;
        if (bl + D < v) v = bl + D;
      }
      dist[k] = v;
    }
  }
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * texel;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const e = edgeOf[k];
      if (density[k] <= 0 || e <= 0) continue;
      // Metres from the texel to the bare ground, less the half texel between
      // a bare texel's centre and where its ground actually starts.
      const d = (dist[k] - 0.5) * texel;
      if (d >= 2 * e) continue;
      const x = x0 + (i + 0.5) * texel;
      const t = (d - e * valueNoise(x / g.edgeWave, z / g.edgeWave)) / e;
      density[k] *= t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
    }
  }

  // 2. The ground under it, and the roads. A carriageway is sampled on a 2x2
  //    grid inside the texel so its edge is a coverage rather than a staircase:
  //    the filtered field then feathers into the verge over half a metre. Only
  //    texels something grows in pay for either.
  const q = texel / 4;
  // Whether a road comes anywhere near each PATCH, asked once per patch with
  // a pad of half its diagonal: a texel in a patch no road reaches never asks.
  const roadNear = new Uint8Array(px * pz);
  for (let b = 0; b < pz; b++) {
    for (let a = 0; a < px; a++) {
      const cx = x0 + (a + 0.5) * P;
      const cz = z0 + (b + 0.5) * P;
      roadNear[b * px + a] = onRoad(roads, cx, cz, P * Math.SQRT1_2 + texel) ? 1 : 0;
    }
  }
  for (let j = 0; j < nz; j++) {
    const z = z0 + (j + 0.5) * texel;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = x0 + (i + 0.5) * texel;
      if (Math.abs(x) > extent || Math.abs(z) > extent) density[k] = 0;
      if (density[k] <= 0) continue;
      ground[k] = terrain.heightAt(x, z) + lift[k];
      // Under water a field is a REED BED: thinner, taller so it breaks the
      // surface, and with no turf — a sheet of meadow under a clear channel is
      // a lawn growing underwater. A rect laid over a pool is how every map
      // puts reeds round its shore, so this is the common case, not an edge.
      for (const { r, y } of pools) {
        if (
          ground[k] < y &&
          Math.abs(x - r.x) <= r.width / 2 &&
          Math.abs(z - r.z) <= r.depth / 2
        ) {
          wet[k] = 1;
          density[k] *= CONFIG.grass.reeds.density;
          tall[k] = Math.max(tall[k], CONFIG.grass.reeds.height);
          break;
        }
      }
      // Two cheaper questions first — the patch, then this texel padded by
      // one — because nearly every texel is nowhere near a road, and the four
      // below were most of what this bake cost.
      const pa = Math.min(px - 1, Math.floor((x - x0) / P));
      const pb = Math.min(pz - 1, Math.floor((z - z0) / P));
      if (!roadNear[pb * px + pa]) continue;
      if (!onRoad(roads, x, z, texel)) continue;
      let paved = 0;
      if (onRoad(roads, x - q, z - q, 0)) paved++;
      if (onRoad(roads, x + q, z - q, 0)) paved++;
      if (onRoad(roads, x - q, z + q, 0)) paved++;
      if (onRoad(roads, x + q, z + q, 0)) paved++;
      if (paved > 0) density[k] *= 1 - paved / 4;
    }
  }

  // 3. The colliders: a texel inside one grows nothing. Rasterised box by box
  //    over each footprint rather than asked per texel, so the cost is the
  //    area the WORLD covers and not the area the field does. Padded by most of
  //    a texel, so the feathered edge the filter makes lies outside the wall
  //    rather than straddling it — a blade poking through a cottage's wall
  //    reads as a bug, and a slightly thinner edge against it as trampling.
  const pad = texel * 0.75;
  const maxH = g.heightMax * MAX_HEIGHT_SCALE;
  for (const b of boxes) {
    const reach = Math.hypot(b.w, b.d) / 2 + pad;
    const i0 = Math.max(0, Math.floor((b.cx - reach - x0) / texel));
    const i1 = Math.min(nx - 1, Math.ceil((b.cx + reach - x0) / texel));
    const j0 = Math.max(0, Math.floor((b.cz - reach - z0) / texel));
    const j1 = Math.min(nz - 1, Math.ceil((b.cz + reach - z0) / texel));
    if (i0 > i1 || j0 > j1) continue;
    // A tilted box (rotX ramps) spans a taller band than its thickness.
    let halfH = b.h / 2;
    if (b.rotX !== 0) halfH += (Math.abs(Math.sin(b.rotX)) * b.d) / 2;
    const bottom = b.cy - halfH;
    const top = b.cy + halfH;
    const hw = b.w / 2 + pad;
    const hd = b.d / 2 + pad;
    for (let j = j0; j <= j1; j++) {
      const z = z0 + (j + 0.5) * texel;
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (density[k] <= 0) continue;
        const y = ground[k];
        // The 0.05 tolerance matters: a collider whose top sits within 5 cm
        // of the ground IS the ground — a terrace top or a jetty deck — and
        // without it every blade standing on one refuses itself.
        if (y + maxH * Math.max(tall[k], 0.25) <= bottom + 0.05 || y >= top - 0.05) continue;
        const x = x0 + (i + 0.5) * texel;
        const { lx, lz } = rotateToLocalXZ(b, x, z, localScratch);
        if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) density[k] = 0;
      }
    }
  }

  // 4. Encode, and summarise per patch.
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let k = 0; k < density.length; k++) {
    if (density[k] <= 0) continue;
    yMin = Math.min(yMin, ground[k]);
    yMax = Math.max(yMax, ground[k]);
  }
  if (!(yMax >= yMin)) return null;
  // A flat field still needs a range to divide by.
  if (yMax - yMin < 1) yMax = yMin + 1;
  const span = yMax - yMin;

  const data = new Uint8Array(nx * nz * 4);
  for (let k = 0; k < density.length; k++) {
    const dens = density[k];
    const o = k * 4;
    if (dens <= 0) {
      // Bare texels still carry a height, so the filtered ground a blade on
      // the edge of a field reads is the neighbour's rather than yMin's.
      data[o + 2] = 0;
      data[o + 3] = 0;
      continue;
    }
    const h = Math.round(((ground[k] - yMin) / span) * HEIGHT_STEPS);
    data[o] = h >> 8;
    data[o + 1] = h & 255;
    data[o + 2] = Math.round(dens * 255);
    data[o + 3] =
      Math.round((Math.min(tall[k], MAX_HEIGHT_SCALE) / MAX_HEIGHT_SCALE) * SCALE_STEPS) +
      (wet[k] ? WET_BIT : 0);
  }
  // Bare texels borrow the height of a grown neighbour: bilinear filtering of
  // the ground at a field's edge must not drag a blade down to `yMin`. Two
  // passes of a 4-neighbour fill cover the one texel the filter reaches.
  const known = new Uint8Array(nx * nz);
  for (let k = 0; k < density.length; k++) known[k] = density[k] > 0 ? 1 : 0;
  for (let pass = 0; pass < 2; pass++) {
    const was = known.slice();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (was[k]) continue;
        const n =
          i > 0 && was[k - 1] ? k - 1
          : i < nx - 1 && was[k + 1] ? k + 1
          : j > 0 && was[k - nx] ? k - nx
          : j < nz - 1 && was[k + nx] ? k + nx
          : -1;
        if (n < 0) continue;
        known[k] = 1;
        data[k * 4] = data[n * 4];
        data[k * 4 + 1] = data[n * 4 + 1];
      }
    }
  }

  const cover = new Float32Array(px * pz);
  const yLo = new Float32Array(px * pz).fill(Infinity);
  const yHi = new Float32Array(px * pz).fill(-Infinity);
  const tallest = new Float32Array(px * pz);
  const perPatch = P / texel;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (density[k] <= 0) continue;
      // A texel reaches every patch its filter footprint touches: itself and
      // the one either side across a patch boundary.
      const fi = (i + 0.5) / perPatch;
      const fj = (j + 0.5) / perPatch;
      const a0 = Math.max(0, Math.floor(fi - 1 / perPatch));
      const a1 = Math.min(px - 1, Math.floor(fi + 1 / perPatch));
      const b0 = Math.max(0, Math.floor(fj - 1 / perPatch));
      const b1 = Math.min(pz - 1, Math.floor(fj + 1 / perPatch));
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const p = b * px + a;
          cover[p] = Math.max(cover[p], density[k]);
          yLo[p] = Math.min(yLo[p], ground[k]);
          yHi[p] = Math.max(yHi[p], ground[k]);
          tallest[p] = Math.max(tallest[p], tall[k]);
        }
      }
    }
  }

  return {
    x0,
    z0,
    texel,
    nx,
    nz,
    data,
    yMin,
    yMax,
    patches: { nx: px, nz: pz, cover, yLo, yHi, tall: tallest },
  };
}
