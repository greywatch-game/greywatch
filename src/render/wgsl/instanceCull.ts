/**
 * render/wgsl/instanceCull.ts — The scatter's INSTANCE cull's WGSL: three
 * entry points, run in order once a frame (`InstanceCull.dispatch`,
 * `BABYLON_EXIT.md` X3.4b) — the cluster cull's shape (`clusterCull.ts`)
 * over placements instead of clusters.
 * Owns: `INSTANCE_CULL_WGSL`; `INSTANCE_DECLARATIONS`, the instance and set
 * records as the cull and the probe declare them; the byte layouts it reads
 * (`INSTANCE_CULL_UNIFORM_BYTES`, `INSTANCE_WORDS`, `SET_WORDS`,
 * `DRAW_WORDS`, `TRANSFORM_WORDS`) and its workgroup sizes.
 * Invariants: a SET is one variant of one kind — the instances that wear it,
 * contiguous in the instance table — and its survivors are written to the
 * set's OWN region of the output (its first instance onward), so a draw binds
 * that region at a fixed offset and needs no `firstInstance` (an indirect
 * draw may not have one without `indirect-first-instance`); within a set the
 * survivors are written in one ORDER that is a pure function of the frame's
 * inputs — by near-first band, then by instance index — through a SCAN, never
 * an atomic append, so the same eye draws the same instances in the same
 * order; an instance is dropped only if its sphere lies past the reach, it is
 * under the size gate, or its sphere (grown by the most its set's vertices
 * can sway) lies wholly outside one of the five planes; every draw's instance
 * count is its set's survivors, written by `prefix`, and the rest of its
 * arguments are the draw's own, written there too.
 * Never: reads a node — everything it reads was uploaded as numbers.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * THE THREE PASSES:
 * - `cullInstances` (a thread an instance, `SCAN_SIZE` a workgroup): the
 *   tests, the band, and an exclusive scan of each band's survivors within
 *   the workgroup — `local[i]`, with the workgroup's total in `sums[w]`.
 * - `prefix` (ONE workgroup): `sums` scanned in place, the grand total at
 *   `sums[workgroups]`; then each set's per-band survivors and where each band
 *   starts in the set's region, and every draw's indirect arguments.
 * - `place` (a thread an instance): a survivor's transform copied to its slot.
 */

import { CULL_DECLARATIONS } from "./clusterCull";

/** Threads in a `cullInstances` and a `prefix` workgroup. */
export const INSTANCE_SCAN_SIZE = 256;
/** Threads in a `place` workgroup. */
export const PLACE_SIZE = 64;
/** An instance's record, in 32-bit words (`Instance` below). */
export const INSTANCE_WORDS = 20;
/** A set's record, in 32-bit words (`Set` below). */
export const SET_WORDS = 16;
/** A draw's record, in 32-bit words (`Draw` below). */
export const DRAW_WORDS = 4;
/** A transform as the vertex stage reads it: three `vec4f` columns, in words. */
export const TRANSFORM_WORDS = 12;
/** The uniform block (`Cull` below), in bytes. */
export const INSTANCE_CULL_UNIFORM_BYTES = 144;

/**
 * The instance and set records as whole `vec4`s — `CULL_DECLARATIONS`'s rule
 * for the scatter's tables, shared with `?cullcheck`'s probe.
 */
export const INSTANCE_DECLARATIONS = /* wgsl */ `
// The transform is the world matrix's three columns, each with the matching
// row of its translation in w: the vertex stage rebuilds the matrix from them.
struct Instance {
  // The bounding sphere: centre, radius.
  sphere: vec4f,
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  // The set it wears in x (\`set\` is a reserved word in WGSL), padding.
  refs: vec4u,
}

struct Set {
  // start, end, the ramp weight as float bits, whether it is rigged.
  head: vec4u,
  base: vec4u,
  bandStart: vec4u,
  _pad: vec4u,
}

/** Whether a sphere's centre lies outside plane \`p\` by more than \`grow\` metres. */
fn outsidePoint(p: vec4f, at: vec3f, grow: f32) -> bool {
  return dot(p.xyz, at) + p.w < -grow;
}
`;

export const INSTANCE_CULL_WGSL = /* wgsl */ `
const SCAN: u32 = ${INSTANCE_SCAN_SIZE}u;
const PLACE: u32 = ${PLACE_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never an
// instance that is in view.
const SLACK: f32 = 0.05;

${CULL_DECLARATIONS}
${INSTANCE_DECLARATIONS}

struct Draw {
  owner: u32,
  indexCount: u32,
  firstIndex: u32,
  baseVertex: i32,
}

@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read_write> bandOf: array<u32>;
@group(0) @binding(3) var<storage, read_write> local: array<vec4u>;
@group(0) @binding(4) var<storage, read_write> sums: array<vec4u>;
@group(0) @binding(5) var<storage, read_write> sets: array<Set>;
@group(0) @binding(6) var<storage, read> draws: array<Draw>;
@group(0) @binding(7) var<storage, read_write> args: array<u32>;
@group(0) @binding(8) var<storage, read_write> placed: array<vec4f>;

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

fn visible(inst: Instance) -> bool {
  let at = inst.sphere.xyz;
  let r = inst.sphere.w;
  let d = at - eye();
  let d2 = dot(d, d);
  // The reach, measured to the sphere's near side.
  let near = max(0.0, sqrt(d2) - r);
  if (near * near > reach2()) { return false; }
  if (gateOn() && d2 > 1.0) {
    let w = 2.0 * r * perRad();
    if (w * w < px2() * d2) { return false; }
  }
  let s = sets[inst.refs.x].head;
  let grow = r + bitcast<f32>(s.z) * rampReach() + select(0.0, rigReach(), s.w != 0u) + SLACK;
  return !(outsidePoint(plane(cull[0]), at, grow) || outsidePoint(plane(cull[1]), at, grow) ||
    outsidePoint(plane(cull[2]), at, grow) || outsidePoint(plane(cull[3]), at, grow) ||
    outsidePoint(plane(cull[4]), at, grow));
}

@compute @workgroup_size(${INSTANCE_SCAN_SIZE})
fn cullInstances(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let i = gid.x;
  var v = vec4u(0u);
  if (i < itemCount()) {
    let inst = instances[i];
    var band = NONE;
    if (visible(inst)) {
      let d = inst.sphere.xyz - eye();
      let d2 = dot(d, d);
      let b = bands2();
      band = select(select(select(3u, 2u, d2 < b.z), 1u, d2 < b.y), 0u, d2 < b.x);
      v[band] = 1u;
    }
    bandOf[i] = band;
  }
  scan[li] = v;
  workgroupBarrier();
  scanWorkgroup(li);
  if (i < itemCount()) { local[i] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

/** What the scan has written ahead of instance \`x\`; the grand total at \`x == instances\`. */
fn ahead(x: u32) -> vec4u {
  if (x >= itemCount()) { return sums[cull[8].z]; }
  return sums[x / SCAN] + local[x];
}

@compute @workgroup_size(${INSTANCE_SCAN_SIZE})
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
  for (var s = li; s < cull[8].y; s += SCAN) {
    let base = ahead(sets[s].head.x);
    let t = ahead(sets[s].head.y) - base;
    sets[s].base = base;
    sets[s].bandStart = vec4u(0u, t.x, t.x + t.y, t.x + t.y + t.z);
  }
  // A draw's count is its set's survivors, read off the scan rather than off
  // \`sets\`, which other threads of this loop are still writing.
  for (var d = li; d < cull[8].w; d += SCAN) {
    let draw = draws[d];
    let head = sets[draw.owner].head;
    let t = ahead(head.y) - ahead(head.x);
    let o = d * 5u;
    args[o] = draw.indexCount;
    args[o + 1u] = t.x + t.y + t.z + t.w;
    args[o + 2u] = draw.firstIndex;
    args[o + 3u] = bitcast<u32>(draw.baseVertex);
    args[o + 4u] = 0u;
  }
}

@compute @workgroup_size(${PLACE_SIZE})
fn place(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(num_workgroups) nw: vec3u,
) {
  let i = gid.y * nw.x * PLACE + gid.x;
  if (i >= itemCount()) { return; }
  let band = bandOf[i];
  if (band == NONE) { return; }
  let inst = instances[i];
  let s = sets[inst.refs.x];
  let slot = s.head.x + s.bandStart[band] + (ahead(i)[band] - s.base[band]);
  placed[slot * 3u] = inst.c0;
  placed[slot * 3u + 1u] = inst.c1;
  placed[slot * 3u + 2u] = inst.c2;
}
`;
