/**
 * render/wgsl/instanceCull.ts — The scatter's INSTANCE cull's WGSL: four
 * entry points, run in order once a frame (`InstanceCull.dispatch`,
 * `BABYLON_EXIT.md` X3.4b; over clusters since X3.5b, the fold) — the
 * cluster cull's shape (`clusterCull.ts`), and its scan
 * (`SCAN_DECLARATIONS`), over each surviving instance's clusters.
 * Owns: `instanceCullWgsl`; `INSTANCE_DECLARATIONS`, the instance and set
 * records as the cull and the probe declare them; the byte layouts it reads
 * (`INSTANCE_CULL_UNIFORM_BYTES`, `INSTANCE_WORDS`, `SET_WORDS`,
 * `RECORD_WORDS`) and the indirect arguments it writes (`INDIRECT_BYTES`);
 * the plane slack (`INSTANCE_SLACK`), which the CPU's bound reads too, and
 * `expand`'s workgroup (`EXPAND_SIZE`), which its direct dispatch is sized
 * by (`InstanceCull`).
 * Invariants: an instance is dropped only if its sphere lies past the reach,
 * its region is filed under a block a probe's view leaves out
 * (`probeExcludes`), it is under the size gate, or its sphere (grown by the
 * most its set's vertices can sway) lies wholly outside one of the five
 * planes — its BAND
 * is the instance's, the distance to its sphere's centre, so every cluster
 * of it shares one; a RECORD is one cluster of one instance, and is dropped
 * with its instance, when its cluster is not drawn in the cull's pass
 * (`passMask`), or when the cluster's box, moved by the instance's
 * matrix and grown by the most the cluster's vertices can sway, lies wholly
 * outside one of the five planes; a RANGE is one group's records, contiguous
 * in the record table, and each surviving record's ENTRY is written to the
 * range's own run of the LIST, from its first record, in the scan's ORDER —
 * by near-first band, then by record index — so the same eye draws the same
 * triangles in the same order (`render/scatterList.ts` is the entry and the
 * index); each range's draw is ONE non-indexed PLAIN draw of
 * `LIST_STRIDE` corners a survivor up to a bound the CPU computes, from its
 * run's first (`InstanceCull.drawRange`) — `prefix` still writes each
 * range's indirect arguments, which nothing reads but the TEMPORARY A/B's
 * indirect arm (`ScatterDraw`); the WORK LIST of survivors is appended to a
 * workgroup's run at a time, in no order, because it decides only which
 * thread writes an entry, never where it lands. `visible` is MIRRORED on the
 * CPU by `InstanceCull.bound`, which must keep whatever it keeps: a test
 * here that KEEPS more (a new sway term in `grow`, a larger slack, a looser
 * gate) owes `bound` the same widening, or the plain draw stops short of a
 * survivor and trees vanish without a word.
 * Never: reads a node — everything it reads was uploaded as numbers; widens
 * `visible` without `InstanceCull.bound`.
 * Contract: `docs/rendering.md`, "Our renderer's frame".
 *
 * THE FOUR PASSES:
 * - `cullInstances` (a thread an instance): the tests, and the band —
 *   `instanceBand[i]`, `NONE` for a dropped one (what `?cullcheck` reads).
 * - `cullRecords` (a thread a record, `SCAN_SIZE` a workgroup): the record's
 *   instance's band, the cluster's box test, and an exclusive scan of each
 *   band's survivors within the workgroup — `local[r]`, with the
 *   workgroup's total in `sums[w]`, as the cluster cull's first pass — and
 *   each survivor appended to the WORK LIST, one append a workgroup.
 * - `prefix` (ONE workgroup): `sums` scanned in place, then each range opened
 *   and its indirect arguments written, and `expand`'s workgroup count and
 *   the work list's length (word 3).
 * - `expand` (a thread a SURVIVOR): its entry written where the scan says.
 *   Dispatched DIRECT, a thread a record (`EXPAND_SIZE` a workgroup), its
 *   threads past the work list's length returning at once — 1,310
 *   workgroups on Greyfen, where a workgroup a record was 83,846 and cost
 *   the phone 1.1-1.4 ms (`BABYLON_EXIT.md` X3.5b); indirect, at `prefix`'s
 *   count, only under the A/B (`ScatterDraw`).
 * `cullRecords` and `expand` bind at most eight storage buffers each, the
 * least `maxStorageBuffersPerShaderStage` a device may have — which is why a
 * survivor carries its band, instance and cluster rather than `expand`
 * reading the record and band tables again.
 * The cull writes 16 bytes a survivor and copies no index: what the scatter
 * draws is read through the list by the vertex stage (`render/celVertex.ts`),
 * and the bytes a frame writes are the cull's price on a phone. It EXPANDED
 * every survivor into an index stream until 2026-10-23, 2-4 M indices a
 * frame on the forest maps; the list took 55-70% off the phone's cull
 * (`BABYLON_EXIT.md` X3.5b).
 */

import { scatterListWgsl } from "../scatterList";
import { CULL_DECLARATIONS, SCAN_DECLARATIONS, SCAN_SIZE } from "./clusterCull";

/** Threads in an `expand` workgroup. */
export const EXPAND_SIZE = 64;
/**
 * A frustum plane's slack for an instance's sphere, metres: float error at a
 * few kilometres, never an instance that is in view.
 */
export const INSTANCE_SLACK = 0.05;
/** The least `maxComputeWorkgroupsPerDimension` WebGPU allows: `expand`'s first dimension. */
const MAX_WORKGROUPS = 65535;
/** `dispatchWorkgroupsIndirect`'s three arguments and the count after them, in bytes — `expand`'s. */
export const DISPATCH_BYTES = 16;
/** An instance's record, in 32-bit words (`Instance` below). */
export const INSTANCE_WORDS = 20;
/** A set's record, in 32-bit words (`Set` below). */
export const SET_WORDS = 4;
/** A record — an instance and one cluster of it — in 32-bit words. */
export const RECORD_WORDS = 2;
/** The uniform block (`CULL_DECLARATIONS`' `cull`), in bytes. */
export const INSTANCE_CULL_UNIFORM_BYTES = 160;
/** `drawIndirect`'s four arguments, in bytes — one a range. */
export const INDIRECT_BYTES = 16;

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
  // The set it wears in x (\`set\` is a reserved word in WGSL), the block its
  // region is filed under in y (\`blockKey\`), padding.
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

/** The instance cull's four entry points, for a list whose survivors each take `stride` corners. */
export function instanceCullWgsl(stride: number): string {
  return /* wgsl */ `
const EXPAND: u32 = ${EXPAND_SIZE}u;
const NONE: u32 = 0xffffffffu;
// A frustum plane's slack, metres (\`INSTANCE_SLACK\`).
const SLACK: f32 = ${INSTANCE_SLACK};

${CULL_DECLARATIONS}
${SCAN_DECLARATIONS}
${INSTANCE_DECLARATIONS}
${scatterListWgsl(stride)}

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
// first index into the source in lo.w, the count in hi.w, the range in refs.x
// and its part's first vertex in its group's arrays in refs.y.
@group(0) @binding(6) var<storage, read> clusters: array<Cluster>;
// Each record's instance and cluster.
@group(0) @binding(7) var<storage, read> records: array<vec2u>;
// A range is one group's records.
@group(0) @binding(9) var<storage, read_write> ranges: array<Range>;
// The LIST: each survivor's entry — instance, first source index, count, part.
@group(0) @binding(11) var<storage, read_write> list: array<vec4u>;
@group(0) @binding(12) var<storage, read_write> args: array<u32>;
// The WORK LIST: each surviving record, its band, its instance and its
// cluster, in no particular order, and how many there are. Its order decides
// nothing — \`slotOf\` places every entry — so it may be appended to.
@group(0) @binding(13) var<storage, read_write> survivorCount: atomic<u32>;
@group(0) @binding(14) var<storage, read_write> survivors: array<vec4u>;
// \`expand\`'s workgroups, written by \`prefix\` from the count — and the count
// itself in word 3, past the three a dispatch reads, which \`expand\` reads
// through a plain binding of the same buffer (\`expandArgs\`): an atomic load
// in every thread of every workgroup is every thread queueing at one address.
@group(0) @binding(15) var<storage, read_write> expandGroups: array<u32>;
@group(0) @binding(16) var<storage, read> expandArgs: array<u32>;

// A workgroup's survivors, and where their run of the work list starts.
var<workgroup> keptHere: atomic<u32>;
var<workgroup> keptBase: u32;

fn visible(inst: Instance) -> bool {
  // A probe's own blocks, as the block merge filed the instance's copy.
  if (probeExcludes(inst.refs.y)) { return false; }
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
  if (!inPass(c)) { return false; }
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
  var kept = vec4u(NONE);
  var slot = 0u;
  if (r < recordCount()) {
    let rec = records[r];
    let band = instanceBand[rec.x];
    if (band != NONE) {
      if (inView(instances[rec.x], clusters[rec.y])) {
        // The scan places its one entry.
        v[band] = 1u;
        kept = vec4u(r, band, rec.x, rec.y);
        slot = atomicAdd(&keptHere, 1u);
      }
    }
  }
  scan[li] = v;
  workgroupBarrier();
  // The workgroup's survivors take their run of the work list in one append.
  if (li == 0u) { keptBase = atomicAdd(&survivorCount, atomicLoad(&keptHere)); }
  workgroupBarrier();
  if (kept.x != NONE) { survivors[keptBase + slot] = kept; }
  scanWorkgroup(li);
  if (r < recordCount()) { local[r] = scan[li] - v; }
  if (li == SCAN - 1u) { sums[wid.x] = scan[li]; }
}

@compute @workgroup_size(${SCAN_SIZE})
fn prefix(@builtin(local_invocation_index) li: u32) {
  if (li == 0u) {
    // A thread a survivor, folded into a second dimension past the least
    // \`maxComputeWorkgroupsPerDimension\` a device may have.
    let n = atomicLoad(&survivorCount);
    let groups = (n + EXPAND - 1u) / EXPAND;
    let x = min(groups, ${MAX_WORKGROUPS}u);
    expandGroups[0] = x;
    expandGroups[1] = select(1u, (groups + x - 1u) / x, x > 0u);
    expandGroups[2] = 1u;
    expandGroups[3] = n;
  }
  scanSums(li);
  for (var g = li; g < rangeCount(); g += SCAN) {
    let t = openRange(g, recordCount());
    // A drawIndirect: every survivor's run of corners, from the range's first.
    let o = g * ${INDIRECT_BYTES / 4}u;
    args[o] = (t.x + t.y + t.z + t.w) * LIST_STRIDE;
    args[o + 1u] = 1u;
    args[o + 2u] = listIndex(ranges[g].outBase);
    args[o + 3u] = 0u;
  }
}

@compute @workgroup_size(${EXPAND_SIZE})
fn expand(
  @builtin(local_invocation_index) li: u32,
  @builtin(workgroup_id) wid: vec3u,
  @builtin(num_workgroups) nw: vec3u,
) {
  let k = (wid.y * nw.x + wid.x) * EXPAND + li;
  if (k >= expandArgs[3]) { return; }
  // The survivor's record, band, instance and cluster; its entry where the
  // scan puts it.
  let kept = survivors[k];
  let c = clusters[kept.w];
  list[slotOf(kept.x, recordCount(), kept.y, ranges[c.refs.x])] = vec4u(kept.z, c.lo.w, c.hi.w, c.refs.y);
}
`;
}
