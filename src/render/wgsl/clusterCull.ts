/**
 * render/wgsl/clusterCull.ts — The compute cull's WGSL: three entry points,
 * run in order once a frame (`ClusterCull.dispatch`, `BABYLON_EXIT.md` X3.3b).
 * Owns: `CLUSTER_CULL_WGSL`; `CULL_DECLARATIONS`, the uniform block and the
 * cluster and block records as both culls and the probe declare them; the
 * byte layouts they read (`CULL_UNIFORM_BYTES`, `CLUSTER_WORDS`,
 * `GROUP_WORDS`, `BLOCK_WORDS`) and its workgroup sizes.
 * Invariants: the surviving clusters of a group are written in one ORDER
 * that is a pure function of the frame's inputs — by near-first band, then
 * by cluster index — through a SCAN, never an atomic append, so the same eye
 * draws the same triangles in the same order and an equal-depth tie is
 * decided the same way every time; the band is the SURFACE's (the distance
 * to its sphere's centre, as Babylon sorts a mesh), so a surface's clusters
 * keep their own index order whatever the eye does and only whole surfaces
 * trade places as it moves, as Babylon's meshes do; a cluster is dropped
 * only if its block is past the reach, its surface is under the size gate,
 * or its box (grown by the most its vertices can sway) is wholly outside one
 * of the five planes.
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
 *   per-band totals, where each band starts in the group's output, and its
 *   indirect arguments.
 * - `scatter` (a workgroup a cluster): a surviving cluster's indices copied
 *   to where the scan says, in the group's region of the output.
 */

/** Threads in a `cull` and a `prefix` workgroup. */
export const SCAN_SIZE = 256;
/** Threads in a `scatter` workgroup. */
export const SCATTER_SIZE = 64;
/** A cluster's record, in 32-bit words (`Cluster` below). */
export const CLUSTER_WORDS = 16;
/** A group's record, in 32-bit words (`Group` below). */
export const GROUP_WORDS = 12;
/** A block's box, in 32-bit words (`Box` below). */
export const BLOCK_WORDS = 8;
/** The uniform block (`Cull` below), in bytes. */
export const CULL_UNIFORM_BYTES = 144;
/** `drawIndexedIndirect`'s five arguments, in bytes. */
export const INDIRECT_BYTES = 20;

/**
 * The uniform block (`CULL_UNIFORM_BYTES`) as nine `vec4u`s of words, and the
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
 */
export const CULL_DECLARATIONS = /* wgsl */ `
@group(0) @binding(0) var<uniform> cull: array<vec4u, 9>;

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

struct Cluster {
  // The box's low corner as float bits, and its first index in w.
  lo: vec4u,
  // The high corner as float bits, and its index count in w.
  hi: vec4u,
  // group, block, surface, piece.
  refs: vec4u,
  // The ramp weight as float bits, whether it is rigged, and padding.
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
`;

export const CLUSTER_CULL_WGSL = /* wgsl */ `
const SCAN: u32 = ${SCAN_SIZE}u;
const SCATTER: u32 = ${SCATTER_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never a
// cluster that is in view.
const SLACK: f32 = 0.05;

${CULL_DECLARATIONS}

struct Group {
  start: u32,
  end: u32,
  outBase: u32,
  _pad: u32,
  base: vec4u,
  bandStart: vec4u,
}

@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read> blocks: array<Box>;
@group(0) @binding(3) var<storage, read> spheres: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> bandOf: array<u32>;
@group(0) @binding(5) var<storage, read_write> local: array<vec4u>;
@group(0) @binding(6) var<storage, read_write> sums: array<vec4u>;
@group(0) @binding(7) var<storage, read_write> groups: array<Group>;
@group(0) @binding(8) var<storage, read_write> args: array<u32>;
@group(0) @binding(9) var<storage, read> source: array<u32>;
@group(0) @binding(10) var<storage, read_write> written: array<u32>;

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

/** Squared distance from the eye to a box; 0 inside it. */
fn dist2(lo: vec3f, hi: vec3f) -> f32 {
  let e = eye();
  let d = max(max(lo - e, vec3f(0.0)), e - hi);
  return dot(d, d);
}

fn visible(c: Cluster) -> bool {
  let b = blocks[c.refs.y];
  if (dist2(b.lo.xyz, b.hi.xyz) > reach2()) { return false; }
  if (gateOn()) {
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

/** What the scan has written ahead of cluster \`x\`; the grand total at \`x == clusters\`. */
fn ahead(x: u32) -> vec4u {
  if (x >= itemCount()) { return sums[cull[8].z]; }
  return sums[x / SCAN] + local[x];
}

@compute @workgroup_size(${SCAN_SIZE})
fn prefix(@builtin(local_invocation_index) li: u32) {
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
  for (var g = li; g < cull[8].y; g += SCAN) {
    let base = ahead(groups[g].start);
    let t = ahead(groups[g].end) - base;
    groups[g].base = base;
    groups[g].bandStart = vec4u(0u, t.x, t.x + t.y, t.x + t.y + t.z);
    let o = g * 5u;
    args[o] = t.x + t.y + t.z + t.w;
    args[o + 1u] = 1u;
    args[o + 2u] = groups[g].outBase;
    args[o + 3u] = 0u;
    args[o + 4u] = 0u;
  }
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
  let g = groups[c.refs.x];
  let at = g.outBase + (ahead(i)[band] - g.base[band]) + g.bandStart[band];
  for (var k = li; k < c.hi.w; k += SCATTER) {
    written[at + k] = source[c.lo.w + k];
  }
}
`;
