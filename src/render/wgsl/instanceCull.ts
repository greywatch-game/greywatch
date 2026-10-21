/**
 * render/wgsl/instanceCull.ts — The scatter's INSTANCE cull's WGSL: four
 * entry points, run in order once a frame (`InstanceCull.dispatch`,
 * `BABYLON_EXIT.md` X3.4b; expanded into clusters at X3.5b, the fold) — the
 * cluster cull's shape (`clusterCull.ts`), and its scan
 * (`SCAN_DECLARATIONS`), over each surviving instance's clusters.
 * Owns: `INSTANCE_CULL_WGSL`; `INSTANCE_DECLARATIONS`, the instance and set
 * records as the cull and the probe declare them; the byte layouts it reads
 * (`INSTANCE_CULL_UNIFORM_BYTES`, `INSTANCE_WORDS`, `SET_WORDS`,
 * `RECORD_WORDS`) and the indirect arguments it writes (`INDIRECT_BYTES`).
 * Invariants: an instance is dropped only if its sphere lies past the reach,
 * it is under the size gate, or its sphere (grown by the most its set's
 * vertices can sway) lies wholly outside one of the five planes — its BAND
 * is the instance's, the distance to its sphere's centre, so every cluster
 * of it shares one; a RECORD is one cluster of one instance, and is dropped
 * with its instance or when the cluster's box, moved by the instance's
 * matrix and grown by the most the cluster's vertices can sway, lies wholly
 * outside one of the five planes; a RANGE is one group's records, contiguous
 * in the record table, and its surviving records' indices are written to the
 * range's own region of the stream in the scan's ORDER — by near-first band,
 * then by record index — so the same eye draws the same triangles in the
 * same order; every index written is its cluster's source index as a scatter
 * index of its instance (`render/streamIndex.ts`'s `scatterIndex`); each
 * range's draw is ONE indirect draw whose count is its survivors' indices,
 * from the start of its region, written by `prefix`.
 * Never: reads a node — everything it reads was uploaded as numbers.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * THE FOUR PASSES:
 * - `cullInstances` (a thread an instance): the tests, and the band —
 *   `instanceBand[i]`, `NONE` for a dropped one (what `?cullcheck` reads).
 * - `cullRecords` (a thread a record, `SCAN_SIZE` a workgroup): the record's
 *   instance's band, the cluster's box test, and an exclusive scan of each
 *   band's index count within the workgroup — `local[r]`, with the
 *   workgroup's total in `sums[w]`, as the cluster cull's first pass.
 * - `prefix` (ONE workgroup): `sums` scanned in place, then each range opened
 *   and its draw's indirect arguments written.
 * - `expand` (a workgroup a record): a surviving record's indices, encoded,
 *   copied to where the scan says.
 */

import { STREAM_INDEX_WGSL } from "../streamIndex";
import { CULL_DECLARATIONS, SCAN_DECLARATIONS, SCAN_SIZE } from "./clusterCull";

/** Threads in an `expand` workgroup. */
const EXPAND_SIZE = 64;
/** An instance's record, in 32-bit words (`Instance` below). */
export const INSTANCE_WORDS = 20;
/** A set's record, in 32-bit words (`Set` below). */
export const SET_WORDS = 4;
/** A record — an instance and one cluster of it — in 32-bit words. */
export const RECORD_WORDS = 2;
/** The uniform block (`CULL_DECLARATIONS`' `cull`), in bytes. */
export const INSTANCE_CULL_UNIFORM_BYTES = 144;
/** `drawIndexedIndirect`'s five arguments, in bytes — one a range. */
export const INDIRECT_BYTES = 20;

/**
 * The instance and set records as whole `vec4`s — `CULL_DECLARATIONS`'s rule
 * for the scatter's tables, shared with `?cullcheck`'s probe.
 */
export const INSTANCE_DECLARATIONS = /* wgsl */ `
struct Instance {
  // The bounding sphere: centre, radius.
  sphere: vec4f,
  // Its transform, as the vertex stage's \`transforms\` hold one
  // (\`render/celVertex.ts\`'s \`writeTransform\`).
  c0: vec4f,
  c1: vec4f,
  c2: vec4f,
  // The set it wears in x (\`set\` is a reserved word in WGSL), padding.
  refs: vec4u,
}

struct Set {
  // start, end, the ramp weight as float bits, whether it is rigged.
  head: vec4u,
}

/** Whether a sphere's centre lies outside plane \`p\` by more than \`grow\` metres. */
fn outsidePoint(p: vec4f, at: vec3f, grow: f32) -> bool {
  return dot(p.xyz, at) + p.w < -grow;
}
`;

export const INSTANCE_CULL_WGSL = /* wgsl */ `
const EXPAND: u32 = ${EXPAND_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres: float error at a few kilometres, never an
// instance that is in view.
const SLACK: f32 = 0.05;

${CULL_DECLARATIONS}
${SCAN_DECLARATIONS}
${INSTANCE_DECLARATIONS}
${STREAM_INDEX_WGSL}

// The uniform block's word 8: instances (\`itemCount\`), records, the record
// scan's workgroups (what \`aheadOf\` reads), ranges.
fn recordCount() -> u32 { return cull[8].y; }
fn rangeCount() -> u32 { return cull[8].w; }

@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read_write> instanceBand: array<u32>;
@group(0) @binding(3) var<storage, read_write> local: array<vec4u>;
@group(0) @binding(4) var<storage, read_write> sums: array<vec4u>;
@group(0) @binding(5) var<storage, read> sets: array<Set>;
// Each instanced part's clusters, in its set's own frame: \`Cluster\` with the
// first index into \`source\` in lo.w, the count in hi.w and the range in refs.x.
@group(0) @binding(6) var<storage, read> clusters: array<Cluster>;
// Each record's instance and cluster.
@group(0) @binding(7) var<storage, read> records: array<vec2u>;
@group(0) @binding(8) var<storage, read_write> recordBand: array<u32>;
// A range is one group's records.
@group(0) @binding(9) var<storage, read_write> ranges: array<Range>;
@group(0) @binding(10) var<storage, read> source: array<u32>;
@group(0) @binding(11) var<storage, read_write> written: array<u32>;
@group(0) @binding(12) var<storage, read_write> args: array<u32>;

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

/**
 * Whether cluster \`c\` of instance \`inst\` may be in view: its box in the
 * set's frame moved by the instance's matrix to the world box around it —
 * the middle moved, the half-size through the matrix's absolute value.
 */
fn inView(inst: Instance, c: Cluster) -> bool {
  let lo = bitcast<vec3f>(c.lo.xyz);
  let hi = bitcast<vec3f>(c.hi.xyz);
  let m = 0.5 * (lo + hi);
  let h = 0.5 * (hi - lo);
  let mid = inst.c0.xyz * m.x + inst.c1.xyz * m.y + inst.c2.xyz * m.z + vec3f(inst.c0.w, inst.c1.w, inst.c2.w);
  let half = abs(inst.c0.xyz) * h.x + abs(inst.c1.xyz) * h.y + abs(inst.c2.xyz) * h.z;
  let grow = bitcast<f32>(c.sway.x) * rampReach() + select(0.0, rigReach(), c.sway.y != 0u) + SLACK;
  return !(outsideBox(plane(cull[0]), mid, half, grow) || outsideBox(plane(cull[1]), mid, half, grow) ||
    outsideBox(plane(cull[2]), mid, half, grow) || outsideBox(plane(cull[3]), mid, half, grow) ||
    outsideBox(plane(cull[4]), mid, half, grow));
}

@compute @workgroup_size(${SCAN_SIZE})
fn cullInstances(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= itemCount()) { return; }
  let inst = instances[i];
  var band = NONE;
  if (visible(inst)) {
    let d = inst.sphere.xyz - eye();
    let d2 = dot(d, d);
    let b = bands2();
    band = select(select(select(3u, 2u, d2 < b.z), 1u, d2 < b.y), 0u, d2 < b.x);
  }
  instanceBand[i] = band;
}

@compute @workgroup_size(${SCAN_SIZE})
fn cullRecords(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
) {
  let r = gid.x;
  var v = vec4u(0u);
  if (r < recordCount()) {
    let rec = records[r];
    var band = instanceBand[rec.x];
    if (band != NONE) {
      let c = clusters[rec.y];
      if (inView(instances[rec.x], c)) { v[band] = c.hi.w; } else { band = NONE; }
    }
    recordBand[r] = band;
  }
  scan[li] = v;
  workgroupBarrier();
  scanWorkgroup(li);
  if (r < recordCount()) { local[r] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

@compute @workgroup_size(${SCAN_SIZE})
fn prefix(@builtin(local_invocation_index) li: u32) {
  scanSums(li);
  for (var g = li; g < rangeCount(); g += SCAN) {
    let t = openRange(g, recordCount());
    let o = g * 5u;
    args[o] = t.x + t.y + t.z + t.w;
    args[o + 1u] = 1u;
    args[o + 2u] = ranges[g].outBase;
    args[o + 3u] = 0u;
    args[o + 4u] = 0u;
  }
}

@compute @workgroup_size(${EXPAND_SIZE})
fn expand(
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
  @builtin(num_workgroups) nw: vec3u,
) {
  let r = wid.y * nw.x + wid.x;
  if (r >= recordCount()) { return; }
  let band = recordBand[r];
  if (band == NONE) { return; }
  let rec = records[r];
  let c = clusters[rec.y];
  let at = slotOf(r, recordCount(), band, ranges[c.refs.x]);
  for (var k = li; k < c.hi.w; k += EXPAND) {
    written[at + k] = scatterIndex(rec.x, source[c.lo.w + k]);
  }
}
`;
