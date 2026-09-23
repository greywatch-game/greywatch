/**
 * wgsl/giTrace.ts — The irradiance volume's three compute shaders, as WGSL
 * source built per quality tier.
 * Owns: the scene layout the three share (`GI_LAYOUT`), the box, heightfield
 * and grid intersections they trace against, and each pass's body.
 * Invariants: every buffer offset here is a number `GiVolume` writes at the
 * same offset — both halves read `GI_LAYOUT`, and nothing else may state one.
 * The box transform is `RayWorld.boxCast`'s to the letter (yaw, then pitch,
 * the far face for a ray starting inside), because the trace stands in for
 * the same colliders every round in the game stops on.
 * Contract: `docs/rendering.md`, "The irradiance volume".
 *
 * WHY COMPUTE, AND WHY AGAINST THE COLLIDERS. What makes a Lumen-class answer
 * affordable in a browser is having a scene the GPU can trace that is far
 * cheaper than the one it draws, and this game already has one: every surface
 * a round can stop on is a box in `colliderBoxes` or the heightfield, which is
 * what `RayWorld` answers every ray on the CPU off. The trace below is that
 * query ported to WGSL — the same uniform grid over the same boxes, the same
 * oriented-box slab test — so the volume's idea of where the walls are is the
 * game's, and nothing mesh-shaped is ever traced.
 *
 * THE THREE PASSES, and why they are three.
 *
 * - **trace** — one WORKGROUP per probe and one thread per ray, re-tracing a
 *   rolling slice of the window each frame. Each ray finds what it hits, lights
 *   the hit with the sun (shadow-tested), the steady fixtures (visibility-
 *   tested) and the volume itself (its HISTORY, read from the state buffer
 *   and never from compose's textures, which carry the fast layer — that is
 *   what makes the bounce multi-bounce without ever remembering a flash),
 *   and the workgroup reduces the lot to
 *   order-1 spherical harmonics blended into the probe's history.
 * - **compose** — one thread per probe, EVERY frame: the history plus the FAST
 *   layer (this frame's muzzle flashes, blasts and fires, re-bounced from
 *   scratch so the bounce lives and dies with the flash) written to the three
 *   textures the cel shader samples.
 * - **vis** — one thread per probe, every frame: which of the sixteen lights
 *   holding a slot each probe can see, into four more textures — kept in a
 *   buffer between frames and re-traced only for a light that is new or moved.
 *
 * They are separate because a WebGPU stage may write four storage textures at
 * most, and compose writes three and vis four; and because trace's workgroup
 * shape (a probe per group) is the wrong one for the other two.
 */

/** Hull slots at the front of the box buffer, rewritten every frame. */
export const GI_HULL_SLOTS = 8;
/** Most fast lights one frame may bounce. */
export const GI_MAX_FAST = 8;
/** Most steady fixtures the trace lights its hits with. */
export const GI_MAX_SLOW = 48;
/** Point-light slots — `MAX_POINT_LIGHTS`, restated as a layout fact. */
export const GI_SLOTS = 16;

/**
 * Where everything lives in the params buffer, in vec4s. `GiVolume` fills it
 * and the shaders read it; the numbers are the contract between the two.
 */
export const GI_LAYOUT = {
  scene: 0,
  slow: 16,
  fast: 16 + GI_MAX_SLOW * 2,
  slots: 16 + GI_MAX_SLOW * 2 + GI_MAX_FAST * 2,
  size: 16 + GI_MAX_SLOW * 2 + GI_MAX_FAST * 2 + GI_SLOTS * 2,
} as const;

/** Floats per probe in the state buffer: four vec4s. */
export const GI_STATE_VEC4 = 4;

/**
 * The declarations and the geometry every pass shares.
 *
 * Scene rows (vec4 index from `GI_LAYOUT.scene`):
 *  0: grid origin x, z, cell, dim          1: big count, -, cellBox offset, big offset
 *  2: heightfield n, cell, half, flat      3: sun travel xyz, ray length
 *  4: sun colour, sun ray length           5: ambient, light clearance
 *  6: sky fill, blend                      7: floor albedo, highest ground
 *  8: spacing, columns, layers, layer h    9: slow, fast, -, hull counts
 * 10: window origin column x, z, ref y, probe total    11: cursor
 */
function common(): string {
  const L = GI_LAYOUT;
  return /* wgsl */ `
const SC: u32 = ${L.scene}u;
const SL: u32 = ${L.slow}u;
const FL: u32 = ${L.fast}u;
const PL: u32 = ${L.slots}u;
const HULLS: u32 = ${GI_HULL_SLOTS}u;
const PI: f32 = 3.14159265;
const LUMW: vec3f = vec3f(0.2126, 0.7152, 0.0722);
const BIG: f32 = 1e30;

@group(0) @binding(0) var<storage, read> P: array<vec4f>;
@group(0) @binding(1) var<storage, read> B: array<vec4f>;
@group(0) @binding(2) var<storage, read> I: array<u32>;
@group(0) @binding(3) var<storage, read> H: array<f32>;

// The normal and albedo of the last hit castScene reported.
var<private> gN: vec3f;
var<private> hitN: vec3f;
var<private> hitAlb: vec3f;

fn wrapi(a: i32, n: i32) -> i32 {
  return ((a % n) + n) % n;
}

fn spacing() -> f32 { return P[SC + 8u].x; }
fn columns() -> i32 { return i32(P[SC + 8u].y); }
fn layers() -> i32 { return i32(P[SC + 8u].z); }
fn layerH() -> f32 { return P[SC + 8u].w; }
fn windowOrigin() -> vec2i { return vec2i(i32(P[SC + 10u].x), i32(P[SC + 10u].y)); }

// The world column a texel column stands for: the one congruent to it modulo
// the window's side, inside the window. The whole of the toroidal addressing.
fn columnOf(t: vec2i) -> vec2i {
  let n = columns();
  let o = windowOrigin();
  return o + vec2i(wrapi(t.x - o.x, n), wrapi(t.y - o.y, n));
}

// A probe slot's texel: x across, layer up, z across — the texture's own axes.
fn texelOf(slot: u32) -> vec3i {
  let n = u32(columns());
  let l = u32(layers());
  let tx = slot % n;
  let rest = slot / n;
  let k = rest % l;
  let tz = rest / l;
  return vec3i(i32(tx), i32(k), i32(tz));
}

// The floor under a point, bilinear over the heightfield the terrain was cut
// from. Clamped at the grid's edge: past it the volume is looking at ground it
// will fade out before anybody sees the difference.
fn heightAt(x: f32, z: f32) -> f32 {
  let hf = P[SC + 2u];
  if (hf.w > 0.5) {
    return 0.0;
  }
  let n = hf.x;
  let fx = clamp((x + hf.z) / hf.y, 0.0, n);
  let fz = clamp((z + hf.z) / hf.y, 0.0, n);
  let ni = u32(n);
  let i0 = min(u32(floor(fx)), ni - 1u);
  let j0 = min(u32(floor(fz)), ni - 1u);
  let tx = fx - f32(i0);
  let tz = fz - f32(j0);
  let row = ni + 1u;
  let h00 = H[j0 * row + i0];
  let h10 = H[j0 * row + i0 + 1u];
  let h01 = H[(j0 + 1u) * row + i0];
  let h11 = H[(j0 + 1u) * row + i0 + 1u];
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), tz);
}

fn terrainNormal(x: f32, z: f32) -> vec3f {
  let e = max(P[SC + 2u].y * 0.5, 0.25);
  let hx = heightAt(x - e, z) - heightAt(x + e, z);
  let hz = heightAt(x, z - e) - heightAt(x, z + e);
  return normalize(vec3f(hx, 2.0 * e, hz));
}

// The floor, marched: steps proportional to the height over it, then a short
// bisection once it has been crossed. Not RayWorld's per-triangle walk — a
// bounce is averaged over a hemisphere and the few centimetres between the
// drawn floor and the smooth one are not visible in it.
//
// Two exits before any step is taken, and they are most of what this costs:
// a FLAT map is one plane and is answered in closed form, and a ray climbing
// through air already above the highest ground on the map can never come down
// onto it. The step's floor then grows with distance, because a grazing ray a
// metre over a field would otherwise spend all sixty-four steps a quarter of a
// metre apart and still not have looked past its own feet.
fn marchTerrain(o: vec3f, d: vec3f, maxT: f32) -> f32 {
  if (P[SC + 2u].w > 0.5) {
    if (d.y >= -1e-6) {
      return -1.0;
    }
    let tp = -o.y / d.y;
    return select(-1.0, tp, tp >= 0.0 && tp <= maxT);
  }
  let top = P[SC + 7u].w;
  if (d.y >= 0.0 && o.y > top) {
    return -1.0;
  }
  var gap = o.y - heightAt(o.x, o.z);
  if (gap <= 0.0) {
    return 0.0;
  }
  var t = 0.0;
  var prevT = 0.0;
  for (var i = 0; i < 64; i++) {
    let step = clamp(gap * 0.6, 0.25 + t * 0.06, 4.0);
    t = t + step;
    if (t > maxT) {
      return -1.0;
    }
    let p = o + d * t;
    if (d.y >= 0.0 && p.y > top) {
      return -1.0;
    }
    gap = p.y - heightAt(p.x, p.z);
    if (gap < 0.0) {
      var lo = prevT;
      var hi = t;
      for (var j = 0; j < 5; j++) {
        let mid = 0.5 * (lo + hi);
        let q = o + d * mid;
        if (q.y - heightAt(q.x, q.z) < 0.0) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      return hi;
    }
    prevT = t;
  }
  return -1.0;
}

// RayWorld.boxCast, ported. Writes the world-space outward normal into gN.
fn boxCast(bi: u32, o: vec3f, d: vec3f, maxT: f32) -> f32 {
  let b2 = B[bi * 4u + 2u];
  if (b2.z < 0.5) {
    return -1.0;
  }
  let b0 = B[bi * 4u];
  let b1 = B[bi * 4u + 1u];
  let cy = b0.w;
  let sy = b1.w;
  let cx = b2.x;
  let sx = b2.y;
  let p = o - b0.xyz;
  let f0 = vec3f(p.x * cy - p.z * sy, p.y, p.x * sy + p.z * cy);
  let g0 = vec3f(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
  let f = vec3f(f0.x, f0.y * cx + f0.z * sx, -f0.y * sx + f0.z * cx);
  let g = vec3f(g0.x, g0.y * cx + g0.z * sx, -g0.y * sx + g0.z * cx);
  let h = b1.xyz;
  var tMin = -BIG;
  var tMax = BIG;
  var axisIn = -1;
  var signIn = 0.0;
  var axisOut = -1;
  var signOut = 0.0;
  for (var a = 0; a < 3; a++) {
    let ga = g[a];
    let fa = f[a];
    let ha = h[a];
    if (abs(ga) < 1e-9) {
      if (fa < -ha || fa > ha) {
        return -1.0;
      }
      continue;
    }
    let inv = 1.0 / ga;
    var nr = (-ha - fa) * inv;
    var fr = (ha - fa) * inv;
    if (nr > fr) {
      let s = nr;
      nr = fr;
      fr = s;
    }
    if (nr > tMin) {
      tMin = nr;
      axisIn = a;
      signIn = select(1.0, -1.0, ga > 0.0);
    }
    if (fr < tMax) {
      tMax = fr;
      axisOut = a;
      signOut = select(-1.0, 1.0, ga > 0.0);
    }
    if (tMin > tMax) {
      return -1.0;
    }
  }
  var t = 0.0;
  var axis = -1;
  var sgn = 0.0;
  if (tMin >= 0.0) {
    t = tMin;
    axis = axisIn;
    sgn = signIn;
  } else if (tMax >= 0.0) {
    t = tMax;
    axis = axisOut;
    sgn = signOut;
  } else {
    return -1.0;
  }
  if (t > maxT || axis < 0) {
    return -1.0;
  }
  var l = vec3f(0.0);
  l[axis] = sgn;
  let wy = l.y * cx - l.z * sx;
  let wz = l.y * sx + l.z * cx;
  gN = vec3f(l.x * cy + wz * sy, wy, -l.x * sy + wz * cy);
  return t;
}

fn insideBox(bi: u32, q: vec3f, pad: f32) -> bool {
  let b2 = B[bi * 4u + 2u];
  if (b2.z < 0.5) {
    return false;
  }
  let b0 = B[bi * 4u];
  let b1 = B[bi * 4u + 1u];
  let p = q - b0.xyz;
  let f0 = vec3f(p.x * b0.w - p.z * b1.w, p.y, p.x * b1.w + p.z * b0.w);
  let f = vec3f(f0.x, f0.y * b2.x + f0.z * b2.y, -f0.y * b2.y + f0.z * b2.x);
  return all(abs(f) < b1.xyz + vec3f(pad));
}

fn gridCell(v: f32, originV: f32) -> i32 {
  let g = P[SC];
  let dim = i32(g.w);
  return clamp(i32(floor((v - originV) / g.z)), 0, dim - 1);
}

// Is q inside any collider? The probe relocation's test. The static world
// only: a hull drives away, and a probe it is parked on will be re-traced.
fn insideAny(q: vec3f) -> bool {
  let g = P[SC];
  let dim = i32(g.w);
  let big = u32(P[SC + 1u].x);
  let bigOff = u32(P[SC + 1u].w);
  let cellOff = u32(P[SC + 1u].z);
  for (var k = 0u; k < big; k++) {
    if (insideBox(I[bigOff + k], q, 0.05)) {
      return true;
    }
  }
  if (dim <= 0) {
    return false;
  }
  let c = u32(gridCell(q.z, g.y) * dim + gridCell(q.x, g.x));
  let end = I[c + 1u];
  for (var k = I[c]; k < end; k++) {
    if (insideBox(I[cellOff + k], q, 0.05)) {
      return true;
    }
  }
  return false;
}

// The whole query: hulls, the map-sized boxes, the grid, then the floor —
// RayWorld.cast's order and for its reason, each stage bounding the next.
// anyHit returns on the first thing in the way; otherwise the nearest, with
// its normal and albedo in hitN / hitAlb. -1 is a miss.
fn castScene(o: vec3f, d: vec3f, maxT: f32, anyHit: bool) -> f32 {
  var best = maxT;
  var found = false;
  let hulls = u32(P[SC + 9u].w);
  for (var i = 0u; i < hulls; i++) {
    let t = boxCast(i, o, d, best);
    if (t >= 0.0) {
      if (anyHit) {
        return t;
      }
      best = t;
      found = true;
      hitN = gN;
      hitAlb = B[i * 4u + 3u].rgb;
    }
  }
  let big = u32(P[SC + 1u].x);
  let bigOff = u32(P[SC + 1u].w);
  for (var k = 0u; k < big; k++) {
    let bi = I[bigOff + k];
    let t = boxCast(bi, o, d, best);
    if (t >= 0.0) {
      if (anyHit) {
        return t;
      }
      best = t;
      found = true;
      hitN = gN;
      hitAlb = B[bi * 4u + 3u].rgb;
    }
  }

  let g = P[SC];
  let cellSize = g.z;
  let dim = i32(g.w);
  let cellOff = u32(P[SC + 1u].z);
  if (dim > 0) {
    let xz = length(d.xz);
    var i = gridCell(o.x, g.x);
    var j = gridCell(o.z, g.y);
    var stepI = 0;
    var stepJ = 0;
    var dsI = BIG;
    var dsJ = BIG;
    var sI = BIG;
    var sJ = BIG;
    if (xz > 1e-6) {
      let px = d.x / xz;
      let pz = d.z / xz;
      if (px > 0.0) { stepI = 1; } else if (px < 0.0) { stepI = -1; }
      if (pz > 0.0) { stepJ = 1; } else if (pz < 0.0) { stepJ = -1; }
      if (stepI != 0) {
        dsI = cellSize / abs(px);
        let edge = g.x + f32(select(i, i + 1, stepI > 0)) * cellSize;
        sI = (edge - o.x) / px;
        if (sI < 0.0) { sI = BIG; }
      }
      if (stepJ != 0) {
        dsJ = cellSize / abs(pz);
        let edge = g.y + f32(select(j, j + 1, stepJ > 0)) * cellSize;
        sJ = (edge - o.z) / pz;
        if (sJ < 0.0) { sJ = BIG; }
      }
    }
    var s = 0.0;
    for (var guard = 0; guard < 96; guard++) {
      let c = u32(j * dim + i);
      let end = I[c + 1u];
      for (var k = I[c]; k < end; k++) {
        let bi = I[cellOff + k];
        let t = boxCast(bi, o, d, best);
        if (t >= 0.0) {
          if (anyHit) {
            return t;
          }
          best = t;
          found = true;
          hitN = gN;
          hitAlb = B[bi * 4u + 3u].rgb;
        }
      }
      if (xz <= 1e-6) {
        break;
      }
      let stop = best * xz;
      if (s >= stop) {
        break;
      }
      let next = min(sI, sJ);
      if (next > stop) {
        break;
      }
      if (sI < sJ) {
        s = sI;
        i = i + stepI;
        sI = sI + dsI;
      } else {
        s = sJ;
        j = j + stepJ;
        sJ = sJ + dsJ;
      }
      if (i < 0 || i >= dim || j < 0 || j >= dim) {
        break;
      }
    }
  }

  let tt = marchTerrain(o, d, best);
  if (tt >= 0.0 && (!found || tt < best - 1e-4)) {
    if (anyHit) {
      return tt;
    }
    best = tt;
    found = true;
    let q = o + d * tt;
    hitN = terrainNormal(q.x, q.z);
    hitAlb = P[SC + 7u].rgb;
  }
  if (!found) {
    return -1.0;
  }
  return best;
}

// A fixed spherical Fibonacci set — the SAME directions every update, which is
// what lets a static scene converge to a fixed point instead of crawling.
fn fibDir(i: u32, n: u32) -> vec3f {
  let y = 1.0 - (2.0 * (f32(i) + 0.5)) / f32(n);
  let r = sqrt(max(0.0, 1.0 - y * y));
  let phi = f32(i) * 2.39996323;
  return vec3f(cos(phi) * r, y, sin(phi) * r);
}

// What the sky hands a ray that escapes: the map's flat ambient as a uniform
// dome, and its sky fill as a lobe from overhead — normalised so a surface
// facing straight up under an open sky receives exactly ambient + sky fill,
// which is what the cel shader's flat path gives the same surface.
fn envRadiance(d: vec3f) -> vec3f {
  return P[SC + 5u].rgb / PI + P[SC + 6u].rgb * max(d.y, 0.0) * (1.5 / PI);
}

// Irradiance off an order-1 probe: the colour in the constant band, the
// direction in the linear band of luminance — the cel fragment's own formula.
fn shIrradiance(c0: vec3f, c1: vec3f, n: vec3f) -> vec3f {
  let e0 = c0 * 0.886227;
  let lum0 = dot(e0, LUMW);
  if (lum0 <= 1e-5) {
    return vec3f(0.0);
  }
  let lumN = lum0 + 1.023327 * dot(c1, n);
  return e0 * clamp(lumN / lum0, 0.0, 2.5);
}

// The raw grid position of a probe, before any relocation.
fn probeGridPos(col: vec2i, k: i32) -> vec3f {
  let sp = spacing();
  let x = f32(col.x) * sp;
  let z = f32(col.y) * sp;
  return vec3f(x, heightAt(x, z) + (f32(k) + 0.5) * layerH(), z);
}
`;
}

/**
 * The rolling re-trace. `rays` threads per workgroup, one workgroup per probe.
 */
export function giTraceSource(rays: number): string {
  return /* wgsl */ `
${common()}
const RAYS: u32 = ${rays}u;

@group(0) @binding(4) var<storage, read_write> S: array<vec4f>;

var<workgroup> wA: array<vec4f, ${rays}>;
var<workgroup> wB: array<vec4f, ${rays}>;
var<workgroup> wPos: vec4f;
var<workgroup> wCol: vec4f;

// What the volume already says about a point — the HISTORY's answer, read
// at the probe nearest the hit on its lit side. This is the bounce's second
// bounce and every one after it. Outside the window, or where no probe has
// an answer yet, the sky's own estimate stands in.
//
// Read from the state buffer and never from the composed textures: compose
// adds the fast layer into those, so a trace reading them would bake a muzzle
// flash's bounce into every probe it re-traced while the flash was live — the
// fast layer is never remembered, and this is the read that would remember
// it. A neighbour being re-traced by this same dispatch may be read before or
// after its own write; both are history.
fn volumeAt(p: vec3f, n: vec3f) -> vec3f {
  let sp = spacing();
  let cols = columns();
  let q = p + n * (sp * 0.5);
  let ci = i32(round(q.x / sp));
  let cj = i32(round(q.z / sp));
  let o = windowOrigin();
  let fallback = P[SC + 5u].rgb * 0.5 + P[SC + 6u].rgb * max(n.y, 0.0) * 0.6;
  if (ci < o.x || ci >= o.x + cols || cj < o.y || cj >= o.y + cols) {
    return fallback;
  }
  let fl = heightAt(f32(ci) * sp, f32(cj) * sp);
  let k = max(i32(floor((q.y - fl) / layerH())), 0);
  if (k >= layers()) {
    return fallback;
  }
  // texelOf's inverse: x across, then layer, then z.
  let slot = u32(wrapi(ci, cols)) + u32(cols) * (u32(k) + u32(layers()) * u32(wrapi(cj, cols)));
  let base = slot * ${GI_STATE_VEC4}u;
  let s2 = S[base + 2u];
  // compose's own staleness test: never traced, or traced for another column.
  if (s2.x < 0.5 || s2.z != f32(ci) || s2.w != f32(cj) || s2.y < 0.1) {
    return fallback;
  }
  return shIrradiance(S[base].rgb, S[base + 1u].xyz, n);
}

// The light leaving whatever a ray from o along d meets, toward o. w is 1 for
// a ray that escaped upward — the probe's view of the sky, kept for later.
fn radiance(o: vec3f, d: vec3f, pick: u32) -> vec4f {
  let t = castScene(o, d, P[SC + 3u].w, false);
  if (t < 0.0) {
    return vec4f(envRadiance(d), select(0.0, 1.0, d.y > 0.0));
  }
  let n = hitN;
  let alb = hitAlb;
  let p = o + d * t + n * 0.03;
  var direct = vec3f(0.0);
  let sunTravel = P[SC + 3u].xyz;
  let ndl = dot(n, -sunTravel);
  if (ndl > 0.0) {
    if (castScene(p, -sunTravel, P[SC + 4u].w, true) < 0.0) {
      direct = direct + P[SC + 4u].rgb * ndl;
    }
  }
  // The steady fixtures: ONE of the ones that reach this hit, chosen by the
  // ray's own index and weighted by how many there were, so a hit costs one
  // visibility ray however dense the village's lanterns are. Measured before
  // this was so — a ray per lantern per hit — the trace was 1.45 ms of GPU on
  // Hollowmere's 21 fixtures against 0.2 on a map with few. The choice is a
  // function of the ray and nothing else, so the average over a probe's rays
  // is the same every update and a static scene still converges to a point.
  let slow = u32(P[SC + 9u].x);
  let clearance = P[SC + 5u].w;
  var reach = 0u;
  for (var li = 0u; li < slow; li++) {
    let lp = P[SL + li * 2u];
    let toL = lp.xyz - p;
    let dist = length(toL);
    if (dist < lp.w && dist >= 1e-3 && dot(n, toL) > 0.0) {
      reach = reach + 1u;
    }
  }
  if (reach > 0u) {
    let want = pick % reach;
    var seen = 0u;
    for (var li = 0u; li < slow; li++) {
      let lp = P[SL + li * 2u];
      let toL = lp.xyz - p;
      let dist = length(toL);
      if (dist >= lp.w || dist < 1e-3 || dot(n, toL) <= 0.0) {
        continue;
      }
      if (seen != want) {
        seen = seen + 1u;
        continue;
      }
      let l = toL / dist;
      let nl = dot(n, l);
      if (dist <= clearance || castScene(p, l, dist - clearance, true) < 0.0) {
        var atten = 1.0 - dist / lp.w;
        atten = atten * atten;
        direct = direct
          + P[SL + li * 2u + 1u].rgb * atten * (0.25 + 0.75 * nl) * f32(reach);
      }
      break;
    }
  }
  let bounce = volumeAt(p, n);
  return vec4f(alb * (direct + bounce) / PI, 0.0);
}

@compute @workgroup_size(${rays})
fn main(
  @builtin(workgroup_id) wg: vec3u,
  @builtin(local_invocation_index) li: u32,
) {
  let total = u32(P[SC + 10u].w);
  // The rolling cursor walks a PERMUTATION of the window rather than the
  // window in order: in order, a change in the light — a pane broken, a lamp
  // lit — would reach the picture as a line sweeping across the map. 7919 is
  // prime and shares no factor with any tier's probe count (2^13 times 9 and
  // times 3), so this visits every probe exactly once per sweep, scattered.
  let slot = (((u32(P[SC + 11u].x) + wg.x) % total) * 7919u) % total;

  if (li == 0u) {
    let tex = texelOf(slot);
    let col = columnOf(tex.xz);
    let raw = probeGridPos(col, tex.y);
    // A probe inside a wall sees only the inside of the wall. Try the air
    // around it — up first, since the commonest burial is a floor slab — and
    // give up on it (valid 0) rather than let it print a dark halo.
    let sp = spacing();
    let lh = layerH();
    var pos = raw;
    var ok = !insideAny(raw);
    if (!ok) {
      // A var: it is indexed at run time, which WGSL allows only through a
      // reference.
      var tries = array<vec3f, 6>(
        vec3f(0.0, lh * 0.45, 0.0),
        vec3f(sp * 0.45, 0.0, 0.0),
        vec3f(-sp * 0.45, 0.0, 0.0),
        vec3f(0.0, 0.0, sp * 0.45),
        vec3f(0.0, 0.0, -sp * 0.45),
        vec3f(0.0, -lh * 0.45, 0.0),
      );
      for (var i = 0; i < 6; i++) {
        let q = raw + tries[i];
        if (q.y > heightAt(q.x, q.z) + 0.1 && !insideAny(q)) {
          pos = q;
          ok = true;
          break;
        }
      }
    }
    wPos = vec4f(pos, select(0.0, 1.0, ok));
    wCol = vec4f(f32(col.x), f32(col.y), 0.0, 0.0);
  }
  workgroupBarrier();

  let pv = wPos;
  var a = vec4f(0.0);
  var b = vec4f(0.0);
  if (pv.w > 0.5) {
    let d = fibDir(li, RAYS);
    let L = radiance(pv.xyz, d, li);
    a = vec4f(L.rgb * 0.282095, L.w);
    b = vec4f(dot(L.rgb, LUMW) * 0.488603 * d, 0.0);
  }
  wA[li] = a;
  wB[li] = b;
  workgroupBarrier();
  for (var s = RAYS / 2u; s > 0u; s = s >> 1u) {
    if (li < s) {
      wA[li] = wA[li] + wA[li + s];
      wB[li] = wB[li] + wB[li + s];
    }
    workgroupBarrier();
  }

  if (li == 0u) {
    let base = slot * ${GI_STATE_VEC4}u;
    let old2 = S[base + 2u];
    let col = wCol.xy;
    let stale = old2.z != col.x || old2.w != col.y;
    let age = select(old2.x, 0.0, stale);
    let alpha = max(P[SC + 6u].w, 1.0 / (age + 1.0));
    let scale = 12.5663706 / f32(RAYS);
    let c0 = wA[0].rgb * scale;
    let c1 = wB[0].xyz * scale;
    let sky = wA[0].w / (f32(RAYS) * 0.5);
    var sun = 1.0;
    if (pv.w > 0.5) {
      sun = select(1.0, 0.0,
        castScene(pv.xyz, -P[SC + 3u].xyz, P[SC + 4u].w, true) >= 0.0);
    }
    let old0 = S[base];
    let old1 = S[base + 1u];
    S[base] = vec4f(mix(old0.rgb, c0, alpha), mix(old0.w, sun, alpha));
    S[base + 1u] = vec4f(mix(old1.xyz, c1, alpha), mix(old1.w, sky, alpha));
    S[base + 2u] = vec4f(min(age + 1.0, 1000.0), pv.w, col.x, col.y);
    S[base + 3u] = vec4f(pv.xyz, 0.0);
  }
}
`;
}

/**
 * The per-frame compose: history plus the fast layer, out to the textures the
 * cel shader reads. One thread per probe.
 */
export function giComposeSource(fastRays: number): string {
  return /* wgsl */ `
${common()}
const FAST_RAYS: u32 = ${fastRays}u;

@group(0) @binding(4) var<storage, read> S: array<vec4f>;
@group(0) @binding(5) var outIrr: texture_storage_3d<rgba16float, write>;
@group(0) @binding(6) var outDir: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var outAux: texture_storage_3d<rgba8unorm, write>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let total = u32(P[SC + 10u].w);
  let slot = gid.x;
  if (slot >= total) {
    return;
  }
  let tex = texelOf(slot);
  let col = columnOf(tex.xz);
  let base = slot * ${GI_STATE_VEC4}u;
  let s0 = S[base];
  let s1 = S[base + 1u];
  let s2 = S[base + 2u];
  let s3 = S[base + 3u];
  let stale = s2.x < 0.5 || s2.z != f32(col.x) || s2.w != f32(col.y);
  let sp = spacing();
  let floorY = heightAt(f32(col.x) * sp, f32(col.y) * sp) - P[SC + 10u].z;
  let valid = select(s2.y, 0.0, stale);
  var c0 = s0.rgb;
  var c1 = s1.xyz;

  // THE FAST LAYER: every light that changes faster than the history can
  // follow, bounced from scratch this frame and never remembered. Only for a
  // probe inside a light's reach, so a frame with no flash costs nothing here
  // but the loop test.
  let fast = u32(P[SC + 9u].y);
  if (valid > 0.5 && fast > 0u) {
    let pos = s3.xyz;
    let clearance = P[SC + 5u].w;
    let scale = 12.5663706 / f32(FAST_RAYS);
    for (var f = 0u; f < fast; f++) {
      let lp = P[FL + f * 2u];
      let lc = P[FL + f * 2u + 1u].rgb;
      // Only probes the light itself reaches: a bounce off a surface the light
      // lights, seen from a probe it does not, is a second-order term that is
      // not worth a trace per frame.
      if (distance(pos, lp.xyz) > lp.w) {
        continue;
      }
      for (var r = 0u; r < FAST_RAYS; r++) {
        let d = fibDir(r, FAST_RAYS);
        let t = castScene(pos, d, lp.w, false);
        if (t < 0.0) {
          continue;
        }
        let n = hitN;
        let alb = hitAlb;
        let p = pos + d * t + n * 0.03;
        let toL = lp.xyz - p;
        let dist = length(toL);
        if (dist >= lp.w || dist < 1e-3) {
          continue;
        }
        let l = toL / dist;
        let nl = dot(n, l);
        if (nl <= 0.0) {
          continue;
        }
        if (dist > clearance && castScene(p, l, dist - clearance, true) >= 0.0) {
          continue;
        }
        var atten = 1.0 - dist / lp.w;
        atten = atten * atten;
        let L = alb * lc * atten * (0.25 + 0.75 * nl) / PI;
        c0 = c0 + L * (0.282095 * scale);
        c1 = c1 + dot(L, LUMW) * 0.488603 * scale * d;
      }
    }
  }

  // A steady fire's FLICKER rides the fast layer as a signed difference from
  // its base (GiVolume.chooseFast), estimated from a handful of rays against
  // a base the history estimated from many; where the two disagree the sum
  // can dip below zero, and giIrradiance reads a negative constant band as
  // no light at all — a black hole flickering over the fire. No probe holds
  // less than no light.
  c0 = max(c0, vec3f(0.0));
  let at = vec3u(u32(tex.x), u32(tex.y), u32(tex.z));
  textureStore(outIrr, at, vec4f(c0 * valid, floorY));
  textureStore(outDir, at, vec4f(c1 * valid, valid));
  textureStore(outAux, at, vec4f(select(s0.w, 1.0, stale), select(s1.w, 1.0, stale), 0.0, 1.0));
}
`;
}

/**
 * The point-light visibility: one bit per CHANNEL per probe, kept in a buffer
 * of its own and re-traced only where it can have changed. One thread per
 * probe.
 *
 * **A channel belongs to a light, not to a slot** (`GiVolume.assignChannels`,
 * and `giSlotChannel` in the cel shader), and that is the whole of what makes
 * this cheap: a lantern that holds a slot for a minute is traced once, on the
 * frame it won the slot, and a muzzle flash taking slot 0 re-traces the flash
 * and nothing else. Measured before this was so, re-tracing all sixteen for
 * every probe every frame was 0.85 ms of GPU on Coldharbour.
 *
 * A probe re-traces EVERY channel when its own answer is new — a column the
 * window has just scrolled onto, or a probe the trace has just moved out of a
 * wall — which the column and validity it was last computed for, stored
 * beside the mask, tell it.
 */
export function giVisSource(): string {
  return /* wgsl */ `
${common()}

@group(0) @binding(4) var<storage, read> S: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> V: array<vec4f>;
@group(0) @binding(6) var outVis0: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(7) var outVis1: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(8) var outVis2: texture_storage_3d<rgba8unorm, write>;
@group(0) @binding(9) var outVis3: texture_storage_3d<rgba8unorm, write>;

fn bit(mask: u32, i: u32) -> f32 {
  return f32((mask >> i) & 1u);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let total = u32(P[SC + 10u].w);
  let slot = gid.x;
  if (slot >= total) {
    return;
  }
  let tex = texelOf(slot);
  let col = columnOf(tex.xz);
  let base = slot * ${GI_STATE_VEC4}u;
  let s2 = S[base + 2u];
  let stale = s2.x < 0.5 || s2.z != f32(col.x) || s2.w != f32(col.y);
  let old = V[slot];
  let all = ${(1 << GI_SLOTS) - 1}u;
  var mask = all;
  // A probe with no position of its own yet, or none at all (buried), says
  // nothing: every light visible, the old rule, rather than a guess that
  // blacks a lamp out. Its validity is stored as -1 so the frame it gains a
  // position re-traces everything.
  if (stale || s2.y < 0.5) {
    V[slot] = vec4f(f32(all), f32(col.x), f32(col.y), -1.0);
  } else {
    let fresh = old.y != f32(col.x) || old.z != f32(col.y) || old.w != s2.y;
    if (!fresh) {
      mask = u32(old.x);
    }
    let pos = S[base + 3u].xyz;
    let reach = spacing() * 2.0;
    let clearance = P[SC + 5u].w;
    for (var i = 0u; i < ${GI_SLOTS}u; i++) {
      let flags = P[PL + i * 2u + 1u];
      if (!fresh && flags.x < 0.5) {
        continue;
      }
      var seen = true;
      if (flags.y > 0.5) {
        let lp = P[PL + i * 2u];
        let toL = lp.xyz - pos;
        let dist = length(toL);
        if (dist <= lp.w + reach && dist > clearance) {
          seen = castScene(pos, toL / dist, dist - clearance, true) < 0.0;
        }
      }
      mask = select(mask & ~(1u << i), mask | (1u << i), seen);
    }
    V[slot] = vec4f(f32(mask), f32(col.x), f32(col.y), s2.y);
  }
  let at = vec3u(u32(tex.x), u32(tex.y), u32(tex.z));
  textureStore(outVis0, at, vec4f(bit(mask, 0u), bit(mask, 1u), bit(mask, 2u), bit(mask, 3u)));
  textureStore(outVis1, at, vec4f(bit(mask, 4u), bit(mask, 5u), bit(mask, 6u), bit(mask, 7u)));
  textureStore(outVis2, at, vec4f(bit(mask, 8u), bit(mask, 9u), bit(mask, 10u), bit(mask, 11u)));
  textureStore(outVis3, at, vec4f(bit(mask, 12u), bit(mask, 13u), bit(mask, 14u), bit(mask, 15u)));
}
`;
}
