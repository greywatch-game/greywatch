/**
 * render/wgsl/instanceCull.ts — The scatter's INSTANCE cull's WGSL: three
 * entry points, run in order once a frame (`InstanceCull.dispatch`,
 * `BABYLON_EXIT.md` X3.4b) — the cluster cull's shape (`clusterCull.ts`)
 * over placements instead of clusters.
 * Owns: `INSTANCE_CULL_WGSL`, the byte layouts it reads
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

export const INSTANCE_CULL_WGSL = /* wgsl */ `
const SCAN: u32 = ${INSTANCE_SCAN_SIZE}u;
const PLACE: u32 = ${PLACE_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never an
// instance that is in view.
const SLACK: f32 = 0.05;

struct Cull {
  // Left, right, bottom, top, and the eye's own plane (w >= 0), normalised.
  planes: array<vec4f, 5>,
  // The eye, and the reach squared in w — \`clusterCull.ts\`'s block, byte for byte.
  eyeReach: vec4f,
  perRad: f32,
  px2: f32,
  gate: u32,
  // How far a ramp weight of 1 can move a vertex.
  rampReach: f32,
  // Each near-first band's end squared, and in w how far a rigged vertex can move.
  bandsRig: vec4f,
  instances: u32,
  sets: u32,
  workgroups: u32,
  draws: u32,
}

// The transform is the world matrix's three columns, each with the matching
// row of its translation in w: the vertex stage rebuilds the matrix from them.
struct Instance {
  center: vec3f,
  radius: f32,
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  // The set it wears: \`set\` is a reserved word in WGSL.
  owner: u32,
  _a: u32,
  _b: u32,
  _c: u32,
}

struct Set {
  start: u32,
  end: u32,
  ramp: f32,
  rigged: u32,
  base: vec4u,
  bandStart: vec4u,
  _pad: vec4u,
}

struct Draw {
  owner: u32,
  indexCount: u32,
  firstIndex: u32,
  baseVertex: i32,
}

@group(0) @binding(0) var<uniform> cull: Cull;
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

/**
 * Whether a sphere's centre lies outside plane \`p\` by more than \`grow\`
 * metres. Every plane is named by a constant index, never picked by a loop
 * over the uniform array — \`clusterCull.ts\`'s \`outside\` says why.
 */
fn outside(p: vec4f, at: vec3f, grow: f32) -> bool {
  return dot(p.xyz, at) + p.w < -grow;
}

fn visible(inst: Instance) -> bool {
  let d = inst.center - cull.eyeReach.xyz;
  let d2 = dot(d, d);
  // The reach, measured to the sphere's near side.
  let near = max(0.0, sqrt(d2) - inst.radius);
  if (near * near > cull.eyeReach.w) { return false; }
  if (cull.gate != 0u && d2 > 1.0) {
    let w = 2.0 * inst.radius * cull.perRad;
    if (w * w < cull.px2 * d2) { return false; }
  }
  let s = sets[inst.owner];
  let grow = inst.radius + s.ramp * cull.rampReach + select(0.0, cull.bandsRig.w, s.rigged != 0u) + SLACK;
  let at = inst.center;
  return !(outside(cull.planes[0], at, grow) || outside(cull.planes[1], at, grow) ||
    outside(cull.planes[2], at, grow) || outside(cull.planes[3], at, grow) || outside(cull.planes[4], at, grow));
}

@compute @workgroup_size(${INSTANCE_SCAN_SIZE})
fn cullInstances(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let i = gid.x;
  var v = vec4u(0u);
  if (i < cull.instances) {
    let inst = instances[i];
    var band = NONE;
    if (visible(inst)) {
      let d = inst.center - cull.eyeReach.xyz;
      let d2 = dot(d, d);
      band = select(select(select(3u, 2u, d2 < cull.bandsRig.z), 1u, d2 < cull.bandsRig.y), 0u, d2 < cull.bandsRig.x);
      v[band] = 1u;
    }
    bandOf[i] = band;
  }
  scan[li] = v;
  workgroupBarrier();
  scanWorkgroup(li);
  if (i < cull.instances) { local[i] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

/** What the scan has written ahead of instance \`x\`; the grand total at \`x == instances\`. */
fn ahead(x: u32) -> vec4u {
  if (x >= cull.instances) { return sums[cull.workgroups]; }
  return sums[x / SCAN] + local[x];
}

@compute @workgroup_size(${INSTANCE_SCAN_SIZE})
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
  for (var s = li; s < cull.sets; s += SCAN) {
    let base = ahead(sets[s].start);
    let t = ahead(sets[s].end) - base;
    sets[s].base = base;
    sets[s].bandStart = vec4u(0u, t.x, t.x + t.y, t.x + t.y + t.z);
  }
  // A draw's count is its set's survivors, read off the scan rather than off
  // \`sets\`, which other threads of this loop are still writing.
  for (var d = li; d < cull.draws; d += SCAN) {
    let draw = draws[d];
    let t = ahead(sets[draw.owner].end) - ahead(sets[draw.owner].start);
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
  if (i >= cull.instances) { return; }
  let band = bandOf[i];
  if (band == NONE) { return; }
  let inst = instances[i];
  let s = sets[inst.owner];
  let slot = s.start + s.bandStart[band] + (ahead(i)[band] - s.base[band]);
  placed[slot * 3u] = inst.c0;
  placed[slot * 3u + 1u] = inst.c1;
  placed[slot * 3u + 2u] = inst.c2;
}
`;
