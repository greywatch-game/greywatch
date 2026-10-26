/**
 * render/wgsl/clusterCull.ts — The compute cull's WGSL: three entry points,
 * run in order once a frame (`ClusterCull.dispatch`, `BABYLON_EXIT.md` X3.3b).
 * Owns: `CLUSTER_CULL_WGSL`; `CULL_DECLARATIONS`, the uniform block and the
 * cluster and block records as both culls and the probe declare them;
 * `SCAN_DECLARATIONS`, the near-first scan both culls order their survivors
 * by — one copy, so both keep one order the one way; the byte layouts they
 * read (`CULL_UNIFORM_BYTES`, `CLUSTER_WORDS`, `RANGE_WORDS`,
 * `BLOCK_WORDS`) and the workgroup sizes; `writeCluster`, the cluster record
 * as both culls' hosts write it, beside the one declaration it writes; the
 * pass bits (`PASS_PROBE` and `PASS_GLOW` among them), `LIGHT_SOURCE`
 * beside them, and the probe view's flags; `blockKey`,
 * a block's coordinates as the cull reads them, and the ONE parse of a
 * `"bx,bz"` key into them (`blockCoordsOf`, `blockKeyOf`).
 * Invariants: the surviving clusters of a group are written in one ORDER
 * that is a pure function of the frame's inputs — by near-first band, then
 * by cluster index — through a SCAN, never an atomic append, so the same eye
 * draws the same triangles in the same order and an equal-depth tie is
 * decided the same way every time; the band is the SURFACE's (the distance
 * to its sphere's centre, as Babylon sorts a mesh), so a surface's clusters
 * keep their own index order whatever the eye does and only whole surfaces
 * trade places as it moves, as Babylon's meshes do; a cluster is dropped
 * only if it is not drawn in the cull's pass (`passMask`), its block is past
 * the reach (a probe view's: its SURFACE's sphere, `PROBE_SPHERE_REACH`), it
 * is filed under a block the view leaves out (`PROBE_EXCLUDE`), its surface
 * is under the size gate — which never drops a `LIGHT_SOURCE` cluster, as
 * the frame's mesh walk never size-gates an emissive — or
 * its box (grown by the most its vertices can sway) is wholly outside one of
 * the five planes.
 * Never: reads a node — everything it reads was uploaded as numbers.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * THE THREE PASSES:
 * - `cull` (a thread a cluster, `SCAN_SIZE` a workgroup): the tests, the
 *   band, and an exclusive scan of each band's index count within the
 *   workgroup — `local[i]`, with the workgroup's total in `sums[w]`. The four
 *   bands are the four lanes of a `vec4u`, so one scan orders all four.
 * - `prefix` (ONE workgroup): `sums` scanned in place to each workgroup's
 *   exclusive prefix, the grand total at `sums[workgroups]`; then each group's
 *   per-band totals and where each band starts in the group's output.
 * - `scatter` (a workgroup a cluster): a surviving cluster's indices copied
 *   to where the scan says, in the group's region of the output — which the
 *   host CLEARED first, so the rest of the region is triangles of no area and
 *   the blocks are drawn plain over the whole of it (`ClusterCull.ts`).
 */
import type { Cluster } from "../clusters";

/** Threads in a scanning workgroup — a `cull` pass's and a `prefix`'s, in both culls. */
export const SCAN_SIZE = 256;
/** Threads in a `scatter` workgroup. */
export const SCATTER_SIZE = 64;
/** A cluster's record, in 32-bit words (`Cluster` below). */
export const CLUSTER_WORDS = 16;
/** A range's record, in 32-bit words (`Range`, `SCAN_DECLARATIONS`). */
export const RANGE_WORDS = 12;
/** A block's box, in 32-bit words (`Box` below). */
export const BLOCK_WORDS = 8;
/** The uniform block (`Cull` below), in bytes. */
export const CULL_UNIFORM_BYTES = 160;

/**
 * The PASSES a cluster is drawn in beside the main one, one bit each, in its
 * record's `sway.z`: a cull handed a mask keeps only the clusters that meet
 * it (`passMask`), and the main pass's cull is handed 0, which tests nothing.
 * - `PASS_CASTS`: a caster in the world's directional shadow maps — the far
 *   and near cascades and the lightning's (`render/WorldShadows.ts`).
 * - `PASS_SOLID`: a translucent SOLID, which the foliage's map records.
 * - `PASS_LAMPS`: a caster in the lamps' atlas — a fixture's static faces
 *   (`render/LampAtlas.ts`), which take everything not marked
 *   `noShadowCaster`, blended or not, as `LocalShadows`' bake always did.
 * - `PASS_PROBE`: in a reflection probe's bake (`render/ProbeBake.ts`,
 *   X3.6c) — every surface the main pass takes, and the emissive palette's
 *   surfaces, whatever casts: Babylon's bake drew the map's visuals whole
 *   but for the glazing.
 * - `PASS_GLOW`: drawn in the glow's MASK through the MAIN view
 *   (`render/WorldGlow.ts`, X3.6d) — the emissive palette but for a surface
 *   marked `noGlow`, which the main pass draws through the same view
 *   (X3.6e). No cull is ever handed it as a mask: the main view keeps every
 *   cluster it counts whatever its passes, and the mask draws a palette
 *   GROUP whole, so what the bit decides is which groups the mask draws
 *   (`WorldBlocks.paletteGroup` keeps a `noGlow` surface in a group of its
 *   own).
 *
 * And one bit that is no pass: `LIGHT_SOURCE`, every palette surface's,
 * glowing or not — a cluster no size gate drops, for the main pass and the
 * mask alike (`WorldCulling`'s `glows` — Babylon never size-gated an
 * emissive mesh, and a lamp lens a few pixels across is exactly what a
 * bloom is for). It shared `PASS_GLOW` until X3.7b, when a `noGlow` palette
 * surface became ours and the two meanings came apart.
 */
export const PASS_CASTS = 1;
export const PASS_SOLID = 2;
export const PASS_LAMPS = 4;
export const PASS_PROBE = 8;
export const PASS_GLOW = 16;
/** A light source: a cluster no size gate drops. Not a pass — see above. */
export const LIGHT_SOURCE = 32;
/** The shadow passes, together: what makes a surface a CASTER, which `PASS_PROBE` does not. */
export const SHADOW_PASSES = PASS_CASTS | PASS_SOLID | PASS_LAMPS;

/**
 * A probe view's two tests beside the pass mask, in the uniform block's word 9
 * y (`CullInputs.probe`): the reach measured to a cluster's SURFACE sphere's
 * near side rather than its block's box — the test Babylon's bake made of a
 * mesh until X3.7c — and the probe's own BLOCKS left out
 * (`ReflectionSystem`'s `exclusionOf`). Every other view sets neither.
 */
export const PROBE_SPHERE_REACH = 1;
export const PROBE_EXCLUDE = 2;

/**
 * A map block's grid coordinates (`metadata.block`, "bx,bz") as the culls
 * carry them — each offset by 2^15 into 16 bits, so 0 is NO block: the
 * landform, a caster of no key, a scatter instance of no region.
 */
export function blockKey(bx: number, bz: number): number {
  return (((bx + 32768) & 0xffff) | (((bz + 32768) & 0xffff) << 16)) >>> 0;
}
/** What a surface or an instance of no block carries (`blockKey`). */
export const NO_BLOCK = 0;

/**
 * A block merge's key ("bx,bz", `world/merge.ts`' `blockOf`) as its grid
 * coordinates — the ONE parse of it — or null for a key that is not a pair
 * of integers (an editor build's, which keys per placement).
 */
export function blockCoordsOf(block: string): readonly [number, number] | null {
  const comma = block.indexOf(",");
  if (comma < 0) return null;
  const bx = Number(block.slice(0, comma));
  const bz = Number(block.slice(comma + 1));
  return Number.isInteger(bx) && Number.isInteger(bz) ? [bx, bz] : null;
}

/** A block merge's key as the culls carry it (`blockKey`); `NO_BLOCK` for none, or one that is not a pair. */
export function blockKeyOf(block: string | null): number {
  const at = block === null ? null : blockCoordsOf(block);
  return at ? blockKey(at[0], at[1]) : NO_BLOCK;
}

/**
 * The uniform block (`CULL_UNIFORM_BYTES`) as ten `vec4u`s of words, and the
 * cluster and block records as whole `vec4`s — the one declaration of each,
 * shared with the instance cull (`wgsl/instanceCull.ts`) and `?cullcheck`'s
 * probe (`wgsl/cullProbe.ts`). No `vec3f` beside a scalar and no scalar
 * member anywhere a test reads: an Adreno 7xx culled against something other
 * than the bytes the CPU wrote under the first form of these tables, and no
 * desktop did (`docs/rendering.md`). A float comes out of a `u32` lane by
 * `bitcast`, never a `u32` out of an `f32` lane — a small integer's bits are
 * a denormal, which a GPU may flush.
 * - words 0..4: left, right, bottom, top, and the eye's own plane (w >= 0).
 * - word 5: the eye; the reach squared in w.
 * - word 6: pixels per radian, the gate's smallest diameter squared, whether
 *   the gate applies (a u32), how far a ramp weight of 1 can move a vertex.
 * - word 7: each near-first band's end squared; how far a rigged vertex can
 *   move in w.
 * - word 8: the item count, the second count (groups or sets), workgroups,
 *   and the instance cull's draws.
 * - word 9: the pass mask in x (`PASS_CASTS`, `PASS_SOLID`, `PASS_LAMPS`,
 *   `PASS_PROBE`; 0 tests nothing); a probe view's tests in y
 *   (`PROBE_SPHERE_REACH`, `PROBE_EXCLUDE`) with its cell's side in blocks
 *   from bit 8; the cell (`blockKey`) in z; the blocks of the cell it leaves
 *   out in w, a bit each, row by row — 0 in y, z and w for every other view.
 */
export const CULL_DECLARATIONS = /* wgsl */ `
@group(0) @binding(0) var<uniform> cull: array<vec4u, 10>;

fn plane(p: vec4u) -> vec4f { return bitcast<vec4f>(p); }
fn eye() -> vec3f { return bitcast<vec3f>(cull[5].xyz); }
fn reach2() -> f32 { return bitcast<f32>(cull[5].w); }
fn perRad() -> f32 { return bitcast<f32>(cull[6].x); }
fn px2() -> f32 { return bitcast<f32>(cull[6].y); }
fn gateOn() -> bool { return cull[6].z != 0u; }
fn rampReach() -> f32 { return bitcast<f32>(cull[6].w); }
fn bands2() -> vec3f { return bitcast<vec3f>(cull[7].xyz); }
fn rigReach() -> f32 { return bitcast<f32>(cull[7].w); }
fn itemCount() -> u32 { return cull[8].x; }
fn passMask() -> u32 { return cull[9].x; }
fn sphereReach() -> bool { return (cull[9].y & ${PROBE_SPHERE_REACH}u) != 0u; }

/** \`a\` over \`b\`, rounded DOWN as \`Math.floor\` is — WGSL's integer division rounds toward zero. */
fn floorDiv(a: i32, b: i32) -> i32 {
  let q = a / b;
  return select(q, q - 1, (a % b != 0) && ((a < 0) != (b < 0)));
}

/**
 * Whether a probe view leaves out what is filed under block \`key\`
 * (\`blockKey\`): one of the blocks the probe SERVES — its cell's, and of
 * those the ones word 9 w names — and never anything of no block. A cell of
 * more than 32 blocks is left out WHOLE: a block past the 32nd has no bit and
 * is dropped, and the host sets all 32 for such a cell
 * (\`ReflectionSystem\`'s \`exclusionOf\`) — one rule on both sides.
 */
fn probeExcludes(key: u32) -> bool {
  let y = cull[9].y;
  if ((y & ${PROBE_EXCLUDE}u) == 0u || key == ${NO_BLOCK}u) { return false; }
  let per = max(i32(y >> 8u), 1);
  let bx = i32(key & 0xffffu) - 32768;
  let bz = i32(key >> 16u) - 32768;
  let cx = floorDiv(bx, per);
  let cz = floorDiv(bz, per);
  let cell = cull[9].z;
  if (cx != i32(cell & 0xffffu) - 32768 || cz != i32(cell >> 16u) - 32768) { return false; }
  let local = u32((bx - cx * per) + (bz - cz * per) * per);
  return local >= 32u || ((cull[9].w >> local) & 1u) != 0u;
}

struct Cluster {
  // The box's low corner as float bits, and its first index in w.
  lo: vec4u,
  // The high corner as float bits, and its index count in w.
  hi: vec4u,
  // group, block, surface, piece.
  refs: vec4u,
  // The ramp weight as float bits, whether it is rigged, the passes it is
  // drawn in (\`PASS_CASTS\`, \`PASS_SOLID\`, \`PASS_LAMPS\`, \`PASS_PROBE\`,
  // \`PASS_GLOW\`) and \`LIGHT_SOURCE\`, and its surface's block (\`blockKey\`;
  // an instanced part's carries none).
  sway: vec4u,
}

struct Box {
  lo: vec4f,
  hi: vec4f,
}

/**
 * Whether a box (its middle and half its size) lies wholly outside plane \`p\`
 * by more than \`grow\` metres: the far corner's distance, as the middle's
 * plus the half-size along the plane's |normal|. Every plane is named by a
 * constant index, never picked by a loop over the uniform array.
 */
fn outsideBox(p: vec4f, mid: vec3f, half: vec3f, grow: f32) -> bool {
  return dot(p.xyz, mid) + dot(abs(p.xyz), half) + p.w < -grow;
}

/** Whether cluster \`c\` is drawn in this cull's pass: every one, under a mask of 0. */
fn inPass(c: Cluster) -> bool {
  let mask = passMask();
  return mask == 0u || (c.sway.z & mask) != 0u;
}
`;

/**
 * Cluster `k` as `CULL_DECLARATIONS`' `Cluster` — both culls' record: its
 * box, its first index and count, its four `refs`, its sway, the passes it
 * is drawn in beside the main one (`passes`: `PASS_CASTS`, `PASS_SOLID`,
 * `PASS_LAMPS`, `PASS_PROBE`, `PASS_GLOW`) and its surface's block (`key`, `blockKey`).
 */
export function writeCluster(
  f: Float32Array,
  u: Uint32Array,
  k: number,
  cl: Cluster,
  first: number,
  refs: readonly [number, number, number, number],
  passes: number,
  key: number = NO_BLOCK,
): void {
  const o = k * CLUSTER_WORDS;
  f[o] = cl.lo[0];
  f[o + 1] = cl.lo[1];
  f[o + 2] = cl.lo[2];
  u[o + 3] = first;
  f[o + 4] = cl.hi[0];
  f[o + 5] = cl.hi[1];
  f[o + 6] = cl.hi[2];
  u[o + 7] = cl.indexCount;
  for (let r = 0; r < 4; r++) u[o + 8 + r] = refs[r];
  f[o + 12] = cl.ramp;
  u[o + 13] = cl.rigged ? 1 : 0;
  u[o + 14] = passes;
  u[o + 15] = key;
}

/**
 * The near-first SCAN, as both culls run it over their own items (clusters
 * here, an instance's clusters in `instanceCull.ts`): each item's four band
 * lanes scanned within its workgroup into `local`, the workgroups' totals
 * into `sums` and then scanned in place by `scanSums`, the grand total at
 * `sums[workgroups]` (the uniform's word 8 z). A RANGE is a run of items that
 * writes one region of the output, `openRange` sets where each of its bands
 * starts there, and `slotOf` is where an item's first index goes — by band,
 * then by item index, a pure function of the frame's inputs, never an atomic
 * append. A module that includes it declares `local`, `sums` and `ranges`.
 */
export const SCAN_DECLARATIONS = /* wgsl */ `
const SCAN: u32 = ${SCAN_SIZE}u;

struct Range {
  start: u32,
  end: u32,
  outBase: u32,
  _pad: u32,
  base: vec4u,
  bandStart: vec4u,
}

var<workgroup> scan: array<vec4u, SCAN>;

/** Inclusive scan of \`scan\` across the workgroup, Hillis-Steele. */
fn scanWorkgroup(li: u32) {
  for (var off = 1u; off < SCAN; off = off * 2u) {
    var t = vec4u(0u);
    if (li >= off) { t = scan[li - off]; }
    workgroupBarrier();
    scan[li] = scan[li] + t;
    workgroupBarrier();
  }
}

/** What the scan has written ahead of item \`x\` of \`count\`; the grand total at \`x == count\`. */
fn aheadOf(x: u32, count: u32) -> vec4u {
  if (x >= count) { return sums[cull[8].z]; }
  return sums[x / SCAN] + local[x];
}

/** A \`prefix\`'s first half, in ONE workgroup: the workgroups' totals scanned in place. */
fn scanSums(li: u32) {
  // Each thread scans a run of the workgroups' totals in place.
  let n = cull[8].z;
  let per = (n + SCAN - 1u) / SCAN;
  let k0 = min(n, li * per);
  let k1 = min(n, k0 + per);
  var run = vec4u(0u);
  for (var k = k0; k < k1; k++) { run = run + sums[k]; }
  scan[li] = run;
  workgroupBarrier();
  scanWorkgroup(li);
  var at = scan[li] - run;
  for (var k = k0; k < k1; k++) {
    let s = sums[k];
    sums[k] = at;
    at = at + s;
  }
  if (li == SCAN - 1u) { sums[n] = scan[li]; }
  storageBarrier();
}

/** Range \`g\`'s per-band totals, returned, and where each of its bands starts in its region. */
fn openRange(g: u32, count: u32) -> vec4u {
  let base = aheadOf(ranges[g].start, count);
  let t = aheadOf(ranges[g].end, count) - base;
  ranges[g].base = base;
  ranges[g].bandStart = vec4u(0u, t.x, t.x + t.y, t.x + t.y + t.z);
  return t;
}

/** Where item \`i\` of \`count\`, kept in \`band\`, of range \`r\`, writes its first index. */
fn slotOf(i: u32, count: u32, band: u32, r: Range) -> u32 {
  return r.outBase + (aheadOf(i, count)[band] - r.base[band]) + r.bandStart[band];
}
`;

export const CLUSTER_CULL_WGSL = /* wgsl */ `
const SCATTER: u32 = ${SCATTER_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never a
// cluster that is in view.
const SLACK: f32 = 0.05;

${CULL_DECLARATIONS}
${SCAN_DECLARATIONS}

@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> blocks: array<Box>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> bandOf: array<u32>;
@group(0) @binding(5) var<storage, read_write> local: array<vec4u>;
@group(0) @binding(6) var<storage, read_write> sums: array<vec4u>;
// A range is one group's clusters.
@group(0) @binding(7) var<storage, read_write> ranges: array<Range>;
@group(0) @binding(9) var<storage, read> source: array<u32>;
@group(0) @binding(10) var<storage, read_write> written: array<u32>;

/** Squared distance from the eye to a box; 0 inside it. */
fn dist2(lo: vec3f, hi: vec3f) -> f32 {
  let e = eye();
  let d = max(max(lo - e, vec3f(0.0)), e - hi);
  return dot(d, d);
}

fn visible(c: Cluster) -> bool {
  if (!inPass(c) || probeExcludes(c.sway.w)) { return false; }
  if (sphereReach()) {
    // A probe's reach: to the near side of the SURFACE's sphere, as Babylon's
    // bake measured a mesh.
    let s = spheres[c.refs.z];
    let gap = max(0.0, length(s.xyz - eye()) - s.w);
    if (gap * gap > reach2()) { return false; }
  } else {
    let b = blocks[c.refs.y];
    if (dist2(b.lo.xyz, b.hi.xyz) > reach2()) { return false; }
  }
  // A light source is never size-gated (\`LIGHT_SOURCE\`): the main pass and
  // the glow's mask draw the palette through this view, and Babylon never
  // gated an emissive mesh.
  if (gateOn() && (c.sway.z & ${LIGHT_SOURCE}u) == 0u) {
    let s = spheres[c.refs.z];
    let d = s.xyz - eye();
    let d2 = dot(d, d);
    if (d2 > 1.0) {
      let w = 2.0 * s.w * perRad();
      if (w * w < px2() * d2) { return false; }
    }
  }
  let grow = bitcast<f32>(c.sway.x) * rampReach() + select(0.0, rigReach(), c.sway.y != 0u) + SLACK;
  let lo = bitcast<vec3f>(c.lo.xyz);
  let hi = bitcast<vec3f>(c.hi.xyz);
  let mid = 0.5 * (lo + hi);
  let half = 0.5 * (hi - lo);
  return !(outsideBox(plane(cull[0]), mid, half, grow) || outsideBox(plane(cull[1]), mid, half, grow) ||
    outsideBox(plane(cull[2]), mid, half, grow) || outsideBox(plane(cull[3]), mid, half, grow) ||
    outsideBox(plane(cull[4]), mid, half, grow));
}

@compute @workgroup_size(${SCAN_SIZE})
fn cullClusters(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let i = gid.x;
  var v = vec4u(0u);
  if (i < itemCount()) {
    let c = clusters[i];
    var band = NONE;
    if (visible(c)) {
      // The SURFACE's band, never the cluster's own: a surface's clusters
      // then always draw in their own order, so a tie between two of them is
      // settled as Babylon settles it, by index order, whatever the eye does.
      let s = spheres[c.refs.z].xyz - eye();
      let d2 = dot(s, s);
      let b = bands2();
      band = select(select(select(3u, 2u, d2 < b.z), 1u, d2 < b.y), 0u, d2 < b.x);
      v[band] = c.hi.w;
    }
    bandOf[i] = band;
  }
  scan[li] = v;
  workgroupBarrier();
  scanWorkgroup(li);
  if (i < itemCount()) { local[i] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

@compute @workgroup_size(${SCAN_SIZE})
fn prefix(@builtin(local_invocation_index) li: u32) {
  scanSums(li);
  for (var g = li; g < cull[8].y; g += SCAN) { openRange(g, itemCount()); }
}

@compute @workgroup_size(${SCATTER_SIZE})
fn scatter(
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
  @builtin(num_workgroups) nw: vec3u,
) {
  let i = wid.y * nw.x + wid.x;
  if (i >= itemCount()) { return; }
  let band = bandOf[i];
  if (band == NONE) { return; }
  let c = clusters[i];
  let at = slotOf(i, itemCount(), band, ranges[c.refs.x]);
  for (var k = li; k < c.hi.w; k += SCATTER) {
    written[at + k] = source[c.lo.w + k];
  }
}
`;
