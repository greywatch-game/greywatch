/**
 * render/wgsl/clusterCull.ts — The compute cull's WGSL: three entry points,
 * run in order once a frame (`ClusterCull.dispatch`, `BABYLON_EXIT.md` X3.3b).
 * Owns: `CLUSTER_CULL_WGSL`, the byte layouts it reads (`CULL_UNIFORM_BYTES`,
 * `CLUSTER_WORDS`, `GROUP_WORDS`, `BLOCK_WORDS`) and its workgroup sizes.
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

export const CLUSTER_CULL_WGSL = /* wgsl */ `
const SCAN: u32 = ${SCAN_SIZE}u;
const SCATTER: u32 = ${SCATTER_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never a
// cluster that is in view.
const SLACK: f32 = 0.05;

struct Cull {
  // Left, right, bottom, top, and the eye's own plane (w >= 0), normalised.
  planes: array<vec4f, 5>,
  // The eye, and the reach squared in w. No \`vec3f\` beside a scalar in
  // this block — the same bytes, declared as four lanes (\`outside\` says why).
  eyeReach: vec4f,
  perRad: f32,
  px2: f32,
  gate: u32,
  // How far a ramp weight of 1 can move a vertex.
  rampReach: f32,
  // Each near-first band's end squared, and in w how far a rigged vertex can move.
  bandsRig: vec4f,
  clusters: u32,
  groups: u32,
  workgroups: u32,
  _pad: u32,
}

struct Cluster {
  lo: vec3f,
  firstIndex: u32,
  hi: vec3f,
  indexCount: u32,
  group: u32,
  block: u32,
  surface: u32,
  piece: u32,
  ramp: f32,
  rigged: u32,
  _a: u32,
  _b: u32,
}

struct Group {
  start: u32,
  end: u32,
  outBase: u32,
  _pad: u32,
  base: vec4u,
  bandStart: vec4u,
}

struct Box {
  lo: vec3f,
  _a: f32,
  hi: vec3f,
  _b: f32,
}

@group(0) @binding(0) var<uniform> cull: Cull;
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
  let d = max(max(lo - cull.eyeReach.xyz, vec3f(0.0)), cull.eyeReach.xyz - hi);
  return dot(d, d);
}

/**
 * Whether a box (its middle and half its size) lies wholly outside plane \`p\`
 * by more than \`grow\` metres: the far corner's distance, as the middle's
 * plus the half-size along the plane's |normal|. Every plane is named by a
 * constant index and the corner found by \`abs\` — not the form first shipped,
 * a vector \`select\` in a loop over the uniform array, under which a phone
 * dropped whole structures by heading and no desktop did. Whether that form
 * was WHY is what \`?cullcheck\` reads on the device (\`wgsl/cullProbe.ts\`).
 */
fn outside(p: vec4f, mid: vec3f, half: vec3f, grow: f32) -> bool {
  return dot(p.xyz, mid) + dot(abs(p.xyz), half) + p.w < -grow;
}

fn visible(c: Cluster) -> bool {
  let b = blocks[c.block];
  if (dist2(b.lo, b.hi) > cull.eyeReach.w) { return false; }
  if (cull.gate != 0u) {
    let s = spheres[c.surface];
    let d = s.xyz - cull.eyeReach.xyz;
    let d2 = dot(d, d);
    if (d2 > 1.0) {
      let w = 2.0 * s.w * cull.perRad;
      if (w * w < cull.px2 * d2) { return false; }
    }
  }
  let grow = c.ramp * cull.rampReach + select(0.0, cull.bandsRig.w, c.rigged != 0u) + SLACK;
  let mid = 0.5 * (c.lo + c.hi);
  let half = 0.5 * (c.hi - c.lo);
  return !(outside(cull.planes[0], mid, half, grow) || outside(cull.planes[1], mid, half, grow) ||
    outside(cull.planes[2], mid, half, grow) || outside(cull.planes[3], mid, half, grow) ||
    outside(cull.planes[4], mid, half, grow));
}

@compute @workgroup_size(${SCAN_SIZE})
fn cullClusters(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let i = gid.x;
  var v = vec4u(0u);
  if (i < cull.clusters) {
    let c = clusters[i];
    var band = NONE;
    if (visible(c)) {
      // The SURFACE's band, never the cluster's own: a surface's clusters
      // then always draw in their own order, so a tie between two of them is
      // settled as Babylon settles it, by index order, whatever the eye does.
      let s = spheres[c.surface].xyz - cull.eyeReach.xyz;
      let d2 = dot(s, s);
      band = select(select(select(3u, 2u, d2 < cull.bandsRig.z), 1u, d2 < cull.bandsRig.y), 0u, d2 < cull.bandsRig.x);
      v[band] = c.indexCount;
    }
    bandOf[i] = band;
  }
  scan[li] = v;
  workgroupBarrier();
  scanWorkgroup(li);
  if (i < cull.clusters) { local[i] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

/** What the scan has written ahead of cluster \`x\`; the grand total at \`x == clusters\`. */
fn ahead(x: u32) -> vec4u {
  if (x >= cull.clusters) { return sums[cull.workgroups]; }
  return sums[x / SCAN] + local[x];
}

@compute @workgroup_size(${SCAN_SIZE})
fn prefix(@builtin(local_invocation_index) li: u32) {
  // Each thread scans a run of the workgroups' totals in place.
  let n = cull.workgroups;
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
  for (var g = li; g < cull.groups; g += SCAN) {
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
  if (i >= cull.clusters) { return; }
  let band = bandOf[i];
  if (band == NONE) { return; }
  let c = clusters[i];
  let g = groups[c.group];
  let at = g.outBase + (ahead(i)[band] - g.base[band]) + g.bandStart[band];
  for (var k = li; k < c.indexCount; k += SCATTER) {
    written[at + k] = source[c.firstIndex + k];
  }
}
`;
